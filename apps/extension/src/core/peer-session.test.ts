import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@ghostpair/protocol';
import { createPeerSession } from './peer-session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function settled() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  send = vi.fn(); close = vi.fn();
  constructor() { Socket.instances.push(this); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
class Channel {
  readyState = 'open'; bufferedAmount = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn(); close = vi.fn();
  constructor(readonly label: string) {}
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const directStats = () => new Map<string, any>([
  ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
  ['pair', { localCandidateId: 'local', remoteCandidateId: 'remote' }],
  ['local', { candidateType: 'host' }], ['remote', { candidateType: 'host' }],
]);
class Peer {
  static instances: Peer[] = [];
  static nextLocal?: Promise<void>;
  connectionState = 'new';
  onconnectionstatechange?: () => void;
  channels: Channel[] = [];
  createDataChannel(label: string) { const c = new Channel(label); this.channels.push(c); return c; }
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'synthetic offer' }));
  setLocalDescription = vi.fn(async () => { if (Peer.nextLocal) await Peer.nextLocal; });
  getStats = vi.fn(async () => directStats());
  close = vi.fn(() => { this.connectionState = 'closed'; });
  constructor() { Peer.instances.push(this); }
  connect() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); }
}
const id = 'a'.repeat(32);
function harness() {
  const notify = vi.fn(), dispatch = vi.fn(async (_message: any): Promise<any> => ({ ok: true }));
  const session = createPeerSession(notify, dispatch, { read: async () => '', write: async () => {} });
  async function start(sessionId = id) {
    await session.handle({ type: 'session.start', role: 'host', deviceId: id, ownerToken: 'b'.repeat(64), password: 'Eight-42', clipboard: false,
      settings: { signalingUrl: 'http://127.0.0.1:8787', stunUrls: ['stun:example.com:3478'] } });
    const socket = Socket.instances.at(-1)!; socket.onopen?.();
    socket.receive({ type: 'paired', sessionId, role: 'host' }); await settled();
    const pc = Peer.instances.at(-1)!, control = pc.channels[0];
    control.onopen?.();
    return { socket, pc, control, greet: async (protocol = PROTOCOL_VERSION) => { control.receive({ type: 'hello', protocol, sessionId, role: 'guest' }); await settled(); } };
  }
  return { session, notify, dispatch, start };
}
describe('peer session lifetime', () => {
  beforeEach(() => { vi.useFakeTimers(); Socket.instances = []; Peer.instances = []; Peer.nextLocal = undefined; vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('RTCPeerConnection', Peer); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('rejects incompatible peers explicitly without enabling a session', async () => {
    const h = harness(), first = await h.start(); await first.greet(PROTOCOL_VERSION - 1);
    expect(h.notify).toHaveBeenCalledWith('transport.ended', expect.objectContaining({ failed: true, reason: 'Incompatible GhostPair versions. Update both extensions.' }));
    expect(h.notify.mock.calls.some(([type]) => type === 'transport.connected')).toBe(false); expect(first.pc.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cannot establish a replacement session using a stopped peer route check', async () => {
    const h = harness(), first = await h.start(), stats = deferred<Map<string, any>>();
    first.pc.getStats.mockReturnValueOnce(stats.promise); await first.greet(); first.pc.connect();
    const second = await h.start('c'.repeat(32)); await second.greet();
    stats.resolve(directStats()); await settled();
    expect(h.notify.mock.calls.some(([type]) => type === 'transport.connected')).toBe(false);
    second.pc.connect(); await settled();
    expect(h.notify).toHaveBeenCalledWith('transport.connected', { sessionId: 'c'.repeat(32) });
    h.session.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('never signals an old local offer through a replacement session socket', async () => {
    const h = harness(), local = deferred<void>(); Peer.nextLocal = local.promise;
    await h.start(); Peer.nextLocal = undefined; const second = await h.start('c'.repeat(32));
    const before = second.socket.send.mock.calls.length; local.resolve(); await settled();
    expect(second.socket.send).toHaveBeenCalledTimes(before);
    h.session.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not acknowledge a completed old command on a new connection', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    const reply = deferred<any>(); h.dispatch.mockReturnValueOnce(reply.promise);
    first.control.receive({ type: 'command', requestId: 'old-command', command: { type: 'tab.create', url: 'https://example.com' } }); await settled();
    expect(h.dispatch).toHaveBeenCalled();
    const second = await h.start('c'.repeat(32)); await second.greet(); second.pc.connect(); await settled();
    reply.resolve({ ok: true }); await settled();
    expect(second.control.send.mock.calls.map(([value]) => value).join(' ')).not.toContain('old-command');
    h.session.stop(); expect(vi.getTimerCount()).toBe(0);
  });
});
