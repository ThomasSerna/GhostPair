import { createHmac, hkdfSync, pbkdf2Sync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, MIN_SUPPORTED_PROTOCOL_VERSION, deriveSessionKeys, extractSdpFingerprints, generateSessionSalt, signSdpFingerprint, verifySdpFingerprint } from '@ghostpair/protocol';
import { createPeerSession, JsonChannel, type SessionCrypto } from './peer-session';

const testSalt = '0123456789abcdef0123456789abcdef';
const rawKeys = new WeakMap<CryptoKey, Buffer>();
const testCrypto: SessionCrypto = {
  generateSalt: () => testSalt,
  async deriveKeys(password, deviceId, salt) {
    const normalized = deviceId.trim().toLowerCase();
    const master = pbkdf2Sync(Buffer.from(password.normalize('NFKC')), `ghostpair:kdf:v2|${normalized}|${salt}`, 1_000, 32, 'sha256');
    const authToken = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `ghostpair:signaling-auth:v2|${normalized}`, 32)).toString('hex');
    const rawMac = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `ghostpair:e2e-sdp-mac:v2|${normalized}`, 32));
    const macKey = { type: 'secret', extractable: false, algorithm: { name: 'HMAC' }, usages: ['sign', 'verify'] } as CryptoKey;
    rawKeys.set(macKey, rawMac);
    return { authToken, macKey };
  },
  async signSdp(macKey, sessionId, role, sdp, offerSdp) {
    const fps = extractSdpFingerprints(sdp);
    let transcript = `ghostpair:sdp-fp:v2|${sessionId}|${role}|${fps.join(',')}`;
    if (role === 'guest') transcript += `|${extractSdpFingerprints(offerSdp ?? '').join(',')}`;
    return createHmac('sha256', rawKeys.get(macKey)!).update(transcript).digest('hex');
  },
  async verifySdp(macKey, sessionId, role, sdp, mac, offerSdp) {
    if (!mac || !/^[a-f0-9]{64}$/.test(mac)) return false;
    const expected = await this.signSdp(macKey, sessionId, role, sdp, offerSdp);
    return expected === mac;
  },
};

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
const syntheticOfferSdp = `v=0\r\na=fingerprint:sha-256 ${'AA:'.repeat(31)}01\r\n`;
const syntheticAnswerSdp = `v=0\r\na=fingerprint:sha-256 ${'BB:'.repeat(31)}02\r\n`;
class Peer {
  static instances: Peer[] = [];
  static nextLocal?: Promise<void>;
  connectionState = 'new';
  onconnectionstatechange?: () => void;
  channels: Channel[] = [];
  createDataChannel(label: string) { const c = new Channel(label); this.channels.push(c); return c; }
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: syntheticOfferSdp }));
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: syntheticAnswerSdp }));
  setLocalDescription = vi.fn(async () => { if (Peer.nextLocal) await Peer.nextLocal; });
  setRemoteDescription = vi.fn(async () => {});
  getStats = vi.fn(async () => directStats());
  close = vi.fn(() => { this.connectionState = 'closed'; });
  constructor() { Peer.instances.push(this); }
  connect() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); }
}
const id = 'a'.repeat(32);
const presentation = { tabId: 1, captureId: 'capture', documentId: 'document', generation: 3, viewportWidth: 800, viewportHeight: 600, offsetLeft: 0, offsetTop: 0, scale: 1 };
const target = { tabId: 1, captureId: 'capture', documentId: 'document', generation: 3 };
const snapshot = { controlMode: 'live', controlRevision: 0, presentation, generation: 3, activeTabId: 1, tabs: [], paused: false, controlEnabled: true, clipboardEnabled: false };
function harness(cryptoImpl: SessionCrypto = testCrypto) {
  const notify = vi.fn(), dispatch = vi.fn(async (_message: any): Promise<any> => ({ ok: true }));
  const session = createPeerSession(notify, dispatch, { read: async () => '', write: async () => {} }, {}, cryptoImpl);
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

  it.each([MIN_SUPPORTED_PROTOCOL_VERSION - 1, PROTOCOL_VERSION + 1])('rejects unsupported peer protocol %i without enabling a session', async protocol => {
    const h = harness(), first = await h.start(); await first.greet(protocol);
    expect(h.notify).toHaveBeenCalledWith('transport.ended', expect.objectContaining({ failed: true, reason: 'These extensions use incompatible connection protocols. Update the older extension.' }));
    expect(h.notify.mock.calls.some(([type]) => type === 'transport.connected')).toBe(false); expect(first.pc.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([...new Set([MIN_SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION])])('connects supported peer protocol %i while advertising the oldest wire protocol', async protocol => {
    const h = harness(), first = await h.start();
    expect(first.control.send.mock.calls.map(([value]) => JSON.parse(value))).toContainEqual({ type: 'hello', protocol: MIN_SUPPORTED_PROTOCOL_VERSION, sessionId: id, role: 'host' });
    expect(first.socket.send.mock.calls.map(([value]) => JSON.parse(value))).toContainEqual(expect.objectContaining({ type: 'host.open', protocol: MIN_SUPPORTED_PROTOCOL_VERSION }));
    await first.greet(protocol); first.pc.connect(); await settled();
    expect(h.notify).toHaveBeenCalledWith('transport.connected', { sessionId: id });
    h.session.stop();
  });

  it('keeps compatibility ping replies and the background keepalive without RTT telemetry', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    first.control.receive({ type: 'ping', time: 42 }); first.control.receive({ type: 'pong', time: 42 }); await settled();
    expect(first.control.send.mock.calls.map(([value]) => JSON.parse(value))).toContainEqual({ type: 'pong', time: 42 });
    await vi.advanceTimersByTimeAsync(20000);
    expect(first.control.send.mock.calls.map(([value]) => JSON.parse(value)).some(message => message.type === 'ping')).toBe(false);
    expect(h.notify).toHaveBeenCalledWith('transport.pulse');
    expect(h.notify.mock.calls.some(([type]) => type === 'transport.stats')).toBe(false);
    h.session.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('cannot establish a replacement session using a stopped peer route check', async () => {
    const h = harness(), first = await h.start(), stats = Promise.withResolvers<Map<string, any>>();
    first.pc.getStats.mockReturnValueOnce(stats.promise); await first.greet(); first.pc.connect();
    const second = await h.start('c'.repeat(32)); await second.greet();
    stats.resolve(directStats()); await settled();
    expect(h.notify.mock.calls.some(([type]) => type === 'transport.connected')).toBe(false);
    second.pc.connect(); await settled();
    expect(h.notify).toHaveBeenCalledWith('transport.connected', { sessionId: 'c'.repeat(32) });
    h.session.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('never signals an old local offer through a replacement session socket', async () => {
    const h = harness(), local = Promise.withResolvers<void>(); Peer.nextLocal = local.promise;
    await h.start(); Peer.nextLocal = undefined; const second = await h.start('c'.repeat(32));
    const before = second.socket.send.mock.calls.length; local.resolve(); await settled();
    expect(second.socket.send).toHaveBeenCalledTimes(before);
    h.session.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not acknowledge a completed old command on a new connection', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    const reply = Promise.withResolvers<any>(); h.dispatch.mockReturnValueOnce(reply.promise);
    first.control.receive({ type: 'command', requestId: 'old-command', command: { type: 'tab.create', controlRevision: 0, url: 'https://example.com' } }); await settled();
    expect(h.dispatch).toHaveBeenCalled();
    const second = await h.start('c'.repeat(32)); await second.greet(); second.pc.connect(); await settled();
    reply.resolve({ ok: true }); await settled();
    expect(second.control.send.mock.calls.map(([value]) => value).join(' ')).not.toContain('old-command');
    h.session.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels in-flight and queued input before accepting later commands', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    await h.session.handle({ type: 'session.state', snapshot });
    const slow = Promise.withResolvers<any>(); h.dispatch.mockReturnValueOnce(slow.promise);
    first.control.receive({ type: 'command', command: { type: 'text', controlRevision: 0, ...target, text: 'in flight' } }); await settled();
    first.control.receive({ type: 'command', requestId: 'canceled', command: { type: 'text', controlRevision: 0, ...target, text: 'queued' } });
    first.control.receive({ type: 'command', command: { type: 'input.release', controlRevision: 0, ...target } }); await settled();
    expect(h.dispatch.mock.calls.map(([message]) => message.command.type)).toEqual(['text', 'input.release']);
    first.control.receive({ type: 'command', command: { type: 'text', controlRevision: 0, ...target, text: 'after release' } });
    slow.resolve({ ok: false }); await settled();
    expect(h.dispatch.mock.calls.map(([message]) => message.command.text).filter(Boolean)).toEqual(['in flight', 'after release']);
    expect(first.control.send.mock.calls.map(([value]) => JSON.parse(value))).toContainEqual({ type: 'command.result', requestId: 'canceled', ok: false, error: 'The input was canceled.' });
    h.session.stop();
  });

  it('does not let an old release cancel commands for the current presentation', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    await h.session.handle({ type: 'session.state', snapshot });
    first.control.receive({ type: 'command', command: { type: 'text', controlRevision: 0, ...target, text: 'current' } });
    first.control.receive({ type: 'command', command: { type: 'input.release', controlRevision: 0, ...target, generation: 2 } });
    await settled();
    expect(h.dispatch.mock.calls[0][0].command.text).toBe('current');
    h.session.stop();
  });

  it('ends the session instead of silently dropping a discrete command at the rate limit', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    for (let i = 0; i < 251; i++) {
      first.control.receive({ type: 'command', command: { type: 'text', controlRevision: 0, ...target, text: 'x' } }); await settled();
    }
    expect(h.dispatch).toHaveBeenCalledTimes(250);
    expect(h.notify.mock.calls.filter(([type]) => type === 'transport.ended')).toEqual([['transport.ended', expect.objectContaining({ failed: true, reason: expect.stringContaining('rate limit') })]]);
    const second = await h.start(); await second.greet(); second.pc.connect(); await settled();
    second.control.receive({ type: 'command', command: { type: 'text', controlRevision: 0, ...target, text: 'new session' } }); await settled();
    expect(h.dispatch).toHaveBeenCalledTimes(251); h.session.stop();
  });

  it.each(['valid', 'invalid'])('bounds %s pending messages and never executes actions after overflow', async kind => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    const slow = Promise.withResolvers<any>(); h.dispatch.mockReturnValueOnce(slow.promise);
    const command = { type: 'command', command: { type: 'text', controlRevision: 0, ...target, text: 'x' } };
    first.control.receive(command); await settled();
    const queued = kind === 'valid' ? command : { ...command, command: { ...command.command, text: 123 } };
    for (let i = 0; i < 256; i++) first.control.receive(queued);
    expect(h.notify).toHaveBeenCalledWith('transport.ended', expect.objectContaining({ failed: true, reason: expect.stringContaining('pending commands') }));
    slow.resolve({ ok: true }); for (let i = 0; i < 30; i++) await settled();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed resets immediately without occupying the command queue', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    const slow = Promise.withResolvers<any>(); h.dispatch.mockReturnValueOnce(slow.promise);
    first.control.receive({ type: 'command', command: { type: 'text', controlRevision: 0, ...target, text: 'in flight' } }); await settled();
    for (let i = 0; i < 300; i++) first.control.receive({ type: 'media.reset', generation: 'invalid' });
    expect(first.pc.close).not.toHaveBeenCalled();
    slow.resolve({ ok: true }); await settled(); h.session.stop();
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
    const slow = Promise.withResolvers<any>(); h.dispatch.mockReturnValueOnce(slow.promise);
    const send = (text: string) => first.control.receive({ type: 'command', command: { type: 'text', controlRevision: 0, ...target, text } });
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
    const completion = Promise.withResolvers<any>(); h.dispatch.mockReturnValueOnce(completion.promise);
    first.control.receive({ type: 'command', requestId: 'create-tab', command: { type: 'tab.create', controlRevision: 0, url: 'https://example.com' } }); await settled();
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
    const delivery = Promise.withResolvers<any>(); h.dispatch.mockReturnValueOnce(delivery.promise);
    first.control.receive({ type: 'command', command: { type: 'text', controlRevision: 0, ...target, text: 'first' } }); await settled();
    first.control.receive({ type: 'command', command: { type: 'text', controlRevision: 0, ...target, text: 'queued' } });
    delivery.reject(new Error('Extension connection lost')); await settled();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith('transport.ended', expect.objectContaining({ failed: true, reason: 'Page controls stopped working. Start a new session.' }));
    expect(first.pc.close).toHaveBeenCalled();
  });

  it('does not let failed delivery from an old generation end current control', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    await h.session.handle({ type: 'session.state', snapshot });
    const delivery = Promise.withResolvers<any>(); h.dispatch.mockReturnValueOnce(delivery.promise);
    first.control.receive({ type: 'command', requestId: 'old', command: { type: 'text', controlRevision: 0, ...target, text: 'old' } }); await settled();
    await h.session.handle({ type: 'session.state', snapshot: { ...snapshot, generation: 4, presentation: { ...presentation, generation: 4 } } });
    first.control.receive({ type: 'command', command: { type: 'text', controlRevision: 0, ...target, generation: 4, text: 'current' } });
    delivery.reject(new Error('Obsolete connection')); await settled();
    expect(h.dispatch.mock.calls.map(([message]) => message.command.text)).toEqual(['old', 'current']);
    expect(first.control.send.mock.calls.map(([value]) => JSON.parse(value))).toContainEqual({ type: 'command.result', requestId: 'old', ok: false, error: 'The input was canceled.' });
    expect(first.pc.close).not.toHaveBeenCalled(); h.session.stop();
  });

  it('rejects queued and late commands from an old interaction revision without renegotiating video', async () => {
    const h = harness(), first = await h.start(); await first.greet(); first.pc.connect(); await settled();
    await h.session.handle({ type: 'session.state', snapshot });
    const delivery = Promise.withResolvers<any>(); h.dispatch.mockReturnValueOnce(delivery.promise);
    const send = (text: string, controlRevision = 0) => first.control.receive({ type: 'command', command: { type: 'text', controlRevision, ...target, text } });
    send('in flight'); await settled(); send('queued');
    const peers = Peer.instances.length;
    await h.session.handle({ type: 'session.state', snapshot: { ...snapshot, controlMode: 'visual', controlRevision: 1 } });
    send('late'); send('fresh', 1); delivery.resolve({ ok: false, error: 'mode changed' }); await settled();
    expect(h.dispatch.mock.calls.map(([message]) => message.command.text)).toEqual(['in flight', 'fresh']);
    expect(Peer.instances).toHaveLength(peers);
    expect(first.pc.close).not.toHaveBeenCalled(); h.session.stop();
  });

  it('publishes pre-connection remote clipboard state before starting initial clipboard read', async () => {
    const events: string[] = [];
    const notify = vi.fn((type: string) => events.push(type));
    const read = vi.fn(async () => { events.push('clipboard.read'); return 'initial'; });
    const session = createPeerSession(notify, vi.fn(async () => ({ ok: true })), { read, write: async () => {} }, {}, testCrypto);
    await session.handle({ type: 'session.start', role: 'host', deviceId: id, ownerToken: 'b'.repeat(64), password: 'Eight-42', clipboard: true, settings: { signalingUrl: 'http://127.0.0.1:8787', stunUrls: ['stun:example.com:3478'] } });
    const socket = Socket.instances.at(-1)!; socket.onopen?.();
    socket.receive({ type: 'paired', sessionId: id, role: 'host' }); await settled();
    const pc = Peer.instances.at(-1)!, control = pc.channels[0]!, clipboard = pc.channels[1]!;
    control.onopen?.(); clipboard.onopen?.();
    control.receive({ type: 'hello', protocol: PROTOCOL_VERSION, sessionId: id, role: 'guest' });
    control.receive({ type: 'clipboard.enabled', enabled: true }); await settled();
    expect(read).not.toHaveBeenCalled();
    pc.connect(); await settled();
    expect(notify).toHaveBeenCalledWith('transport.clipboard', { remoteEnabled: true });
    expect(events.indexOf('transport.clipboard')).toBeGreaterThan(-1);
    expect(events.indexOf('transport.clipboard')).toBeLessThan(events.indexOf('clipboard.read'));
    session.stop();
  });

  it('blinds the human password from signaling, binds the answer MAC to the offer, and rejects tampered or unbound fingerprints before setRemoteDescription', async () => {
    const h = harness(), first = await h.start();
    const sentMessages = first.socket.send.mock.calls.map(([raw]) => JSON.parse(raw));
    const openMsg = sentMessages.find(m => m.type === 'host.open');
    const keys = await testCrypto.deriveKeys('Eight-42', id, testSalt);
    expect(openMsg).toEqual({
      type: 'host.open',
      protocol: MIN_SUPPORTED_PROTOCOL_VERSION,
      deviceId: id,
      ownerToken: 'b'.repeat(64),
      salt: testSalt,
      password: keys.authToken,
    });
    expect(openMsg.password).not.toBe('Eight-42');
    const offerMsg = sentMessages.find(m => m.type === 'signal');
    expect(offerMsg.payload.mac).toBe(await testCrypto.signSdp(keys.macKey, id, 'host', syntheticOfferSdp));

    // Answer signed against a different offer must be rejected before setRemoteDescription.
    const otherOfferSdp = `v=0\r\na=fingerprint:sha-256 ${'DD:'.repeat(31)}04\r\n`;
    first.socket.receive({
      type: 'signal',
      sessionId: id,
      payload: { type: 'answer', sdp: syntheticAnswerSdp, mac: await testCrypto.signSdp(keys.macKey, id, 'guest', syntheticAnswerSdp, otherOfferSdp) },
    });
    await settled();
    expect(first.pc.setRemoteDescription).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith('transport.ended', expect.objectContaining({ failed: true, reason: 'Could not verify the peer security fingerprint. Start a new session.' }));

    // Tampered answer fingerprint with a MAC for another SDP must also abort before setRemoteDescription.
    const second = await h.start('c'.repeat(32));
    second.socket.receive({
      type: 'signal',
      sessionId: 'c'.repeat(32),
      payload: { type: 'answer', sdp: `v=0\r\na=fingerprint:sha-256 ${'CC:'.repeat(31)}03\r\n`, mac: await testCrypto.signSdp(keys.macKey, 'c'.repeat(32), 'guest', syntheticAnswerSdp, syntheticOfferSdp) },
    });
    await settled();
    expect(second.pc.setRemoteDescription).not.toHaveBeenCalled();
  });

  it('requests the session salt on guest.challenge, derives keys before guest.join, and discards stale derivations', async () => {
    const gate = Promise.withResolvers<void>();
    let paused = true;
    const gatedCrypto: SessionCrypto = {
      ...testCrypto,
      async deriveKeys(password, deviceId, salt) {
        if (paused) await gate.promise;
        return testCrypto.deriveKeys(password, deviceId, salt);
      },
    };
    const h = harness(gatedCrypto);
    const startMessage: Record<string, any> = {
      type: 'session.start', role: 'guest', deviceId: id, password: 'Eight-42', clipboard: false,
      settings: { signalingUrl: 'http://127.0.0.1:8787', stunUrls: ['stun:example.com:3478'] },
    };
    await h.session.handle(startMessage);
    expect(startMessage.password).toBe('');
    const firstSocket = Socket.instances.at(-1)!;
    firstSocket.onopen?.();
    expect(firstSocket.send.mock.calls.map(([raw]) => JSON.parse(raw))).toEqual([
      { type: 'guest.challenge', protocol: MIN_SUPPORTED_PROTOCOL_VERSION, deviceId: id },
    ]);
    firstSocket.receive({ type: 'guest.salt', deviceId: id, salt: testSalt });
    // Stopping the session before key derivation finishes must discard the result.
    h.session.stop();
    paused = false;
    gate.resolve();
    await settled();
    expect(firstSocket.send).toHaveBeenCalledTimes(1);

    // Fresh guest session completes the challenge -> salt -> join -> offer -> answer flow.
    await h.session.handle({
      type: 'session.start', role: 'guest', deviceId: id, password: 'Eight-42', clipboard: false,
      settings: { signalingUrl: 'http://127.0.0.1:8787', stunUrls: ['stun:example.com:3478'] },
    });
    const secondSocket = Socket.instances.at(-1)!;
    secondSocket.onopen?.();
    secondSocket.receive({ type: 'guest.salt', deviceId: id, salt: testSalt });
    await settled();
    const keys = await testCrypto.deriveKeys('Eight-42', id, testSalt);
    expect(secondSocket.send.mock.calls.map(([raw]) => JSON.parse(raw))).toEqual([
      { type: 'guest.challenge', protocol: MIN_SUPPORTED_PROTOCOL_VERSION, deviceId: id },
      { type: 'guest.join', protocol: MIN_SUPPORTED_PROTOCOL_VERSION, deviceId: id, password: keys.authToken },
    ]);
    secondSocket.receive({ type: 'paired', sessionId: id, role: 'guest' });
    await settled();
    secondSocket.receive({
      type: 'signal',
      sessionId: id,
      payload: { type: 'offer', sdp: syntheticOfferSdp, mac: await testCrypto.signSdp(keys.macKey, id, 'host', syntheticOfferSdp) },
    });
    await settled();
    const answerMsg = secondSocket.send.mock.calls.map(([raw]) => JSON.parse(raw)).find(m => m.type === 'signal');
    expect(answerMsg.payload).toEqual({
      type: 'answer',
      sdp: syntheticAnswerSdp,
      mac: await testCrypto.signSdp(keys.macKey, id, 'guest', syntheticAnswerSdp, syntheticOfferSdp),
    });
    h.session.stop();
  });

  it.each([
    'Incompatible GhostPair versions. Update both extensions.',
    'The extension and signaling server use incompatible connection protocols. Update the extension or server.',
  ])('surfaces old and current INCOMPATIBLE_PROTOCOL server errors: %s', async message => {
    const h = harness();
    await h.session.handle({
      type: 'session.start', role: 'guest', deviceId: id, password: 'Eight-42', clipboard: false,
      settings: { signalingUrl: 'http://127.0.0.1:8787', stunUrls: ['stun:example.com:3478'] },
    });
    const socket = Socket.instances.at(-1)!;
    socket.onopen?.();
    socket.receive({ type: 'error', code: 'INCOMPATIBLE_PROTOCOL', message });
    expect(h.notify).toHaveBeenCalledWith('transport.ended', {
      failed: true,
      reason: message,
    });
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

it('completes a real WebCrypto host-to-guest offer/answer handshake end to end', async () => {
  Socket.instances = []; Peer.instances = [];
  vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('RTCPeerConnection', Peer);
  try {
    const fastRealCrypto: SessionCrypto = {
      generateSalt: generateSessionSalt,
      deriveKeys: (password, deviceId, salt) => deriveSessionKeys(password, deviceId, salt, 1_000),
      signSdp: signSdpFingerprint,
      verifySdp: verifySdpFingerprint,
    };
    const hostNotify = vi.fn(), guestNotify = vi.fn();
    const hostSession = createPeerSession(hostNotify, async () => ({ ok: true }), { read: async () => '', write: async () => {} }, {}, fastRealCrypto);
    const guestSession = createPeerSession(guestNotify, async () => ({ ok: true }), { read: async () => '', write: async () => {} }, {}, fastRealCrypto);
    const settings = { signalingUrl: 'http://127.0.0.1:8787', stunUrls: ['stun:example.com:3478'] };

    await hostSession.handle({ type: 'session.start', role: 'host', deviceId: id, ownerToken: 'b'.repeat(64), password: 'Eight-42', clipboard: false, settings });
    const hostSocket = Socket.instances.at(-1)!;
    hostSocket.onopen?.();
    const hostOpen = JSON.parse(hostSocket.send.mock.calls[0]![0]);
    expect(hostOpen.type).toBe('host.open');

    await guestSession.handle({ type: 'session.start', role: 'guest', deviceId: id, password: 'Eight-42', clipboard: false, settings });
    const guestSocket = Socket.instances.at(-1)!;
    guestSocket.onopen?.();
    expect(JSON.parse(guestSocket.send.mock.calls[0]![0]).type).toBe('guest.challenge');

    guestSocket.receive({ type: 'guest.salt', deviceId: id, salt: hostOpen.salt });
    await vi.waitUntil(() => guestSocket.send.mock.calls.length === 2, { timeout: 5000, interval: 5 });
    const guestJoin = JSON.parse(guestSocket.send.mock.calls[1]![0]);
    expect(guestJoin.password).toBe(hostOpen.password);

    const sessionId = 'e'.repeat(32);
    hostSocket.receive({ type: 'paired', sessionId, role: 'host' });
    guestSocket.receive({ type: 'paired', sessionId, role: 'guest' });
    await vi.waitUntil(() => hostSocket.send.mock.calls.length === 2, { timeout: 5000, interval: 5 });
    const offerSignal = JSON.parse(hostSocket.send.mock.calls[1]![0]);

    guestSocket.receive(offerSignal);
    await vi.waitUntil(() => guestSocket.send.mock.calls.length === 3, { timeout: 5000, interval: 5 });
    const answerSignal = JSON.parse(guestSocket.send.mock.calls[2]![0]);

    hostSocket.receive(answerSignal);
    await vi.waitUntil(() => Peer.instances[0]!.setRemoteDescription.mock.calls.length === 1, { timeout: 5000, interval: 5 });
    expect(Peer.instances[1]!.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: syntheticOfferSdp });
    expect(Peer.instances[0]!.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: syntheticAnswerSdp });
    hostSession.stop(); guestSession.stop();
  } finally {
    vi.unstubAllGlobals();
  }
});
