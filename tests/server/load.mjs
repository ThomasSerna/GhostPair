import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { deriveSessionKeys, signSdpFingerprint, verifySdpFingerprint } from '@ghostpair/protocol';
import { createServer } from '../../apps/signaling/dist/server.js';

const PAIRS = Number(process.env.GHOSTPAIR_LOAD_PAIRS ?? 20);
const SCRYPT_N = Number(process.env.GHOSTPAIR_LOAD_SCRYPT_N ?? 16_384);
const origin = `chrome-extension://${'a'.repeat(32)}`;
const hostSdp = `v=0\r\na=fingerprint:sha-256 ${'AA:'.repeat(31)}01\r\n`;
const guestSdp = `v=0\r\na=fingerprint:sha-256 ${'BB:'.repeat(31)}02\r\n`;

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 100) / 100;
}

function connectSocket(wsUrl, ip) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { origin, headers: { 'X-Forwarded-For': ip } });
    const queue = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const index = waiters.findIndex((w) => w.type === msg.type);
      if (index >= 0) waiters.splice(index, 1)[0].resolve(msg);
      else queue.push(msg);
    });
    ws.once('open', () => resolve({
      ws,
      send(payload) { ws.send(JSON.stringify(payload)); },
      next(type) {
        const index = queue.findIndex((m) => m.type === type);
        if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`Timeout waiting for ${type}`)), 15_000);
          waiters.push({ type, resolve: (m) => { clearTimeout(timer); res(m); } });
        });
      },
    }));
    ws.once('error', reject);
  });
}

const server = createServer({
  databasePath: ':memory:',
  port: 0,
  trustProxy: true,
  scryptN: SCRYPT_N,
  maxAuthConcurrency: 4,
  maxAuthQueue: PAIRS * 2,
  pairedRoomTimeoutMs: 200,
});

const sockets = [];
try {
  const address = await server.listen(0);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const wsUrl = `ws://127.0.0.1:${address.port}/v1/connect`;

  const regLatencies = [];
  const identities = await Promise.all(Array.from({ length: PAIRS }, async (_, i) => {
    const start = performance.now();
    const res = await fetch(`${baseUrl}/v1/devices`, {
      method: 'POST',
      headers: { Origin: origin, 'X-Forwarded-For': `198.51.100.${i + 1}` },
    });
    assert.equal(res.status, 201);
    regLatencies.push(performance.now() - start);
    return res.json();
  }));

  const pairLatencies = [];
  await Promise.all(identities.map(async (identity, i) => {
    const start = performance.now();
    const hostIp = `198.51.100.${i + 1}`;
    const guestIp = `203.0.113.${i + 1}`;
    const password = `LoadTest-Pass-${i}-9876!`;
    const keys = deriveSessionKeys(password, identity.deviceId);
    const [host, guest] = await Promise.all([connectSocket(wsUrl, hostIp), connectSocket(wsUrl, guestIp)]);
    sockets.push(host.ws, guest.ws);

    host.send({ type: 'host.open', deviceId: identity.deviceId, ownerToken: identity.ownerToken, password: keys.authToken });
    const ready = await host.next('host.ready');
    guest.send({ type: 'guest.join', deviceId: identity.deviceId, password: keys.authToken });
    await Promise.all([host.next('paired'), guest.next('paired')]);

    const offerMac = signSdpFingerprint(keys.macKey, ready.sessionId, 'host', hostSdp);
    host.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'offer', sdp: hostSdp, mac: offerMac } });
    const receivedOffer = await guest.next('signal');
    assert.equal(verifySdpFingerprint(keys.macKey, ready.sessionId, 'host', receivedOffer.payload.sdp, receivedOffer.payload.mac), true);

    const answerMac = signSdpFingerprint(keys.macKey, ready.sessionId, 'guest', guestSdp);
    guest.send({ type: 'signal', sessionId: ready.sessionId, payload: { type: 'answer', sdp: guestSdp, mac: answerMac } });
    const receivedAnswer = await host.next('signal');
    assert.equal(verifySdpFingerprint(keys.macKey, ready.sessionId, 'guest', receivedAnswer.payload.sdp, receivedAnswer.payload.mac), true);

    pairLatencies.push(performance.now() - start);
  }));

  // Wait for post-pairing signaling window to reclaim rooms while keeping WebSockets open.
  const deadline = Date.now() + 5_000;
  while (server.stats.activeRooms > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }

  const mem = process.memoryUsage();
  const heapUsedMb = Math.round((mem.heapUsed / (1024 * 1024)) * 100) / 100;
  const rssMb = Math.round((mem.rss / (1024 * 1024)) * 100) / 100;
  const p95PairingMs = percentile(pairLatencies, 0.95);

  assert.equal(server.stats.sessionsPaired, PAIRS);
  assert.equal(server.stats.activeRooms, 0, 'Paired rooms must be reclaimed after signaling window');
  assert.equal(server.stats.internalErrors, 0);

  const report = {
    concurrentPairs: PAIRS,
    scryptN: SCRYPT_N,
    registrationMs: { p50: percentile(regLatencies, 0.5), p95: percentile(regLatencies, 0.95), p99: percentile(regLatencies, 0.99) },
    pairingAndSignalingMs: { p50: percentile(pairLatencies, 0.5), p95: p95PairingMs, p99: percentile(pairLatencies, 0.99) },
    memory: { heapUsedMb, rssMb },
    stats: server.stats,
    horizontalScalingNeeded: p95PairingMs > 5000 || heapUsedMb > 384,
  };
  console.log(JSON.stringify(report));
} finally {
  for (const ws of sockets) ws.terminate();
  await server.close();
}
