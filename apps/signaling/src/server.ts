import { createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP, type AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { ClientSignalMessageSchema, isCompatibleProtocol, extractSdpFingerprints, isRelaySignal, type ClientSignalMessage, type ServerSignalMessage } from '@ghostpair/protocol';
import { defaultConfig, type ServerConfig } from './config.js';
import { Devices, type DeviceStore } from './devices.js';
import { PostgresDevices } from './postgres-devices.js';
import { RateLimit } from './rate-limit.js';
import { LegacyOpeningSchema, type LegacyOpening } from './legacy-protocol.js';

type Phase = 'idle' | 'authenticating' | 'hosting' | 'paired' | 'detached';
const scryptAsync = promisify<string, Buffer, number, ScryptOptions, Buffer>(scrypt);
interface Client {
  socket: WebSocket;
  ip: string;
  phase: Phase;
  role?: 'host' | 'guest';
  sessionId?: string;
  room?: Room;
  authTimer?: NodeJS.Timeout;
  alive: boolean;
  authAttempt?: symbol;
  messages: RateLimit;
  errors: number;
}
interface Room {
  deviceId: string;
  sessionId: string;
  host: Client;
  guest?: Client;
  legacy: boolean;
  /** Public per-session value used by both peers to derive their keys. */
  kdfSalt?: string;
  verifierSalt: Buffer;
  /** Per-room verifier, never the raw password or authentication token. */
  verifier: Buffer;
  paired: boolean;
  timer: NodeJS.Timeout;
  hostFingerprints?: string[];
  guestFingerprints?: string[];
  offerSent: boolean;
  answerSent: boolean;
  hostIceCount: number;
  guestIceCount: number;
}
interface QueuedAuth {
  client: Client;
  attempt: symbol;
  resolve: (acquired: boolean) => void;
}

export function createServer(overrides: Partial<ServerConfig> = {}, store?: DeviceStore) {
  const config: ServerConfig = { ...defaultConfig, ...overrides };
  const devices = store ?? (config.databaseUrl !== undefined ? new PostgresDevices({ ...config, databaseUrl: config.databaseUrl }) : new Devices(config.databasePath));
  const clients = new Set<Client>();
  const rooms = new Map<string, Room>();
  const authQueue: QueuedAuth[] = [];
  let legacyHashQueue: Promise<void> = Promise.resolve();
  const registrationRate = new RateLimit(config.registrationLimit, config.registrationWindowMs);
  const upgradeIpRate = new RateLimit(config.upgradeIpLimit, config.upgradeWindowMs);
  const authIpRate = new RateLimit(config.authIpLimit, config.authWindowMs);
  // Guests are limited per source and target so a third party cannot lock out the public code for everyone.
  const guestAttemptRate = new RateLimit(config.authDeviceLimit, config.authWindowMs);
  const hostDeviceRate = new RateLimit(config.authDeviceLimit, config.authWindowMs);
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

  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };

  function json(response: ServerResponse, status: number, payload: object): void {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...securityHeaders });
    response.end(JSON.stringify(payload));
  }

  async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'GET' && request.url === '/privacy') {
      const policy = await readFile(new URL('../../../docs/privacy.html', import.meta.url));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", 'Cache-Control': 'no-cache', ...securityHeaders });
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

  function cancelQueuedAuth(client: Client): void {
    const index = authQueue.findIndex(item => item.client === client);
    if (index >= 0) {
      const [removed] = authQueue.splice(index, 1);
      removed!.resolve(false);
    }
  }

  function releaseAuthSlot(): void {
    activeAuth--;
    while (authQueue.length > 0 && activeAuth < config.maxAuthConcurrency) {
      const next = authQueue.shift()!;
      if (currentAttempt(next.client, next.attempt)) {
        activeAuth++;
        next.resolve(true);
        return;
      }
      next.resolve(false);
    }
  }

  function startAuthTimer(client: Client): void {
    clearTimeout(client.authTimer);
    client.authTimer = setTimeout(() => {
      if (client.phase === 'idle' || client.phase === 'authenticating') {
        cancelQueuedAuth(client);
        client.socket.close(1008, 'Authentication timeout');
      }
    }, config.authTimeoutMs);
    client.authTimer.unref();
  }

  function resetClient(client: Client): void {
    cancelQueuedAuth(client);
    client.authAttempt = undefined;
    client.phase = 'idle';
    client.room = undefined;
    client.role = undefined;
    client.sessionId = undefined;
    if (clients.has(client) && client.socket.readyState === WebSocket.OPEN) startAuthTimer(client);
  }

  function removeRoom(room: Room, notify: boolean, reason: string): void {
    if (rooms.get(room.deviceId) !== room) return;
    rooms.delete(room.deviceId);
    clearTimeout(room.timer);
    room.verifier.fill(0);
    room.verifierSalt.fill(0);
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
    cancelQueuedAuth(client);
    client.authAttempt = undefined;
    clients.delete(client);
    clearTimeout(client.authTimer);
    const room = client.room;
    if (room && (room.host === client || room.guest === client)) removeRoom(room, false, 'Signaling disconnected.');
    client.room = undefined;
  }

  /** The token is already a 256-bit KDF output, so a keyed fast hash is enough and uses no memory. */
  function verifierOf(token: string, salt: Buffer): Buffer {
    return createHmac('sha256', salt).update(token, 'utf8').digest();
  }

  function legacyVerifierOf(password: string, salt: Buffer, client: Client, attempt: symbol): Promise<Buffer | undefined> {
    // Preserve 0.6.6's 128 MiB work factor, serializing hashes to fit 512 MiB servers.
    const work = legacyHashQueue.then(() => currentAttempt(client, attempt)
      ? scryptAsync(password, salt, 32, { N: 131_072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }) : undefined);
    legacyHashQueue = work.then(() => undefined, () => undefined);
    return work;
  }

  /** Bounds database authentication and legacy password hashing. */
  async function beginAuth(client: Client): Promise<symbol | undefined> {
    if (stopping || !clients.has(client) || client.socket.readyState !== WebSocket.OPEN) return;
    if (client.phase !== 'idle') { error(client, 'INVALID_STATE', 'This connection already participates in a session.'); return; }
    if (!authIpRate.allow(client.ip)) {
      counters.rateLimited += 1;
      error(client, 'RATE_LIMITED', 'Too many attempts. Try again later.'); return;
    }
    if (activeAuth >= config.maxAuthConcurrency && authQueue.length >= config.maxAuthQueue) {
      error(client, 'SERVER_BUSY', 'The server is busy. Try again.'); return;
    }
    client.phase = 'authenticating';
    const attempt = Symbol('authentication');
    client.authAttempt = attempt;
    if (activeAuth < config.maxAuthConcurrency) {
      activeAuth++;
      return attempt;
    }
    const acquired = await new Promise<boolean>((resolve) => {
      authQueue.push({ client, attempt, resolve });
    });
    if (!acquired) return undefined;
    return attempt;
  }

  function currentAttempt(client: Client, attempt: symbol) {
    return !stopping && clients.has(client) && client.socket.readyState === WebSocket.OPEN && client.phase === 'authenticating' && client.authAttempt === attempt;
  }
  async function openHost(client: Client, message: Extract<ClientSignalMessage | LegacyOpening, { type: 'host.open' }>): Promise<void> {
    const attempt = await beginAuth(client); if (!attempt) return;
    let verifierSalt: Buffer | undefined, verifier: Buffer | undefined;
    try {
      const authenticated = await devices.authenticate(message.deviceId, message.ownerToken);
      if (!currentAttempt(client, attempt)) return;
      if (!authenticated) {
        counters.authFailures += 1; client.phase = 'idle';
        error(client, 'AUTH_FAILED', 'Could not authenticate the device.'); return;
      }
      // Only the authenticated owner is limited per device, so third parties cannot lock the host out.
      if (!hostDeviceRate.allow(message.deviceId)) {
        counters.rateLimited += 1; client.phase = 'idle';
        error(client, 'RATE_LIMITED', 'Too many attempts. Try again later.'); return;
      }
      const legacy = !('protocol' in message);
      verifierSalt = randomBytes(16);
      verifier = legacy ? await legacyVerifierOf(message.password, verifierSalt, client, attempt) : verifierOf(message.password, verifierSalt);
      if (!verifier || !currentAttempt(client, attempt)) return;
      // Check after slow legacy hashing so concurrent openings cannot replace a room or exceed capacity.
      if (rooms.has(message.deviceId)) {
        client.phase = 'idle'; error(client, 'HOST_ALREADY_ACTIVE', 'This device already has a session.'); return;
      }
      if (rooms.size >= config.maxRooms) {
        client.phase = 'idle'; error(client, 'SERVER_BUSY', 'There is no capacity for another session.'); return;
      }
      const sessionId = randomBytes(16).toString('hex');
      const room: Room = {
        deviceId: message.deviceId, sessionId, host: client, legacy, kdfSalt: 'salt' in message ? message.salt : undefined, verifierSalt, verifier, paired: false,
        offerSent: false, answerSent: false, hostIceCount: 0, guestIceCount: 0,
        timer: setTimeout(() => removeRoom(room, true, 'The connection waiting period expired.'), config.waitingRoomTimeoutMs),
      };
      verifier = undefined; verifierSalt = undefined;
      room.timer.unref();
      rooms.set(room.deviceId, room);
      client.phase = 'hosting'; client.role = 'host'; client.sessionId = sessionId; client.room = room;
      clearTimeout(client.authTimer);
      send(client, { type: 'host.ready', deviceId: message.deviceId, sessionId });
    } catch {
      counters.internalErrors++;
      if (currentAttempt(client, attempt)) { client.phase = 'idle'; error(client, 'SERVER_BUSY', 'Identity storage is unavailable. Try again later.'); }
    } finally {
      verifier?.fill(0); verifierSalt?.fill(0);
      releaseAuthSlot();
      if (client.authAttempt === attempt) client.authAttempt = undefined;
    }
  }

  /** A guest handshake is only valid on a live, idle connection. */
  function canStartGuestFlow(client: Client): boolean {
    if (stopping || !clients.has(client) || client.socket.readyState !== WebSocket.OPEN) return false;
    if (client.phase !== 'idle') { error(client, 'INVALID_STATE', 'This connection already participates in a session.'); return false; }
    return true;
  }

  /** Returns the public per-session salt so the guest can derive its keys before joining. */
  function challengeGuest(client: Client, message: Extract<ClientSignalMessage, { type: 'guest.challenge' }>): void {
    if (!canStartGuestFlow(client)) return;
    if (!authIpRate.allow(client.ip)) {
      counters.rateLimited += 1;
      error(client, 'RATE_LIMITED', 'Too many attempts. Try again later.'); return;
    }
    const room = rooms.get(message.deviceId);
    if (!room || room.paired || room.host.socket.readyState !== WebSocket.OPEN) {
      error(client, 'SESSION_UNAVAILABLE', 'The session is unavailable.'); return;
    }
    if (room.legacy || !room.kdfSalt) {
      error(client, 'INCOMPATIBLE_PROTOCOL', 'The session uses a different compatibility mode. Check the 0.6.6 option in Connection settings on GhostPair 0.7.'); return;
    }
    send(client, { type: 'guest.salt', deviceId: message.deviceId, salt: room.kdfSalt });
  }

  async function joinGuest(client: Client, message: Extract<ClientSignalMessage | LegacyOpening, { type: 'guest.join' }>): Promise<void> {
    if (!canStartGuestFlow(client)) return;
    if (!guestAttemptRate.allow(`${client.ip}|${message.deviceId}`)) {
      counters.rateLimited += 1;
      error(client, 'RATE_LIMITED', 'Too many attempts. Try again later.'); return;
    }
    const room = rooms.get(message.deviceId);
    if (!room || room.paired || room.host.socket.readyState !== WebSocket.OPEN) {
      error(client, 'SESSION_UNAVAILABLE', 'The session is unavailable.'); return;
    }
    if (room.legacy !== !('protocol' in message)) {
      error(client, 'INCOMPATIBLE_PROTOCOL', 'The session uses a different compatibility mode. Check the 0.6.6 option in Connection settings on GhostPair 0.7.'); return;
    }
    let attempt: symbol | undefined, candidate: Buffer | undefined;
    try {
      if (room.legacy) {
        attempt = await beginAuth(client); if (!attempt) return;
        if (!currentAttempt(client, attempt)) return;
        candidate = await legacyVerifierOf(message.password, room.verifierSalt, client, attempt);
        if (!candidate || !currentAttempt(client, attempt)) return;
      } else candidate = verifierOf(message.password, room.verifierSalt);
      if (rooms.get(message.deviceId) !== room || room.paired || room.host.socket.readyState !== WebSocket.OPEN) {
        client.phase = 'idle'; error(client, 'SESSION_UNAVAILABLE', 'The session is unavailable.'); return;
      }
      const matches = timingSafeEqual(candidate, room.verifier);
      if (!matches) {
        client.phase = 'idle';
        counters.authFailures += 1;
        error(client, 'AUTH_FAILED', 'Could not authenticate the connection.'); return;
      }
      room.paired = true;
      room.guest = client;
      room.verifier.fill(0); room.verifierSalt.fill(0);
      clearTimeout(room.timer); clearTimeout(client.authTimer);
      room.timer = setTimeout(() => removeRoom(room, false, 'Signaling window completed.'), config.pairedRoomTimeoutMs);
      room.timer.unref();
      client.phase = 'paired'; client.role = 'guest'; client.sessionId = room.sessionId; client.room = room;
      room.host.phase = 'paired';
      counters.sessionsPaired += 1;
      send(client, { type: 'paired', role: 'guest', sessionId: room.sessionId });
      send(room.host, { type: 'paired', role: 'host', sessionId: room.sessionId });
    } catch {
      counters.internalErrors++;
      if (attempt && currentAttempt(client, attempt)) {
        client.phase = 'idle'; error(client, 'SERVER_BUSY', 'Could not verify the password.');
      }
    } finally {
      candidate?.fill(0);
      if (attempt) {
        releaseAuthSlot();
        if (client.authAttempt === attempt) client.authAttempt = undefined;
      }
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
    const opening = input !== null && typeof input === 'object' ? input as { type?: unknown; protocol?: unknown } : undefined;
    if (opening && !('protocol' in opening) && (opening.type === 'host.open' || opening.type === 'guest.join')) {
      const legacy = LegacyOpeningSchema.safeParse(input);
      if (legacy.success) {
        if (legacy.data.type === 'host.open') await openHost(client, legacy.data);
        else await joinGuest(client, legacy.data);
        return;
      }
    }
    if (opening && ['host.open', 'guest.challenge', 'guest.join'].includes(String(opening.type)) && ('protocol' in opening || opening.type === 'guest.challenge') && !isCompatibleProtocol(opening.protocol)) {
      error(client, 'INCOMPATIBLE_PROTOCOL', 'The extension and signaling server use incompatible connection protocols. Update the extension or server.'); return;
    }
    const parsed = ClientSignalMessageSchema.safeParse(input);
    if (!parsed.success) {
      counters.protocolErrors += 1;
      error(client, 'INVALID_MESSAGE', 'Invalid message.');
      if (++client.errors >= config.maxProtocolErrorsPerSocket) client.socket.close(1008, 'Invalid message');
      return;
    }
    const message = parsed.data;
    if (message.type === 'ping') { send(client, { type: 'pong', id: message.id }); return; }
    if (message.type === 'host.open') { await openHost(client, message); return; }
    if (message.type === 'guest.challenge') { challengeGuest(client, message); return; }
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
    if (message.payload.type === 'offer') {
      const fingerprints = extractSdpFingerprints(message.payload.sdp);
      if (room.offerSent || fingerprints.length === 0) {
        counters.protocolErrors += 1;
        error(client, 'FORBIDDEN', 'This signal is not allowed.'); return;
      }
      room.offerSent = true;
      room.hostFingerprints = fingerprints;
    } else if (message.payload.type === 'answer') {
      const fingerprints = extractSdpFingerprints(message.payload.sdp);
      if (!room.offerSent || room.answerSent || fingerprints.length === 0 || fingerprints.some(fp => room.hostFingerprints?.includes(fp))) {
        counters.protocolErrors += 1;
        error(client, 'FORBIDDEN', 'This signal is not allowed.'); return;
      }
      room.answerSent = true;
      room.guestFingerprints = fingerprints;
    } else {
      const count = client.role === 'host' ? ++room.hostIceCount : ++room.guestIceCount;
      if (count > config.maxIceCandidatesPerPeer) {
        counters.rateLimited += 1;
        error(client, 'RATE_LIMITED', 'Too many ICE candidates.'); return;
      }
    }
    const peer = client.role === 'host' ? room.guest : room.host;
    const payload = room.legacy && (message.payload.type === 'offer' || message.payload.type === 'answer')
      ? { type: message.payload.type, sdp: message.payload.sdp } : message.payload;
    if (peer) { send(peer, { type: 'signal', sessionId: room.sessionId, payload }); counters.signalingMessages += 1; }
  }

  httpServer.on('upgrade', (request, socket, head) => {
    const ip = requestIp(request);
    const originOk = allowedOrigin(request.headers.origin);
    if (!originOk || stopping || request.url !== '/v1/connect') {
      const status = !originOk ? '403 Forbidden' : '503 Service Unavailable';
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return;
    }
    if (!upgradeIpRate.allow(ip)) {
      counters.rateLimited += 1;
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
    }
    if (clients.size >= config.maxConnections || [...clients].filter((client) => client.ip === ip).length >= config.maxConnectionsPerIp) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const client: Client = { socket: ws, ip, phase: 'idle', alive: true, messages: new RateLimit(config.socketMessageLimit, config.socketMessageWindowMs, 1), errors: 0 };
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
