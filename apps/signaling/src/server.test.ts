import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, MIN_SUPPORTED_PROTOCOL_VERSION, ServerSignalMessageSchema, type ClientSignalMessage, type ServerSignalMessage } from '@ghostpair/protocol';
import { createServer, type SignalingServer } from './server.js';
import type { ServerConfig } from './config.js';
import { Devices, type DeviceStore } from './devices.js';

const origin = `chrome-extension://${'a'.repeat(32)}`;
// Protocol 6 sends a derived authentication token; legacy protocol 4 sends a human password.
const password = 'a1'.repeat(32);
const wrongPassword = 'e2'.repeat(32);
const salt = '0123456789abcdef0123456789abcdef';
type Identity = { deviceId: string; ownerToken: string };
const hostOpen = (identity: Identity, overrides: Partial<Extract<ClientSignalMessage, { type: 'host.open' }>> = {}): ClientSignalMessage => ({ type: 'host.open', protocol: PROTOCOL_VERSION, ...identity, salt, password, ...overrides });
const guestChallenge = (deviceId: string): ClientSignalMessage => ({ type: 'guest.challenge', protocol: PROTOCOL_VERSION, deviceId });
const guestJoin = (deviceId: string, token = password): ClientSignalMessage => ({ type: 'guest.join', protocol: PROTOCOL_VERSION, deviceId, password: token });
const legacyOpen = (identity: Identity) => ({ type: 'host.open' as const, ...identity, password: 'Eight-42' });
const legacyJoin = (deviceId: string, password = 'Eight-42') => ({ type: 'guest.join' as const, deviceId, password });
const offerSdp = `v=0\r\na=fingerprint:sha-256 ${'AA:'.repeat(31)}01\r\n`;
const answerSdp = `v=0\r\na=fingerprint:sha-256 ${'BB:'.repeat(31)}02\r\n`;
const servers: SignalingServer[] = [];
const sockets: WebSocket[] = [];
const temporaryDirectories: string[] = [];

class Peer {
  readonly history: ServerSignalMessage[] = [];
  private readonly pending: ServerSignalMessage[] = [];
  private readonly waiters: { type: string; resolve: (message: ServerSignalMessage) => void }[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = ServerSignalMessageSchema.parse(JSON.parse(data.toString()));
      this.history.push(message);
      const index = this.waiters.findIndex((waiter) => waiter.type === message.type);
      if (index >= 0) this.waiters.splice(index, 1)[0].resolve(message);
      else this.pending.push(message);
    });
    // A disconnected test client may encounter ECONNRESET during server cleanup.
    socket.on('error', () => {});
  }

  send(message: ClientSignalMessage | ReturnType<typeof legacyOpen> | ReturnType<typeof legacyJoin>): void { this.socket.send(JSON.stringify(message)); }

  async next<T extends ServerSignalMessage['type']>(type: T): Promise<Extract<ServerSignalMessage, { type: T }>> {
    const index = this.pending.findIndex((message) => message.type === type);
    if (index >= 0) return this.pending.splice(index, 1)[0] as Extract<ServerSignalMessage, { type: T }>;
    return new Promise((resolve, reject) => {
      const waiter = {
        type,
        resolve: (message: ServerSignalMessage) => { clearTimeout(timer); resolve(message as Extract<ServerSignalMessage, { type: T }>); },
      };
      const timer = setTimeout(() => {
        const waiting = this.waiters.indexOf(waiter);
        if (waiting >= 0) this.waiters.splice(waiting, 1);
        reject(new Error(`Timed out waiting for ${type}`));
      }, 5000);
      this.waiters.push(waiter);
    });
  }
}

async function start(overrides: Partial<ServerConfig> = {}, store?: DeviceStore) {
  const server = createServer({ databasePath: ':memory:', port: 0, ...overrides }, store);
  servers.push(server);
  const address = await server.listen();
  const base = `http://127.0.0.1:${address.port}`;
  return {
    server,
    base,
    async register(requestOrigin = origin) {
      const response = await fetch(`${base}/v1/devices`, { method: 'POST', headers: { Origin: requestOrigin } });
      expect(response.status).toBe(201);
      return await response.json() as { deviceId: string; ownerToken: string };
    },
    async connect(requestOrigin = origin, headers: Record<string, string> = {}) {
      const socket = new WebSocket(`${base.replace('http:', 'ws:')}/v1/connect`, { origin: requestOrigin, headers });
      sockets.push(socket);
      const peer = new Peer(socket);
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      return peer;
    },
  };
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const server of servers.splice(0)) await server.close();
  for (const directory of temporaryDirectories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir(), 'ghostpair-signaling-'))) throw new Error('Unexpected test directory');
    await rm(directory, { recursive: true, force: true });
  }
});

describe('signaling security and lifecycle', () => {
  it('accepts different Chrome/Edge IDs for registration, preflight and WebSocket authentication without configuration', async () => {
    const app = await start();
    for (const accepted of [origin, `chrome-extension://${'p'.repeat(32)}`]) {
      const preflight = await fetch(`${app.base}/v1/devices`, { method: 'OPTIONS', headers: { Origin: accepted } });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(accepted);
      expect(preflight.headers.get('access-control-allow-methods')).toBe('POST');
      expect(preflight.headers.get('vary')).toBe('Origin');
      const response = await fetch(`${app.base}/v1/devices`, { method: 'POST', headers: { Origin: accepted } });
      expect(response.status).toBe(201);
      expect(response.headers.get('access-control-allow-origin')).toBe(accepted);
      expect(response.headers.get('vary')).toBe('Origin');
      const identity = await response.json() as { deviceId: string; ownerToken: string };
      const peer = await app.connect(accepted);
      peer.send(hostOpen(identity));
      expect((await peer.next('host.ready')).deviceId).toBe(identity.deviceId);
    }
    expect(await (await fetch(`${app.base}/health`)).json()).toEqual({ status: 'ok' });
  });

  it('rejects web, absent and malformed origins for HTTP and WebSocket', async () => {
    const app = await start();
    for (const rejected of [undefined, 'null', '*', 'https://example.com', 'http://localhost:8787',
      `${origin}.evil`, `${origin}/`, `${origin}?query=1`, `${origin}#fragment`, `${origin}:1234`,
      `chrome-extension://${'a'.repeat(31)}`, `chrome-extension://${'a'.repeat(33)}`,
      `chrome-extension://${'q'.repeat(32)}`, `chrome-extension://${'A'.repeat(32)}`,
      `https://${'a'.repeat(32)}`, `chrome-extension://user@${'a'.repeat(32)}`]) {
      for (const method of ['POST', 'OPTIONS']) {
        const response = await fetch(`${app.base}/v1/devices`, { method, headers: rejected ? { Origin: rejected } : {} });
        expect(response.status).toBe(403);
        expect(response.headers.has('access-control-allow-origin')).toBe(false);
      }
      const socket = new WebSocket(`${app.base.replace('http:', 'ws:')}/v1/connect`, rejected ? { origin: rejected } : {});
      sockets.push(socket);
      socket.on('error', () => {});
      const status = await new Promise<number | undefined>((resolve) => {
        socket.once('unexpected-response', (_request, result) => { result.resume(); resolve(result.statusCode); socket.terminate(); });
      });
      expect(status).toBe(403);
    }
  });

  it('allows exact loopback HTTP origins only with the development opt-in', async () => {
    const app = await start({ allowLocalhostOrigins: true });
    for (const accepted of ['http://localhost:8787', 'http://127.0.0.1:3000', 'http://[::1]:8787']) {
      const identity = await app.register(accepted);
      const preflight = await fetch(`${app.base}/v1/devices`, { method: 'OPTIONS', headers: { Origin: accepted } });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(accepted);
      const peer = await app.connect(accepted);
      peer.send(hostOpen(identity));
      expect((await peer.next('host.ready')).deviceId).toBe(identity.deviceId);
    }
    for (const rejected of ['http://localhost.evil:8787', 'http://localhost:8787/path', 'https://localhost:8787', 'http://user@localhost:8787']) {
      expect((await fetch(`${app.base}/v1/devices`, { method: 'POST', headers: { Origin: rejected } })).status).toBe(403);
    }
  });

  it('persists the device identity while storing only an owner-token hash', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ghostpair-signaling-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'devices.sqlite');
    const first = await start({ databasePath });
    const identity = await first.register();
    expect(identity.deviceId).toMatch(/^[0-9a-f]{32}$/);
    expect(identity.ownerToken).toMatch(/^[0-9a-f]{64}$/);
    await first.server.close();
    const db = new DatabaseSync(databasePath);
    const record = db.prepare('SELECT * FROM devices').get();
    expect(record?.device_id).toBe(identity.deviceId);
    expect(record?.owner_token_hash).not.toBe(identity.ownerToken);
    expect(Object.keys(record!)).toEqual(['device_id', 'owner_token_hash', 'created_at']);
    db.close();
    const second = await start({ databasePath });
    const host = await second.connect();
    host.send(hostOpen(identity));
    expect((await host.next('host.ready')).deviceId).toBe(identity.deviceId);
  });

  it('authenticates both roles before forwarding signaling and permits only the host to end', async () => {
      const app = await start();
    const identity = await app.register();
    const host = await app.connect();
    host.send(hostOpen(identity, { ownerToken: 'f'.repeat(64) }));
    expect((await host.next('error')).code).toBe('AUTH_FAILED');
    host.send(hostOpen(identity));
    const ready = await host.next('host.ready');
    const guest = await app.connect();
    guest.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'offer', sdp: 'unauthenticated' } });
    expect((await guest.next('error')).code).toBe('FORBIDDEN');
    guest.send(guestJoin(identity.deviceId, wrongPassword));
    expect((await guest.next('error')).code).toBe('AUTH_FAILED');
    expect(host.history.some((message) => message.type === 'paired' || message.type === 'signal')).toBe(false);
    guest.send(guestJoin(identity.deviceId));
    expect(await guest.next('paired')).toEqual({ type: 'paired', role: 'guest', sessionId: ready.sessionId });
    expect((await host.next('paired')).role).toBe('host');
    host.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'offer', sdp: offerSdp } });
    expect((await guest.next('signal')).payload).toEqual({ type: 'offer', sdp: offerSdp });
    guest.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'answer', sdp: answerSdp } });
    expect((await host.next('signal')).payload.type).toBe('answer');
    guest.send({ type: 'host.close', sessionId: ready.sessionId });
    expect((await guest.next('error')).code).toBe('FORBIDDEN');
    host.send({ type: 'host.close', sessionId: ready.sessionId });
    expect((await host.next('ended')).sessionId).toBe(ready.sessionId);
    expect((await guest.next('ended')).sessionId).toBe(ready.sessionId);
    expect(app.server.stats.activeRooms).toBe(0);
  });

  it('isolates sessions, enforces offer/answer roles, and rejects relay candidates', async () => {
    const app = await start();
    const [firstIdentity, secondIdentity] = await Promise.all([app.register(), app.register()]);
    const [host, guest, otherHost] = await Promise.all([app.connect(), app.connect(), app.connect()]);
    host.send(hostOpen(firstIdentity));
    const ready = await host.next('host.ready');
    otherHost.send(hostOpen(secondIdentity));
    const otherReady = await otherHost.next('host.ready');
    guest.send(guestJoin(firstIdentity.deviceId));
    await guest.next('paired'); await host.next('paired');
    host.send({ type: 'signal', sessionId: otherReady.sessionId, payload: { type: 'offer', sdp: 'v=0' } });
    expect((await host.next('error')).code).toBe('FORBIDDEN');
    host.send({ type: 'host.close', sessionId: otherReady.sessionId });
    expect((await host.next('error')).code).toBe('FORBIDDEN');
    guest.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'offer', sdp: 'v=0' } });
    expect((await guest.next('error')).code).toBe('FORBIDDEN');
    host.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'answer', sdp: 'v=0' } });
    expect((await host.next('error')).code).toBe('FORBIDDEN');
    host.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'ice', candidate: { candidate: 'candidate:1 1 UDP 1 1.2.3.4 443 typ relay' } } });
    expect((await host.next('error')).code).toBe('FORBIDDEN');
    expect(otherHost.history.some((message) => message.type === 'signal' || message.type === 'ended')).toBe(false);
    expect(app.server.stats.activeRooms).toBe(2);
  });

  it('reserves the guest position atomically and never admits a third participant', async () => {
    const app = await start();
    const identity = await app.register();
    const [host, firstGuest, secondGuest] = await Promise.all([app.connect(), app.connect(), app.connect()]);
    host.send(hostOpen(identity)); await host.next('host.ready');
    firstGuest.send(guestJoin(identity.deviceId));
    secondGuest.send(guestJoin(identity.deviceId));
    await vi.waitUntil(() => firstGuest.history.length > 0 && secondGuest.history.length > 0, { timeout: 5000, interval: 2 });
    const both = [...firstGuest.history, ...secondGuest.history];
    expect(both.filter((message) => message.type === 'paired')).toHaveLength(1);
    expect(both.filter((message) => message.type === 'error' && message.code === 'SESSION_UNAVAILABLE')).toHaveLength(1);
    expect(app.server.stats.sessionsPaired).toBe(1);
  });

  it('does not send ended when signaling disconnects after pairing', async () => {
    const app = await start();
    const identity = await app.register();
    const [host, guest] = await Promise.all([app.connect(), app.connect()]);
    host.send(hostOpen(identity)); const ready = await host.next('host.ready');
    guest.send(guestJoin(identity.deviceId));
    await guest.next('paired'); await host.next('paired');
    guest.socket.close();
    await vi.waitUntil(() => app.server.stats.activeRooms === 0, { timeout: 5000, interval: 2 });
    host.send({ type: 'ping', id: 'after-disconnection' }); await host.next('pong');
    expect(host.history.some((message) => message.type === 'ended')).toBe(false);
    host.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'ice', candidate: null } });
    expect((await host.next('error')).code).toBe('SIGNAL_UNAVAILABLE');
    host.send({ type: 'host.close', sessionId: ready.sessionId });
    expect((await host.next('ended')).sessionId).toBe(ready.sessionId);
  });

  it('returns the per-session salt on guest.challenge and rejects guest.join if the host closes before it arrives', async () => {
    const app = await start();
    const identity = await app.register();
    const [host, guest] = await Promise.all([app.connect(), app.connect()]);
    guest.send(guestChallenge(identity.deviceId));
    expect((await guest.next('error')).code).toBe('SESSION_UNAVAILABLE');
    host.send(hostOpen(identity)); const ready = await host.next('host.ready');
    guest.send(guestChallenge(identity.deviceId));
    expect(await guest.next('guest.salt')).toEqual({ type: 'guest.salt', deviceId: identity.deviceId, salt });
    host.send({ type: 'host.close', sessionId: ready.sessionId });
    await host.next('ended');
    guest.send(guestJoin(identity.deviceId));
    expect((await guest.next('error')).code).toBe('SESSION_UNAVAILABLE');
    expect(app.server.stats.activeRooms).toBe(0);
    expect(app.server.stats.sessionsPaired).toBe(0);
    expect(guest.history.some((message) => message.type === 'paired')).toBe(false);
  });

  it('cannot create a room after its opening host disconnects', async () => {
    const store = new Devices(':memory:'), lookup = Promise.withResolvers<boolean>();
    const originalAuth = store.authenticate.bind(store);
    store.authenticate = vi.fn().mockImplementationOnce(() => lookup.promise).mockImplementation(originalAuth);
    const app = await start({}, store);
    const identity = await app.register();
    const host = await app.connect();
    host.send(hostOpen(identity));
    await vi.waitUntil(() => app.server.stats.activeAuth === 1, { timeout: 5000, interval: 2 });
    host.socket.terminate();
    await vi.waitUntil(() => app.server.stats.activeConnections === 0, { timeout: 5000, interval: 2 });
    lookup.resolve(true);
    await vi.waitUntil(() => app.server.stats.activeAuth === 0, { timeout: 5000, interval: 2 });
    expect(app.server.stats.activeRooms).toBe(0);
    const replacement = await app.connect();
    replacement.send(hostOpen(identity));
    expect((await replacement.next('host.ready')).deviceId).toBe(identity.deviceId);
  });

  it('bounds device registration, authentication attempts, messages and idle sockets', async () => {
    const app = await start({ registrationLimit: 1, authIpLimit: 2, authDeviceLimit: 2, socketMessageLimit: 2, authTimeoutMs: 150 });
    const identity = await app.register();
    expect((await fetch(`${app.base}/v1/devices`, { method: 'POST', headers: { Origin: origin } })).status).toBe(429);
    const peer = await app.connect();
    for (let i = 0; i < 2; i += 1) {
      peer.send(guestJoin(identity.deviceId));
      expect((await peer.next('error')).code).toBe('SESSION_UNAVAILABLE');
    }
    const another = await app.connect();
    another.send(guestJoin(identity.deviceId));
    expect((await another.next('error')).code).toBe('RATE_LIMITED');
    peer.send({ type: 'ping', id: 'over-limit' });
    expect((await peer.next('error')).code).toBe('RATE_LIMITED');
    await vi.waitUntil(() => app.server.stats.activeConnections === 0, { timeout: 5000, interval: 2 });
    expect(app.server.stats.rateLimited).toBe(3);
  });

  it('expires waiting rooms and permits a new session afterwards', async () => {
    const app = await start({ waitingRoomTimeoutMs: 50 });
    const identity = await app.register();
    const host = await app.connect();
    host.send(hostOpen(identity)); const first = await host.next('host.ready');
    expect((await host.next('ended')).sessionId).toBe(first.sessionId);
    host.send(hostOpen(identity));
    expect((await host.next('host.ready')).sessionId).not.toBe(first.sessionId);
  });

  it('caps concurrent host authentications globally and releases capacity after completion', async () => {
    const store = new Devices(':memory:'), lookup = Promise.withResolvers<boolean>();
    const originalAuth = store.authenticate.bind(store);
    store.authenticate = vi.fn().mockImplementationOnce(() => lookup.promise).mockImplementation(originalAuth);
    const app = await start({ maxAuthConcurrency: 1, maxAuthQueue: 0 }, store);
    const [one, two] = await Promise.all([app.register(), app.register()]);
    const [first, second] = await Promise.all([app.connect(), app.connect()]);
    first.send(hostOpen(one));
    await vi.waitUntil(() => app.server.stats.activeAuth === 1, { timeout: 5000, interval: 2 });
    second.send(hostOpen(two));
    expect((await second.next('error')).code).toBe('SERVER_BUSY');
    lookup.resolve(true);
    await first.next('host.ready');
    second.send(hostOpen(two));
    expect((await second.next('host.ready')).deviceId).toBe(two.deviceId);
    expect(app.server.stats.activeAuth).toBe(0);
  });

  it('caps registered devices and rooms and prevents a second host claiming an active device', async () => {
    const app = await start({ maxRooms: 1, maxRegisteredDevices: 2 });
    const [one, two] = await Promise.all([app.register(), app.register()]);
    expect((await fetch(`${app.base}/v1/devices`, { method: 'POST', headers: { Origin: origin } })).status).toBe(503);
    const [first, second] = await Promise.all([app.connect(), app.connect()]);
    first.send(hostOpen(one)); await first.next('host.ready');
    second.send(hostOpen(one));
    expect((await second.next('error')).code).toBe('HOST_ALREADY_ACTIVE');
    second.send(hostOpen(two));
    expect((await second.next('error')).code).toBe('SERVER_BUSY');
    expect(app.server.stats.activeRooms).toBe(1);
  });

  it('does not let an untrusted forwarded address bypass per-IP registration limits', async () => {
    const app = await start({ registrationLimit: 1 });
    await app.register();
    const response = await fetch(`${app.base}/v1/devices`, { method: 'POST', headers: { Origin: origin, 'X-Forwarded-For': '203.0.113.50' } });
    expect(response.status).toBe(429);
  });
});

it('reserves authentication capacity before asynchronous identity lookup and rejects disconnected completions', async () => {
  const store = new Devices(':memory:'), lookup = Promise.withResolvers<boolean>();
  store.authenticate = vi.fn(() => lookup.promise);
  const app = await start({ maxAuthConcurrency: 1, maxAuthQueue: 0 }, store);
  const identity = await app.register(), first = await app.connect(), second = await app.connect();
  first.send(hostOpen(identity));
  await vi.waitUntil(() => app.server.stats.activeAuth === 1, { timeout: 5000, interval: 2 });
  second.send(hostOpen(identity));
  expect((await second.next('error')).code).toBe('SERVER_BUSY');
  expect(store.authenticate).toHaveBeenCalledTimes(1);
  first.socket.close(); await vi.waitUntil(() => first.socket.readyState === WebSocket.CLOSED, { timeout: 5000, interval: 2 });
  lookup.resolve(true); await vi.waitUntil(() => app.server.stats.activeAuth === 0, { timeout: 5000, interval: 2 });
  expect(app.server.stats.activeRooms).toBe(0);
});

it('does not resurrect authentication after the socket timeout', async () => {
  const store = new Devices(':memory:'), lookup = Promise.withResolvers<boolean>(); store.authenticate = () => lookup.promise;
  const app = await start({ authTimeoutMs: 75 }, store), identity = await app.register(), peer = await app.connect();
  peer.send(hostOpen(identity));
  await vi.waitUntil(() => peer.socket.readyState === WebSocket.CLOSED, { timeout: 5000, interval: 2 });
  lookup.resolve(true); await vi.waitUntil(() => app.server.stats.activeAuth === 0, { timeout: 5000, interval: 2 });
  expect(app.server.stats.activeRooms).toBe(0);
});

it('drains pending identity work before closing storage on shutdown', async () => {
  const store = new Devices(':memory:'), lookup = Promise.withResolvers<boolean>(); store.authenticate = () => lookup.promise;
  const close = vi.spyOn(store, 'close');
  const app = await start({}, store), identity = await app.register(), peer = await app.connect();
  peer.send(hostOpen(identity)); await vi.waitUntil(() => app.server.stats.activeAuth === 1, { timeout: 5000, interval: 2 });
  const stopping = app.server.close(); expect(close).not.toHaveBeenCalled();
  lookup.resolve(true); await stopping;
  expect(close).toHaveBeenCalledOnce(); expect(app.server.stats.activeRooms).toBe(0);
});

it('reports storage outages without leaking errors and recovers registration and readiness', async () => {
  const store = new Devices(':memory:'), check = vi.spyOn(store, 'check').mockRejectedValue(new Error('private connection data'));
  const register = vi.spyOn(store, 'register').mockRejectedValue(new Error('private connection data'));
  const app = await start({}, store);
  for (const response of await Promise.all(Array.from({ length: 8 }, () => fetch(app.base + '/ready')))) {
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private');
  }
  expect(check).toHaveBeenCalledOnce();
  const failed = await fetch(app.base + '/v1/devices', { method: 'POST', headers: { Origin: origin } });
  expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('private');
  check.mockRestore(); register.mockRestore();
  const identity = await app.register();
  const auth = vi.spyOn(store, 'authenticate').mockRejectedValueOnce(new Error('private credentials'));
  const peer = await app.connect(); peer.send(hostOpen(identity));
  expect((await peer.next('error')).code).toBe('SERVER_BUSY');
  peer.send(hostOpen(identity)); expect((await peer.next('host.ready')).deviceId).toBe(identity.deviceId);
  expect(auth).toHaveBeenCalledTimes(2);
  await new Promise(done => setTimeout(done, 1050)); expect((await fetch(app.base + '/ready')).status).toBe(200);
});

it('does not listen or fall back when storage initialization fails', async () => {
  const store = new Devices(':memory:'); vi.spyOn(store, 'initialize').mockRejectedValue(new Error('private database URL'));
  const close = vi.spyOn(store, 'close'); const server = createServer({ port: 0 }, store); servers.push(server);
  await expect(server.listen()).rejects.toThrow('initialize identity storage');
  expect(server.httpServer.listening).toBe(false); expect(close).toHaveBeenCalledOnce();
});

it('serves the privacy document directly without Caddy', async () => {
  const app = await start(), response = await fetch(app.base + '/privacy');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/html');
  expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(response.headers.get('strict-transport-security')).toContain('max-age=63072000');
  expect(await response.text()).toContain('GhostPair privacy');
});

it('enforces DTLS fingerprint presence, prevents fingerprint reflection, and caps offer/answer/ICE quotas', async () => {
  const app = await start({ maxIceCandidatesPerPeer: 2 });
  const identity = await app.register();
  const [host, guest] = await Promise.all([app.connect(), app.connect()]);
  host.send(hostOpen(identity));
  const ready = await host.next('host.ready');
  guest.send(guestJoin(identity.deviceId));
  await guest.next('paired'); await host.next('paired');

  // Reject answer before offer and offer without a valid DTLS fingerprint.
  guest.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'answer', sdp: answerSdp } });
  expect((await guest.next('error')).code).toBe('FORBIDDEN');
  host.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'offer', sdp: 'v=0' } });
  expect((await host.next('error')).code).toBe('FORBIDDEN');

  // Accept first valid offer and reject a duplicate offer.
  host.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'offer', sdp: offerSdp } });
  expect((await guest.next('signal')).payload).toEqual({ type: 'offer', sdp: offerSdp });
  host.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'offer', sdp: offerSdp } });
  expect((await host.next('error')).code).toBe('FORBIDDEN');

  // Reject reflected host fingerprint in guest answer, then accept distinct guest fingerprint once.
  guest.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'answer', sdp: offerSdp } });
  expect((await guest.next('error')).code).toBe('FORBIDDEN');
  guest.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'answer', sdp: answerSdp } });
  expect((await host.next('signal')).payload).toEqual({ type: 'answer', sdp: answerSdp });
  guest.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'answer', sdp: answerSdp } });
  expect((await guest.next('error')).code).toBe('FORBIDDEN');

  // Cap ICE candidates per peer.
  for (let i = 0; i < 2; i++) {
    host.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'ice', candidate: { candidate: `candidate:${i} 1 udp 1 192.0.2.1 9999 typ host` } } });
    expect((await guest.next('signal')).payload.type).toBe('ice');
  }
  host.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'ice', candidate: null } });
  expect((await host.next('error')).code).toBe('RATE_LIMITED');
});

it('queues burst authentications in FIFO order and drops disconnected queued clients', async () => {
  const store = new Devices(':memory:'), gate = Promise.withResolvers<void>();
  const originalAuth = store.authenticate.bind(store);
  store.authenticate = vi.fn(async (deviceId: string, ownerToken: string) => {
    await gate.promise;
    return originalAuth(deviceId, ownerToken);
  });
  const app = await start({ maxAuthConcurrency: 1, maxAuthQueue: 2 }, store);
  const [one, two, three, four] = await Promise.all([app.register(), app.register(), app.register(), app.register()]);
  const [c1, c2, c3, c4] = await Promise.all([app.connect(), app.connect(), app.connect(), app.connect()]);
  c1.send(hostOpen(one));
  await vi.waitUntil(() => app.server.stats.activeAuth === 1, { timeout: 5000, interval: 2 });
  c2.send(hostOpen(two));
  c3.send(hostOpen(three));
  c4.send(hostOpen(four));
  expect((await c4.next('error')).code).toBe('SERVER_BUSY');
  c2.socket.terminate();
  await vi.waitUntil(() => c2.socket.readyState === WebSocket.CLOSED, { timeout: 5000, interval: 2 });
  gate.resolve();
  expect((await c1.next('host.ready')).deviceId).toBe(one.deviceId);
  expect((await c3.next('host.ready')).deviceId).toBe(three.deviceId);
  await vi.waitUntil(() => app.server.stats.activeAuth === 0, { timeout: 5000, interval: 2 });
  expect(app.server.stats.activeRooms).toBe(2);
});

it.each([...new Set([MIN_SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION])])('pairs supported protocol %i with the oldest supported client and forwards signaling', async protocol => {
  const app = await start();
  const identity = await app.register();
  const host = await app.connect();
  host.send(hostOpen(identity, { protocol }));
  const ready = await host.next('host.ready');
  const guest = await app.connect();
  guest.send({ ...guestChallenge(identity.deviceId), protocol: MIN_SUPPORTED_PROTOCOL_VERSION });
  expect((await guest.next('guest.salt')).salt).toBe(salt);
  guest.send({ ...guestJoin(identity.deviceId, wrongPassword), protocol: MIN_SUPPORTED_PROTOCOL_VERSION });
  expect((await guest.next('error')).code).toBe('AUTH_FAILED');
  guest.send({ ...guestJoin(identity.deviceId), protocol: MIN_SUPPORTED_PROTOCOL_VERSION });
  expect((await guest.next('paired')).sessionId).toBe(ready.sessionId);
  await host.next('paired');
  host.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'offer', sdp: offerSdp } });
  expect((await guest.next('signal')).payload).toEqual({ type: 'offer', sdp: offerSdp });
  guest.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'answer', sdp: answerSdp } });
  expect((await host.next('signal')).payload).toEqual({ type: 'answer', sdp: answerSdp });
});

it('rejects explicit unsupported handshake protocol versions with INCOMPATIBLE_PROTOCOL without closing the socket', async () => {
  const app = await start({ maxProtocolErrorsPerSocket: 1 });
  const identity = await app.register();
  const peer = await app.connect();
  for (const outdated of [
    { type: 'host.open', protocol: 4, ...identity, password: 'Eight-42' },
    { type: 'host.open', protocol: MIN_SUPPORTED_PROTOCOL_VERSION - 1, ...identity, salt, password },
    { type: 'guest.challenge', protocol: MIN_SUPPORTED_PROTOCOL_VERSION - 1, deviceId: identity.deviceId },
    { type: 'guest.join', protocol: PROTOCOL_VERSION + 1, deviceId: identity.deviceId, password },
  ]) {
    peer.socket.send(JSON.stringify(outdated));
    const err = await peer.next('error');
    expect(err.code).toBe('INCOMPATIBLE_PROTOCOL');
    expect(err.message).toBe('The extension and signaling server use incompatible connection protocols. Update the extension or server.');
  }
  expect(app.server.stats.protocolErrors).toBe(0);
  peer.send(hostOpen(identity));
  expect((await peer.next('host.ready')).deviceId).toBe(identity.deviceId);
});

it('serves legacy 0.6.6 and current sessions together without mixing credentials or signaling', async () => {
  const app = await start();
  const [legacyIdentity, currentIdentity] = await Promise.all([app.register(), app.register()]);
  const [legacyHost, currentHost, legacyGuest, currentGuest] = await Promise.all([app.connect(), app.connect(), app.connect(), app.connect()]);
  legacyHost.send(legacyOpen({ ...legacyIdentity, ownerToken: 'f'.repeat(64) }));
  expect((await legacyHost.next('error')).code).toBe('AUTH_FAILED');
  legacyHost.send(legacyOpen(legacyIdentity));
  const legacyReady = await legacyHost.next('host.ready');
  currentHost.send(hostOpen(currentIdentity));
  const currentReady = await currentHost.next('host.ready');
  expect(app.server.stats.activeRooms).toBe(2);

  legacyGuest.send(legacyJoin(legacyIdentity.deviceId, 'Wrong-42'));
  expect((await legacyGuest.next('error')).code).toBe('AUTH_FAILED');
  expect(legacyHost.history.some(message => message.type === 'paired')).toBe(false);
  legacyGuest.send(legacyJoin(legacyIdentity.deviceId));
  expect((await legacyGuest.next('paired')).sessionId).toBe(legacyReady.sessionId);
  await legacyHost.next('paired');
  currentGuest.send(guestJoin(currentIdentity.deviceId));
  expect((await currentGuest.next('paired')).sessionId).toBe(currentReady.sessionId);
  await currentHost.next('paired');

  legacyHost.send({ type: 'signal', sessionId: legacyReady.sessionId, payload: { type: 'offer', sdp: offerSdp } });
  expect((await legacyGuest.next('signal')).payload).toEqual({ type: 'offer', sdp: offerSdp });
  legacyGuest.send({ type: 'signal', sessionId: legacyReady.sessionId, payload: { type: 'answer', sdp: answerSdp } });
  expect((await legacyHost.next('signal')).payload).toEqual({ type: 'answer', sdp: answerSdp });
  expect(currentGuest.history.some(message => message.type === 'signal')).toBe(false);
  legacyGuest.send({ type: 'host.close', sessionId: legacyReady.sessionId });
  expect((await legacyGuest.next('error')).code).toBe('FORBIDDEN');
  legacyHost.send({ type: 'host.close', sessionId: legacyReady.sessionId });
  expect((await legacyHost.next('ended')).sessionId).toBe(legacyReady.sessionId);
  expect((await legacyGuest.next('ended')).sessionId).toBe(legacyReady.sessionId);
  expect(app.server.stats.activeRooms).toBe(1);
  expect(currentHost.history.some(message => message.type === 'ended')).toBe(false);
});

it('rejects cross-protocol joins and challenges without downgrading or evicting either host', async () => {
  const app = await start();
  const [legacyIdentity, currentIdentity] = await Promise.all([app.register(), app.register()]);
  const [legacyHost, currentHost, legacyGuest, currentGuest] = await Promise.all([app.connect(), app.connect(), app.connect(), app.connect()]);
  legacyHost.send(legacyOpen(legacyIdentity)); await legacyHost.next('host.ready');
  currentHost.send(hostOpen(currentIdentity)); await currentHost.next('host.ready');
  for (const opening of [guestChallenge(legacyIdentity.deviceId), guestJoin(legacyIdentity.deviceId)]) {
    currentGuest.send(opening);
    expect((await currentGuest.next('error')).code).toBe('INCOMPATIBLE_PROTOCOL');
  }
  legacyGuest.send(legacyJoin(currentIdentity.deviceId));
  expect((await legacyGuest.next('error')).code).toBe('INCOMPATIBLE_PROTOCOL');
  expect(app.server.stats.activeRooms).toBe(2);
  expect(app.server.stats.sessionsPaired).toBe(0);
  legacyGuest.send(legacyJoin(legacyIdentity.deviceId));
  await legacyGuest.next('paired'); await legacyHost.next('paired');
  currentGuest.send(guestJoin(currentIdentity.deviceId));
  await currentGuest.next('paired'); await currentHost.next('paired');
  expect(app.server.stats.sessionsPaired).toBe(2);
});

it('requires the exact legacy handshake shape rather than treating malformed modern messages as legacy', async () => {
  const app = await start({ maxProtocolErrorsPerSocket: 20 });
  const identity = await app.register(), peer = await app.connect();
  for (const malformed of [
    null,
    { ...legacyOpen(identity), salt },
    { ...legacyOpen(identity), extra: true },
    { ...legacyOpen(identity), password: null },
    { ...legacyOpen(identity), password: 'short' },
    { type: 'host.open', deviceId: identity.deviceId, password: 'Eight-42' },
    { ...legacyJoin(identity.deviceId), extra: true },
    { ...legacyJoin(identity.deviceId), password: null },
  ]) {
    peer.socket.send(JSON.stringify(malformed));
    expect((await peer.next('error')).code).toBe('INVALID_MESSAGE');
  }
  expect(app.server.stats.activeAuth).toBe(0);
  expect(app.server.stats.activeRooms).toBe(0);
  peer.send(legacyOpen(identity));
  expect((await peer.next('host.ready')).deviceId).toBe(identity.deviceId);
});

it('bounds legacy authentication with the shared queue and ignores disconnected owner lookups', async () => {
  const store = new Devices(':memory:'), lookup = Promise.withResolvers<boolean>();
  const originalAuth = store.authenticate.bind(store);
  store.authenticate = vi.fn().mockImplementationOnce(() => lookup.promise).mockImplementation(originalAuth);
  const app = await start({ maxAuthConcurrency: 1, maxAuthQueue: 0 }, store);
  const [one, two] = await Promise.all([app.register(), app.register()]);
  const [legacy, current] = await Promise.all([app.connect(), app.connect()]);
  legacy.send(legacyOpen(one));
  await vi.waitUntil(() => app.server.stats.activeAuth === 1, { timeout: 5000, interval: 2 });
  current.send(hostOpen(two));
  expect((await current.next('error')).code).toBe('SERVER_BUSY');
  legacy.socket.terminate();
  await vi.waitUntil(() => legacy.socket.readyState === WebSocket.CLOSED, { timeout: 5000, interval: 2 });
  lookup.resolve(true);
  await vi.waitUntil(() => app.server.stats.activeAuth === 0, { timeout: 5000, interval: 2 });
  expect(app.server.stats.activeRooms).toBe(0);
  current.send(hostOpen(two));
  expect((await current.next('host.ready')).deviceId).toBe(two.deviceId);
});

it('never replaces a legacy guest when two password checks race', async () => {
  const app = await start();
  const identity = await app.register();
  const [host, first, second] = await Promise.all([app.connect(), app.connect(), app.connect()]);
  host.send(legacyOpen(identity)); await host.next('host.ready');
  first.send(legacyJoin(identity.deviceId));
  second.send(legacyJoin(identity.deviceId));
  await vi.waitUntil(() => first.history.length > 0 && second.history.length > 0, { timeout: 5000, interval: 2 });
  const results = [...first.history, ...second.history];
  expect(results.filter(message => message.type === 'paired')).toHaveLength(1);
  expect(results.filter(message => message.type === 'error' && message.code === 'SESSION_UNAVAILABLE')).toHaveLength(1);
  expect(app.server.stats.sessionsPaired).toBe(1);
});

it('scopes guest rate limits per IP+device so third parties cannot lock out the host or other guests', async () => {
  const app = await start({ trustProxy: true, authDeviceLimit: 2, authIpLimit: 10 });
  const identity = await app.register();
  const host = await app.connect(origin, { 'X-Forwarded-For': '192.0.2.10' });
  host.send(hostOpen(identity));
  const ready = await host.next('host.ready');

  const attacker = await app.connect(origin, { 'X-Forwarded-For': '203.0.113.99' });
  for (let i = 0; i < 2; i++) {
    attacker.send(guestJoin(identity.deviceId, wrongPassword));
    expect((await attacker.next('error')).code).toBe('AUTH_FAILED');
  }
  attacker.send(guestJoin(identity.deviceId, wrongPassword));
  expect((await attacker.next('error')).code).toBe('RATE_LIMITED');

  // Another guest IP can still fetch the salt and pair immediately.
  const legitimateGuest = await app.connect(origin, { 'X-Forwarded-For': '198.51.100.42' });
  legitimateGuest.send(guestChallenge(identity.deviceId));
  expect((await legitimateGuest.next('guest.salt')).salt).toBe(salt);
  legitimateGuest.send(guestJoin(identity.deviceId));
  expect((await legitimateGuest.next('paired')).sessionId).toBe(ready.sessionId);
  await host.next('paired');

  // The host can also close and reopen its room without being throttled by the attacker's attempts.
  host.send({ type: 'host.close', sessionId: ready.sessionId });
  await host.next('ended');
  host.send(hostOpen(identity));
  expect((await host.next('host.ready')).deviceId).toBe(identity.deviceId);
});

it('releases paired rooms after the signaling window without ending the direct session', async () => {
  const app = await start({ pairedRoomTimeoutMs: 60, maxRooms: 1 });
  const [one, two] = await Promise.all([app.register(), app.register()]);
  const [host, guest, nextHost] = await Promise.all([app.connect(), app.connect(), app.connect()]);
  host.send(hostOpen(one));
  const ready = await host.next('host.ready');
  guest.send(guestJoin(one.deviceId));
  await guest.next('paired'); await host.next('paired');
  await vi.waitUntil(() => app.server.stats.activeRooms === 0, { timeout: 5000, interval: 5 });
  expect(host.history.some(m => m.type === 'ended')).toBe(false);
  expect(guest.history.some(m => m.type === 'ended')).toBe(false);
  nextHost.send(hostOpen(two));
  expect((await nextHost.next('host.ready')).deviceId).toBe(two.deviceId);
  host.send({ type: 'host.close', sessionId: ready.sessionId });
  expect((await host.next('ended')).sessionId).toBe(ready.sessionId);
});

it('rate-limits WebSocket upgrade floods per IP and closes sockets after repeated protocol errors', async () => {
  const app = await start({ upgradeIpLimit: 2, maxProtocolErrorsPerSocket: 2 });
  const peer = await app.connect();
  peer.socket.send( JSON.stringify({ type: 'unknown' }));
  expect((await peer.next('error')).code).toBe('INVALID_MESSAGE');
  peer.socket.send(JSON.stringify({ type: 'unknown' }));
  expect((await peer.next('error')).code).toBe('INVALID_MESSAGE');
  await vi.waitUntil(() => peer.socket.readyState === WebSocket.CLOSED, { timeout: 5000, interval: 2 });
  const second = await app.connect();
  second.socket.close();
  const third = new WebSocket(`${app.base.replace('http:', 'ws:')}/v1/connect`, { origin });
  sockets.push(third);
  third.on('error', () => {});
  const status = await new Promise<number | undefined>((resolve) => {
    third.once('unexpected-response', (_request, result) => { result.resume(); resolve(result.statusCode); third.terminate(); });
  });
  expect(status).toBe(429);
});
