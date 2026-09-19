import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP, type AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { ClientSignalMessageSchema, isRelaySignal, type ClientSignalMessage, type ServerSignalMessage } from '@ghostpair/protocol';
import { defaultConfig, type ServerConfig } from './config.js';
import { Devices, type DeviceStore } from './devices.js';
import { PostgresDevices } from './postgres-devices.js';
import { RateLimit } from './rate-limit.js';

type Phase = 'idle' | 'authenticating' | 'hosting' | 'paired' | 'detached';
interface Client {
  socket: WebSocket;
  ip: string;
  phase: Phase;
  role?: 'host' | 'guest';
  sessionId?: string;
  room?: Room;
  pendingDevice?: string;
  authTimer?: NodeJS.Timeout;
  alive: boolean;
  authAttempt?: symbol;
  messages: RateLimit;
}
interface Room {
  deviceId: string;
  sessionId: string;
  host: Client;
  guest?: Client;
  pendingGuest?: Client;
  salt: Buffer;
  passwordHash: Buffer;
  paired: boolean;
  timer: NodeJS.Timeout;
}

export function createServer(overrides: Partial<ServerConfig> = {}, store?: DeviceStore) {
  const config = { ...defaultConfig, ...overrides };
  const devices = store ?? (config.databaseUrl !== undefined ? new PostgresDevices({ ...config, databaseUrl: config.databaseUrl }) : new Devices(config.databasePath));
  const clients = new Set<Client>();
  const rooms = new Map<string, Room>();
  const openingHosts = new Map<string, Client>();
  const registrationRate = new RateLimit(config.registrationLimit, config.registrationWindowMs);
  const authIpRate = new RateLimit(config.authIpLimit, config.authWindowMs);
  const authDeviceRate = new RateLimit(config.authDeviceLimit, config.authWindowMs);
  const counters = { registrations: 0, connections: 0, authFailures: 0, rateLimited: 0, protocolErrors: 0, sessionsPaired: 0, signalingMessages: 0, internalErrors: 0 };
  let activeAuth = 0;
  let stopping = false;
  let closed = false;
  let initialized = false;
  let readiness: Promise<boolean> | undefined, readinessUntil = 0;
  const inFlight = new Set<Promise<unknown>>();
  function track<T>(work: Promise<T>): Promise<T> {
    inFlight.add(work); void work.then(() => inFlight.delete(work), () => inFlight.delete(work)); return work;
  }
  async function ready() {
    if (!initialized || stopping) return false;
    if (!readiness || Date.now() >= readinessUntil) {
      readinessUntil = Infinity;
      readiness = devices.check().then(() => true, () => false).finally(() => { readinessUntil = Date.now() + 1000; });
    }
    return await readiness && !stopping;
  }

  function allowedOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return true;
    if (!config.allowLocalhostOrigins) return false;
    try {
      const url = new URL(origin);
      return url.origin === origin && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    } catch { return false; }
  }

  function requestIp(request: IncomingMessage): string {
    if (config.trustProxy) {
      const header = request.headers['x-forwarded-for'];
      const candidate = (typeof header === 'string' ? header : '').split(',').at(-1)?.trim();
      if (candidate && isIP(candidate)) return candidate;
    }
    return request.socket.remoteAddress ?? 'unknown';
  }

  function json(response: ServerResponse, status: number, payload: object): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(payload));
  }

  async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'GET' && request.url === '/privacy') {
      const policy = await readFile(new URL('../../../docs/privacy.html', import.meta.url));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", 'Cache-Control': 'no-cache' });
      response.end(policy); return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      json(response, stopping ? 503 : 200, { status: stopping ? 'stopping' : 'ok' });
      return;
    }
    if (request.method === 'GET' && request.url === '/ready') {
      const available = await ready(); json(response, available ? 200 : 503, { status: available ? 'ready' : 'unavailable' }); return;
    }
    if (request.url !== '/v1/devices' || !['POST', 'OPTIONS'].includes(request.method ?? '')) {
      json(response, 404, { error: 'NOT_FOUND' }); return;
    }
    if (!allowedOrigin(request.headers.origin)) {
      json(response, 403, { error: 'ORIGIN_DENIED' }); return;
    }
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin!);
    response.setHeader('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'POST');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.writeHead(204); response.end(); return;
    }
    if (stopping) {
      json(response, 503, { error: 'CAPACITY_REACHED' }); return;
    }
    if (!registrationRate.allow(requestIp(request))) {
      counters.rateLimited += 1;
      response.setHeader('Retry-After', Math.ceil(config.registrationWindowMs / 1000));
      json(response, 429, { error: 'RATE_LIMITED' }); return;
    }
    let size = 0;
    for await (const chunk of request) {
      size += Buffer.byteLength(chunk);
      if (size > 1024) { json(response, 413, { error: 'PAYLOAD_TOO_LARGE' }); return; }
    }
    // Capacity checking and insertion are atomic inside the storage adapter.
    if (stopping) {
      json(response, 503, { error: 'CAPACITY_REACHED' }); return;
    }
    let identity;
    try { identity = await devices.register(config.maxRegisteredDevices); }
    catch { counters.internalErrors++; json(response, 503, { error: 'STORAGE_UNAVAILABLE' }); return; }
    if (!identity) { json(response, 503, { error: 'CAPACITY_REACHED' }); return; }
    counters.registrations += 1;
    json(response, 201, identity);
  }

  const httpServer = createHttpServer((request, response) => {
    void track(handleHttp(request, response)).catch(() => {
      counters.internalErrors += 1;
      if (!response.headersSent) json(response, 500, { error: 'INTERNAL_ERROR' });
      else response.destroy();
    });
  });
  httpServer.headersTimeout = 15_000;
  httpServer.requestTimeout = 15_000;
  httpServer.keepAliveTimeout = 5_000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayloadBytes, perMessageDeflate: false });

  function send(client: Client, message: ServerSignalMessage): void {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    if (client.socket.bufferedAmount > config.maxPayloadBytes * 8) {
      client.socket.close(1008, 'Backpressure limit'); return;
    }
    client.socket.send(JSON.stringify(message), (error) => { if (error) client.socket.terminate(); });
  }

  function error(client: Client, code: string, message: string): void {
    send(client, { type: 'error', code, message });
  }

  function startAuthTimer(client: Client): void {
    clearTimeout(client.authTimer);
    client.authTimer = setTimeout(() => {
      if (client.phase === 'idle' || client.phase === 'authenticating') client.socket.close(1008, 'Authentication timeout');
    }, config.authTimeoutMs);
    client.authTimer.unref();
  }

  function resetClient(client: Client): void {
    client.authAttempt = undefined;
    client.phase = 'idle';
    client.room = undefined;
    client.role = undefined;
    client.sessionId = undefined;
    client.pendingDevice = undefined;
    if (clients.has(client) && client.socket.readyState === WebSocket.OPEN) startAuthTimer(client);
  }

  function removeRoom(room: Room, notify: boolean, reason: string): void {
    if (rooms.get(room.deviceId) !== room) return;
    rooms.delete(room.deviceId);
    clearTimeout(room.timer);
    room.passwordHash.fill(0);
    room.salt.fill(0);
    const pending = room.pendingGuest;
    room.pendingGuest = undefined;
    if (pending) {
      resetClient(pending);
      error(pending, 'SESSION_UNAVAILABLE', 'The session is no longer available.');
    }
    for (const member of [room.host, room.guest]) {
      if (!member) continue;
      if (notify) {
        send(member, { type: 'ended', sessionId: room.sessionId, reason });
        resetClient(member);
      } else {
        // WebSocket availability must not control an established direct connection.
        member.room = undefined;
        member.phase = 'detached';
      }
    }
  }

  function release(client: Client): void {
    client.authAttempt = undefined;
    clients.delete(client);
    clearTimeout(client.authTimer);
    if (client.pendingDevice && openingHosts.get(client.pendingDevice) === client) openingHosts.delete(client.pendingDevice);
    const room = client.room;
    if (room?.pendingGuest === client) room.pendingGuest = undefined;
    if (room && (room.host === client || room.guest === client)) removeRoom(room, false, 'Signaling disconnected.');
    client.room = undefined;
  }

  function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 32, { N: config.scryptN, r: config.scryptR, p: config.scryptP, maxmem: 256 * 1024 * 1024 }, (failure, hash) => {
        if (failure) reject(failure); else resolve(hash);
      });
    });
  }

  function beginAuth(client: Client, deviceId: string): symbol | undefined {
    if (stopping || !clients.has(client) || client.socket.readyState !== WebSocket.OPEN) return;
    if (client.phase !== 'idle') { error(client, 'INVALID_STATE', 'This connection already participates in a session.'); return; }
    if (!authIpRate.allow(client.ip) || !authDeviceRate.allow(deviceId)) {
      counters.rateLimited += 1;
      error(client, 'RATE_LIMITED', 'Too many attempts. Try again later.'); return;
    }
    if (activeAuth >= config.maxAuthConcurrency) { error(client, 'SERVER_BUSY', 'The server is busy. Try again.'); return; }
    client.phase = 'authenticating';
    activeAuth++; const attempt = Symbol('authentication'); client.authAttempt = attempt; return attempt;
  }

  function currentAttempt(client: Client, attempt: symbol) {
    return !stopping && clients.has(client) && client.socket.readyState === WebSocket.OPEN && client.phase === 'authenticating' && client.authAttempt === attempt;
  }
  async function openHost(client: Client, message: Extract<ClientSignalMessage, { type: 'host.open' }>): Promise<void> {
    const attempt = beginAuth(client, message.deviceId); if (!attempt) return;
    try {
      const authenticated = await devices.authenticate(message.deviceId, message.ownerToken);
      if (!currentAttempt(client, attempt)) return;
      if (!authenticated) {
        counters.authFailures += 1; client.phase = 'idle';
        error(client, 'AUTH_FAILED', 'Could not authenticate the device.'); return;
      }
      if (rooms.has(message.deviceId) || openingHosts.has(message.deviceId)) {
        client.phase = 'idle'; error(client, 'HOST_ALREADY_ACTIVE', 'This device already has a session.'); return;
      }
      if (rooms.size + openingHosts.size >= config.maxRooms) {
        client.phase = 'idle'; error(client, 'SERVER_BUSY', 'There is no capacity for another session.'); return;
      }
      client.pendingDevice = message.deviceId;
      openingHosts.set(message.deviceId, client);
      const salt = randomBytes(16);
      let passwordHash: Buffer;
      try { passwordHash = await hashPassword(message.password, salt); }
      catch {
        salt.fill(0);
        if (currentAttempt(client, attempt)) {
          if (openingHosts.get(message.deviceId) === client) openingHosts.delete(message.deviceId);
          client.pendingDevice = undefined; client.phase = 'idle';
          error(client, 'SERVER_BUSY', 'Could not start the session.');
        }
        counters.internalErrors += 1; return;
      }
      if (!currentAttempt(client, attempt) || openingHosts.get(message.deviceId) !== client) {
        passwordHash.fill(0); salt.fill(0); return;
      }
      openingHosts.delete(message.deviceId);
      client.pendingDevice = undefined;
      const sessionId = randomBytes(16).toString('hex');
      const room: Room = {
        deviceId: message.deviceId, sessionId, host: client, salt, passwordHash, paired: false,
        timer: setTimeout(() => removeRoom(room, true, 'The connection waiting period expired.'), config.waitingRoomTimeoutMs),
      };
      room.timer.unref();
      rooms.set(room.deviceId, room);
      client.phase = 'hosting'; client.role = 'host'; client.sessionId = sessionId; client.room = room;
      clearTimeout(client.authTimer);
      send(client, { type: 'host.ready', deviceId: message.deviceId, sessionId });
    } catch {
      counters.internalErrors++;
      if (currentAttempt(client, attempt)) { client.phase = 'idle'; error(client, 'SERVER_BUSY', 'Identity storage is unavailable. Try again later.'); }
    } finally {
      activeAuth--;
      if (client.authAttempt === attempt) client.authAttempt = undefined;
    }
  }

  async function joinGuest(client: Client, message: Extract<ClientSignalMessage, { type: 'guest.join' }>): Promise<void> {
    const attempt = beginAuth(client, message.deviceId); if (!attempt) return;
    try {
      const room = rooms.get(message.deviceId);
      if (!room || room.paired || room.pendingGuest) {
        client.phase = 'idle'; error(client, 'SESSION_UNAVAILABLE', 'The session is unavailable.'); return;
      }
      room.pendingGuest = client;
      client.room = room;
      let hash: Buffer;
      try { hash = await hashPassword(message.password, room.salt); }
      catch {
        if (room.pendingGuest === client) room.pendingGuest = undefined;
        if (currentAttempt(client, attempt) && client.room === room) { client.room = undefined; client.phase = 'idle'; }
        counters.internalErrors += 1;
        error(client, 'SERVER_BUSY', 'Could not verify the password.'); return;
      }
      const current = currentAttempt(client, attempt) && rooms.get(message.deviceId) === room && room.pendingGuest === client && room.host.socket.readyState === WebSocket.OPEN;
      if (!current) { hash.fill(0); return; }
      room.pendingGuest = undefined;
      const matches = timingSafeEqual(hash, room.passwordHash);
      hash.fill(0);
      if (!matches) {
        client.room = undefined; client.phase = 'idle'; counters.authFailures += 1;
        error(client, 'AUTH_FAILED', 'Could not authenticate the connection.'); return;
      }
      room.paired = true;
      room.guest = client;
      room.passwordHash.fill(0); room.salt.fill(0);
      clearTimeout(room.timer); clearTimeout(client.authTimer);
      client.phase = 'paired'; client.role = 'guest'; client.sessionId = room.sessionId;
      room.host.phase = 'paired';
      counters.sessionsPaired += 1;
      send(client, { type: 'paired', role: 'guest', sessionId: room.sessionId });
      send(room.host, { type: 'paired', role: 'host', sessionId: room.sessionId });
    } catch {
      counters.internalErrors++;
      if (currentAttempt(client, attempt)) { client.phase = 'idle'; error(client, 'SERVER_BUSY', 'Identity storage is unavailable. Try again later.'); }
    } finally {
      activeAuth--;
      if (client.authAttempt === attempt) client.authAttempt = undefined;
    }
  }

  async function handleMessage(client: Client, data: RawData, binary: boolean): Promise<void> {
    if (!client.messages.allow('messages')) {
      counters.rateLimited += 1;
      error(client, 'RATE_LIMITED', 'Demasiados mensajes.'); client.socket.close(1008, 'Message limit'); return;
    }
    let input: unknown;
    try { if (binary) throw new Error('Binary signaling'); input = JSON.parse(data.toString()); }
    catch { counters.protocolErrors += 1; error(client, 'INVALID_MESSAGE', 'Invalid message.'); client.socket.close(1008, 'Invalid message'); return; }
    const parsed = ClientSignalMessageSchema.safeParse(input);
    if (!parsed.success) {
      counters.protocolErrors += 1;
      error(client, 'INVALID_MESSAGE', 'Invalid message.'); return;
    }
    const message = parsed.data;
    if (message.type === 'ping') { send(client, { type: 'pong', id: message.id }); return; }
    if (message.type === 'host.open') { await openHost(client, message); return; }
    if (message.type === 'guest.join') { await joinGuest(client, message); return; }
    if (message.sessionId !== client.sessionId) { error(client, 'FORBIDDEN', 'The session does not belong to this connection.'); return; }
    if (message.type === 'host.close') {
      if (client.role !== 'host') { error(client, 'FORBIDDEN', 'Only the host can end the session.'); return; }
      if (client.room) removeRoom(client.room, true, 'The host ended the session.');
      else { send(client, { type: 'ended', sessionId: message.sessionId, reason: 'Session ended.' }); resetClient(client); }
      return;
    }
    const room = client.room;
    if (!room || !room.paired || rooms.get(room.deviceId) !== room) { error(client, 'SIGNAL_UNAVAILABLE', 'Signaling for this session ended.'); return; }
    if ((message.payload.type === 'offer' && client.role !== 'host') || (message.payload.type === 'answer' && client.role !== 'guest') || isRelaySignal(message.payload)) {
      error(client, 'FORBIDDEN', 'This signal is not allowed.'); return;
    }
    const peer = client.role === 'host' ? room.guest : room.host;
    if (peer) { send(peer, { type: 'signal', sessionId: room.sessionId, payload: message.payload }); counters.signalingMessages += 1; }
  }

  httpServer.on('upgrade', (request, socket, head) => {
    const ip = requestIp(request);
    const originOk = allowedOrigin(request.headers.origin);
    if (stopping || request.url !== '/v1/connect' || !originOk || clients.size >= config.maxConnections || [...clients].filter((client) => client.ip === ip).length >= config.maxConnectionsPerIp) {
      const status = !originOk ? '403 Forbidden' : '503 Service Unavailable';
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const client: Client = { socket: ws, ip, phase: 'idle', alive: true, messages: new RateLimit(config.socketMessageLimit, config.socketMessageWindowMs, 1) };
      clients.add(client); counters.connections += 1;
      startAuthTimer(client);
      ws.on('pong', () => { client.alive = true; });
      ws.on('close', () => release(client));
      ws.on('error', () => { ws.terminate(); });
      ws.on('message', (data, binary) => {
        void track(handleMessage(client, data, binary)).catch(() => {
          counters.internalErrors += 1;
          error(client, 'INTERNAL_ERROR', 'Could not process the message.'); ws.close(1011, 'Internal error');
        });
      });
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) { client.socket.terminate(); continue; }
      client.alive = false;
      if (client.socket.readyState === WebSocket.OPEN) client.socket.ping();
    }
  }, config.heartbeatMs);
  heartbeat.unref();

  return {
    httpServer,
    get stats() { return { ...counters, activeConnections: clients.size, activeRooms: rooms.size, activeAuth }; },
    async listen(port = config.port, host = config.host): Promise<AddressInfo> {
      try { await devices.initialize(); initialized = true; }
      catch { await devices.close().catch(() => undefined); clearInterval(heartbeat); throw new Error('Could not initialize identity storage.'); }
      try {
        await new Promise<void>((resolve, reject) => {
          httpServer.once('error', reject);
          httpServer.listen(port, host, () => { httpServer.off('error', reject); resolve(); });
        });
      } catch {
        initialized = false; clearInterval(heartbeat); await devices.close();
        throw new Error('Could not bind the signaling port.');
      }
      return httpServer.address() as AddressInfo;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true; stopping = true;
      clearInterval(heartbeat);
      for (const room of rooms.values()) removeRoom(room, false, 'Servidor detenido.');
      for (const client of clients) { release(client); client.socket.terminate(); }
      wss.close();
      if (httpServer.listening) await new Promise<void>((resolve) => { httpServer.close(() => resolve()); httpServer.closeAllConnections(); });
      await Promise.allSettled([...inFlight]);
      await devices.close();
    },
  };
}

export type SignalingServer = ReturnType<typeof createServer>;
