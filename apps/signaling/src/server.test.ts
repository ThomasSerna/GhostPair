import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerSignalMessageSchema, type ClientSignalMessage, type ServerSignalMessage } from '@ghostpair/protocol';
import { createServer, type SignalingServer } from './server.js';
import type { ServerConfig } from './config.js';
import { Devices, type DeviceStore } from './devices.js';

const origin = `chrome-extension://${'a'.repeat(32)}`;
const password = 'GhostPair test password 937!';
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

  send(message: ClientSignalMessage): void { this.socket.send(JSON.stringify(message)); }

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
  const server = createServer({ databasePath: ':memory:', port: 0, scryptN: 1024, ...overrides }, store);
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
    async connect(requestOrigin = origin) {
      const socket = new WebSocket(`${base.replace('http:', 'ws:')}/v1/connect`, { origin: requestOrigin });
      sockets.push(socket);
      const peer = new Peer(socket);
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      return peer;
    },
  };
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
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
      peer.send({ type: 'host.open', ...identity, password });
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
      peer.send({ type: 'host.open', ...identity, password });
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
    host.send({ type: 'host.open', ...identity, password });
    expect((await host.next('host.ready')).deviceId).toBe(identity.deviceId);
  });

  it('authenticates both roles before forwarding signaling and permits only the host to end', async () => {
    const password = 'Eight-42';
    const app = await start();
    const identity = await app.register();
    const host = await app.connect();
    host.send({ type: 'host.open', ...identity, ownerToken: 'incorrect', password });
    expect((await host.next('error')).code).toBe('AUTH_FAILED');
    host.send({ type: 'host.open', ...identity, password });
    const ready = await host.next('host.ready');
    const guest = await app.connect();
    guest.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'offer', sdp: 'unauthenticated' } });
    expect((await guest.next('error')).code).toBe('FORBIDDEN');
    guest.send({ type: 'guest.join', deviceId: identity.deviceId, password: 'incorrect password' });
    expect((await guest.next('error')).code).toBe('AUTH_FAILED');
    expect(host.history.some((message) => message.type === 'paired' || message.type === 'signal')).toBe(false);
    guest.send({ type: 'guest.join', deviceId: identity.deviceId, password });
    expect(await guest.next('paired')).toEqual({ type: 'paired', role: 'guest', sessionId: ready.sessionId });
    expect((await host.next('paired')).role).toBe('host');
    host.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'offer', sdp: 'v=0' } });
    expect((await guest.next('signal')).payload).toEqual({ type: 'offer', sdp: 'v=0' });
    guest.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'answer', sdp: 'v=0' } });
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
    host.send({ type: 'host.open', ...firstIdentity, password });
    const ready = await host.next('host.ready');
    otherHost.send({ type: 'host.open', ...secondIdentity, password });
    const otherReady = await otherHost.next('host.ready');
    guest.send({ type: 'guest.join', deviceId: firstIdentity.deviceId, password });
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
    host.send({ type: 'host.open', ...identity, password }); await host.next('host.ready');
    firstGuest.send({ type: 'guest.join', deviceId: identity.deviceId, password });
    secondGuest.send({ type: 'guest.join', deviceId: identity.deviceId, password });
    await until(() => firstGuest.history.length > 0 && secondGuest.history.length > 0);
    const both = [...firstGuest.history, ...secondGuest.history];
    expect(both.filter((message) => message.type === 'paired')).toHaveLength(1);
    expect(both.filter((message) => message.type === 'error' && message.code === 'SESSION_UNAVAILABLE')).toHaveLength(1);
    expect(app.server.stats.sessionsPaired).toBe(1);
  });

  it('does not send ended when signaling disconnects after pairing', async () => {
    const app = await start();
    const identity = await app.register();
    const [host, guest] = await Promise.all([app.connect(), app.connect()]);
    host.send({ type: 'host.open', ...identity, password }); const ready = await host.next('host.ready');
    guest.send({ type: 'guest.join', deviceId: identity.deviceId, password });
    await guest.next('paired'); await host.next('paired');
    guest.socket.close();
    await until(() => app.server.stats.activeRooms === 0);
    host.send({ type: 'ping', id: 'after-disconnection' }); await host.next('pong');
    expect(host.history.some((message) => message.type === 'ended')).toBe(false);
    host.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'ice', candidate: null } });
    expect((await host.next('error')).code).toBe('SIGNAL_UNAVAILABLE');
    host.send({ type: 'host.close', sessionId: ready.sessionId });
    expect((await host.next('ended')).sessionId).toBe(ready.sessionId);
  });

  it('rejects stale password work if the host closes while the guest authenticates', async () => {
    const app = await start({ scryptN: 131_072 });
    const identity = await app.register();
    const [host, guest] = await Promise.all([app.connect(), app.connect()]);
    host.send({ type: 'host.open', ...identity, password }); const ready = await host.next('host.ready');
    guest.send({ type: 'guest.join', deviceId: identity.deviceId, password });
    await until(() => app.server.stats.activeAuth === 1);
    host.send({ type: 'host.close', sessionId: ready.sessionId });
    await host.next('ended');
    expect((await guest.next('error')).code).toBe('SESSION_UNAVAILABLE');
    await until(() => app.server.stats.activeAuth === 0);
    expect(app.server.stats.activeRooms).toBe(0);
    expect(app.server.stats.sessionsPaired).toBe(0);
    expect(guest.history.some((message) => message.type === 'paired')).toBe(false);
  });

  it('cannot create a room after its opening host disconnects', async () => {
    const app = await start({ scryptN: 131_072 });
    const identity = await app.register();
    const host = await app.connect();
    host.send({ type: 'host.open', ...identity, password });
    await until(() => app.server.stats.activeAuth === 1);
    host.socket.terminate();
    await until(() => app.server.stats.activeConnections === 0 && app.server.stats.activeAuth === 0);
    expect(app.server.stats.activeRooms).toBe(0);
    const replacement = await app.connect();
    replacement.send({ type: 'host.open', ...identity, password });
    expect((await replacement.next('host.ready')).deviceId).toBe(identity.deviceId);
  });

  it('bounds device registration, authentication attempts, messages and idle sockets', async () => {
    const app = await start({ registrationLimit: 1, authIpLimit: 2, authDeviceLimit: 2, socketMessageLimit: 2, authTimeoutMs: 150 });
    const identity = await app.register();
    expect((await fetch(`${app.base}/v1/devices`, { method: 'POST', headers: { Origin: origin } })).status).toBe(429);
    const peer = await app.connect();
    for (let i = 0; i < 2; i += 1) {
      peer.send({ type: 'guest.join', deviceId: identity.deviceId, password });
      expect((await peer.next('error')).code).toBe('SESSION_UNAVAILABLE');
    }
    const another = await app.connect();
    another.send({ type: 'guest.join', deviceId: identity.deviceId, password });
    expect((await another.next('error')).code).toBe('RATE_LIMITED');
    peer.send({ type: 'ping', id: 'over-limit' });
    expect((await peer.next('error')).code).toBe('RATE_LIMITED');
    await until(() => app.server.stats.activeConnections === 0);
    expect(app.server.stats.rateLimited).toBe(3);
  });

  it('expires waiting rooms and permits a new session afterwards', async () => {
    const app = await start({ waitingRoomTimeoutMs: 50 });
    const identity = await app.register();
    const host = await app.connect();
    host.send({ type: 'host.open', ...identity, password }); const first = await host.next('host.ready');
    expect((await host.next('ended')).sessionId).toBe(first.sessionId);
    host.send({ type: 'host.open', ...identity, password });
    expect((await host.next('host.ready')).sessionId).not.toBe(first.sessionId);
  });

  it('caps expensive password work globally and releases capacity after completion', async () => {
    const app = await start({ scryptN: 131_072, maxAuthConcurrency: 1 });
    const [one, two] = await Promise.all([app.register(), app.register()]);
    const [first, second] = await Promise.all([app.connect(), app.connect()]);
    first.send({ type: 'host.open', ...one, password });
    await until(() => app.server.stats.activeAuth === 1);
    second.send({ type: 'host.open', ...two, password });
    expect((await second.next('error')).code).toBe('SERVER_BUSY');
    await first.next('host.ready');
    second.send({ type: 'host.open', ...two, password });
    expect((await second.next('host.ready')).deviceId).toBe(two.deviceId);
    expect(app.server.stats.activeAuth).toBe(0);
  });

  it('caps registered devices and rooms and prevents a second host claiming an active device', async () => {
    const app = await start({ maxRooms: 1, maxRegisteredDevices: 2 });
    const [one, two] = await Promise.all([app.register(), app.register()]);
    expect((await fetch(`${app.base}/v1/devices`, { method: 'POST', headers: { Origin: origin } })).status).toBe(503);
    const [first, second] = await Promise.all([app.connect(), app.connect()]);
    first.send({ type: 'host.open', ...one, password }); await first.next('host.ready');
    second.send({ type: 'host.open', ...one, password });
    expect((await second.next('error')).code).toBe('HOST_ALREADY_ACTIVE');
    second.send({ type: 'host.open', ...two, password });
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
  const app = await start({ maxAuthConcurrency: 1 }, store);
  const identity = await app.register(), first = await app.connect(), second = await app.connect();
  first.send({ type: 'host.open', ...identity, password });
  await until(() => app.server.stats.activeAuth === 1);
  second.send({ type: 'host.open', ...identity, password });
  expect((await second.next('error')).code).toBe('SERVER_BUSY');
  expect(store.authenticate).toHaveBeenCalledTimes(1);
  first.socket.close(); await until(() => first.socket.readyState === WebSocket.CLOSED);
  lookup.resolve(true); await until(() => app.server.stats.activeAuth === 0);
  expect(app.server.stats.activeRooms).toBe(0);
});

it('does not resurrect authentication after the socket timeout', async () => {
  const store = new Devices(':memory:'), lookup = Promise.withResolvers<boolean>(); store.authenticate = () => lookup.promise;
  const app = await start({ authTimeoutMs: 75 }, store), identity = await app.register(), peer = await app.connect();
  peer.send({ type: 'host.open', ...identity, password });
  await until(() => peer.socket.readyState === WebSocket.CLOSED);
  lookup.resolve(true); await until(() => app.server.stats.activeAuth === 0);
  expect(app.server.stats.activeRooms).toBe(0);
});

it('drains pending identity work before closing storage on shutdown', async () => {
  const store = new Devices(':memory:'), lookup = Promise.withResolvers<boolean>(); store.authenticate = () => lookup.promise;
  const close = vi.spyOn(store, 'close');
  const app = await start({}, store), identity = await app.register(), peer = await app.connect();
  peer.send({ type: 'host.open', ...identity, password }); await until(() => app.server.stats.activeAuth === 1);
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
  const peer = await app.connect(); peer.send({ type: 'host.open', ...identity, password });
  expect((await peer.next('error')).code).toBe('SERVER_BUSY');
  peer.send({ type: 'host.open', ...identity, password }); expect((await peer.next('host.ready')).deviceId).toBe(identity.deviceId);
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
  expect(await response.text()).toContain('GhostPair privacy');
});
