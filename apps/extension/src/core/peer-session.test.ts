import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@ghostpair/protocol';
import { createPeerSession, JsonChannel } from './peer-session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
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
const presentation = { tabId: 1, captureId: 'capture', documentId: 'document', generation: 3, viewportWidth: 800, viewportHeight: 600, offsetLeft: 0, offsetTop: 0, scale: 1 };
const target = { tabId: 1, captureId: 'capture', documentId: 'document', generation: 3 };
const snapshot = { presentation, generation: 3, activeTabId: 1, tabs: [], paused: false, controlEnabled: true, clipboardEnabled: false };
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

  it('cancels in-flight and queued input before accepting later commands', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    await h.session.handle({ type: 'session.state', snapshot });
    const slow = deferred<any>(); h.dispatch.mockReturnValueOnce(slow.promise);
    first.control.receive({ type: 'command', command: { type: 'text', ...target, text: 'in flight' } }); await settled();
    first.control.receive({ type: 'command', requestId: 'canceled', command: { type: 'text', ...target, text: 'queued' } });
    first.control.receive({ type: 'command', command: { type: 'input.release', ...target } }); await settled();
    expect(h.dispatch.mock.calls.map(([message]) => message.command.type)).toEqual(['text', 'input.release']);
    first.control.receive({ type: 'command', command: { type: 'text', ...target, text: 'after release' } });
    slow.resolve({ ok: false }); await settled();
    expect(h.dispatch.mock.calls.map(([message]) => message.command.text).filter(Boolean)).toEqual(['in flight', 'after release']);
    expect(first.control.send.mock.calls.map(([value]) => JSON.parse(value))).toContainEqual({ type: 'command.result', requestId: 'canceled', ok: false, error: 'The input was canceled.' });
    h.session.stop();
  });

  it('does not let an old release cancel commands for the current presentation', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    await h.session.handle({ type: 'session.state', snapshot });
    first.control.receive({ type: 'command', command: { type: 'text', ...target, text: 'current' } });
    first.control.receive({ type: 'command', command: { type: 'input.release', ...target, generation: 2 } });
    await settled();
    expect(h.dispatch.mock.calls[0][0].command.text).toBe('current');
    h.session.stop();
  });

  it('ends the session instead of silently dropping a discrete command at the rate limit', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    for (let i = 0; i < 251; i++) {
      first.control.receive({ type: 'command', command: { type: 'text', ...target, text: 'x' } }); await settled();
    }
    expect(h.dispatch).toHaveBeenCalledTimes(250);
    expect(h.notify.mock.calls.filter(([type]) => type === 'transport.ended')).toEqual([['transport.ended', expect.objectContaining({ failed: true, reason: expect.stringContaining('rate limit') })]]);
    const second = await h.start(); await second.greet(); second.pc.connect(); await settled();
    second.control.receive({ type: 'command', command: { type: 'text', ...target, text: 'new session' } }); await settled();
    expect(h.dispatch).toHaveBeenCalledTimes(251); h.session.stop();
  });

  it('ends a congested receive queue and never executes its pending actions', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    const slow = deferred<any>(); h.dispatch.mockReturnValueOnce(slow.promise);
    const command = { type: 'command', command: { type: 'text', ...target, text: 'x' } };
    first.control.receive(command); await settled();
    for (let i = 0; i < 256; i++) first.control.receive(command);
    expect(h.notify).toHaveBeenCalledWith('transport.ended', expect.objectContaining({ failed: true, reason: expect.stringContaining('pending commands') }));
    slow.resolve({ ok: true }); for (let i = 0; i < 30; i++) await settled();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('reports send exceptions once and closes the session', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    first.control.send.mockImplementation(() => { throw new Error('channel unavailable'); });
    await h.session.handle({ type: 'session.state', snapshot });
    expect(h.notify.mock.calls.filter(([type]) => type === 'transport.ended')).toHaveLength(1);
    expect(first.pc.close).toHaveBeenCalled();
  });

  it('cancels queued input across control withdrawal and restoration', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    await h.session.handle({ type: 'session.state', snapshot });
    const slow = deferred<any>(); h.dispatch.mockReturnValueOnce(slow.promise);
    const send = (text: string) => first.control.receive({ type: 'command', command: { type: 'text', ...target, text } });
    send('in flight'); await settled(); send('queued before revoke');
    await h.session.handle({ type: 'session.state', snapshot: { ...snapshot, controlEnabled: false } });
    send('received while disabled');
    await h.session.handle({ type: 'session.state', snapshot }); send('after restore');
    slow.resolve({ ok: true }); await settled();
    expect(h.dispatch.mock.calls.map(([message]) => message.command.text)).toEqual(['in flight', 'after restore']);
    h.session.stop();
  });

  it('acknowledges a successful action that itself changes the presentation', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    await h.session.handle({ type: 'session.state', snapshot });
    const completion = deferred<any>(); h.dispatch.mockReturnValueOnce(completion.promise);
    first.control.receive({ type: 'command', requestId: 'create-tab', command: { type: 'tab.create', url: 'https://example.com' } }); await settled();
    await h.session.handle({ type: 'session.state', snapshot: { ...snapshot, presentation: undefined, generation: 4 } });
    completion.resolve({ ok: true }); await settled();
    expect(first.control.send.mock.calls.map(([value]) => JSON.parse(value))).toContainEqual({ type: 'command.result', requestId: 'create-tab', ok: true });
    h.session.stop();
  });

  it('ends the session if outgoing control messages cannot be queued', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    first.control.bufferedAmount = 100_000;
    for (let i = 0; i < 2000; i++) await h.session.handle({ type: 'session.notice', message: 'x'.repeat(512) });
    expect(h.notify.mock.calls.filter(([type]) => type === 'transport.ended')).toEqual([['transport.ended', expect.objectContaining({ failed: true, reason: expect.stringContaining('congested') })]]);
    expect(first.pc.close).toHaveBeenCalled();
  });

  it('ends the session when delivery to the host fails and cancels queued input', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    const delivery = deferred<any>(); h.dispatch.mockReturnValueOnce(delivery.promise);
    first.control.receive({ type: 'command', command: { type: 'text', ...target, text: 'first' } }); await settled();
    first.control.receive({ type: 'command', command: { type: 'text', ...target, text: 'queued' } });
    delivery.reject(new Error('Extension connection lost')); await settled();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith('transport.ended', expect.objectContaining({ failed: true, reason: expect.stringContaining('host input connection failed') }));
    expect(first.pc.close).toHaveBeenCalled();
  });

  it('does not let failed delivery from an old generation end current control', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    await h.session.handle({ type: 'session.state', snapshot });
    const delivery = deferred<any>(); h.dispatch.mockReturnValueOnce(delivery.promise);
    first.control.receive({ type: 'command', requestId: 'old', command: { type: 'text', ...target, text: 'old' } }); await settled();
    await h.session.handle({ type: 'session.state', snapshot: { ...snapshot, generation: 4, presentation: { ...presentation, generation: 4 } } });
    first.control.receive({ type: 'command', command: { type: 'text', ...target, generation: 4, text: 'current' } });
    delivery.reject(new Error('Obsolete connection')); await settled();
    expect(h.dispatch.mock.calls.map(([message]) => message.command.text)).toEqual(['old', 'current']);
    expect(first.control.send.mock.calls.map(([value]) => JSON.parse(value))).toContainEqual({ type: 'command.result', requestId: 'old', ok: false, error: 'The input was canceled.' });
    expect(first.pc.close).not.toHaveBeenCalled(); h.session.stop();
  });
});

it('reports immediate and delayed channel send failures without claiming success', () => {
  for (const buffered of [false, true]) {
    const channel = new Channel('control') as Channel & { onbufferedamountlow?: () => void };
    channel.bufferedAmount = buffered ? 100_000 : 0;
    const failure = vi.fn(), pipe = new JsonChannel(channel as unknown as RTCDataChannel, vi.fn(), failure);
    channel.send.mockImplementation(() => { throw new Error('send failed'); });
    expect(pipe.send({ type: 'test' })).toBe(buffered);
    if (buffered) { channel.bufferedAmount = 0; channel.onbufferedamountlow?.(); }
    expect(failure).toHaveBeenCalledTimes(1); expect(pipe.send({ type: 'later' })).toBe(false);
    channel.onbufferedamountlow?.(); expect(channel.send).toHaveBeenCalledTimes(1);
  }
});

it('refuses enqueueing beyond the bounded channel buffer', () => {
  const channel = new Channel('control'); channel.bufferedAmount = 100_000;
  const pipe = new JsonChannel(channel as unknown as RTCDataChannel, vi.fn(), vi.fn());
  expect(pipe.send({ text: 'x'.repeat(800_000) })).toBe(true);
  expect(pipe.send({ text: 'x'.repeat(300_000) })).toBe(false);
  expect(channel.send).not.toHaveBeenCalled(); pipe.clear();
});
