import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaSession, type MediaSignal, type Presentation } from './media-session';

async function settled() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

class Track {
  kind = 'video';
  enabled = false;
  contentHint = '';
  readyState = 'live';
  onended: (() => void) | null = null;
  clones: Track[] = [];
  stop = vi.fn(() => { this.readyState = 'ended'; });
  clone = vi.fn(() => { const copy = new Track(); this.clones.push(copy); return copy; });
}
class Stream {
  constructor(private tracks: Track[] = []) {}
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  getTracks() { return this.tracks; }
}
function stats(local = 'host', remote = 'srflx') {
  return new Map<string, Record<string, unknown>>([
    ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote', state: 'succeeded', nominated: true }],
    ['local', { type: 'local-candidate', candidateType: local }],
    ['remote', { type: 'remote-candidate', candidateType: remote }],
  ]);
}
class Peer {
  static peers: Peer[] = [];
  static nextOffer?: Promise<RTCSessionDescriptionInit>;
  static nextRemote?: Promise<void>;
  connectionState = 'new';
  localDescription?: RTCSessionDescriptionInit;
  remoteDescription?: RTCSessionDescriptionInit;
  onicecandidate: ((event: { candidate: { toJSON: () => RTCIceCandidateInit } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: { track: Track; streams: Stream[] }) => void) | null = null;
  sender = { getParameters: vi.fn(() => ({ encodings: [] })), setParameters: vi.fn(async (_value: unknown) => {}) };
  addTrack = vi.fn((_track: Track, _stream: Stream) => this.sender);
  createOffer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => Peer.nextOffer ?? { type: 'offer', sdp: 'offer' });
  createAnswer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({ type: 'answer', sdp: 'answer' }));
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => { this.localDescription = description; });
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    if (Peer.nextRemote) await Peer.nextRemote;
    this.remoteDescription = description;
  });
  addIceCandidate = vi.fn(async (_candidate?: RTCIceCandidateInit) => {});
  getStats = vi.fn(async () => stats());
  close = vi.fn(() => { this.connectionState = 'closed'; });
  constructor(readonly configuration: RTCConfiguration) { Peer.peers.push(this); }
  connect() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); }
  track(track = new Track()) { this.ontrack?.({ track, streams: [new Stream([track])] }); return track; }
}

const presentation = (generation = 1): Presentation => ({ captureId: `capture-${generation}`, tabId: 12, documentId: `document-${generation}`, generation, viewportWidth: 1280, viewportHeight: 720, offsetLeft: 0, offsetTop: 0, scale: 1 });
function harness(role: 'host' | 'guest' = 'host') {
  const hooks = { send: vi.fn<(message: MediaSignal) => void>(), stream: vi.fn(), error: vi.fn() };
  const session = new MediaSession(role, [{ urls: 'stun:example.com:3478' }], hooks);
  const original = new Track();
  const source = new Stream([original]) as unknown as MediaStream;
  const peer = () => Peer.peers.at(-1)!;
  const offers = () => hooks.send.mock.calls.map(([message]) => message).filter(message => message.type === 'media.signal' && message.payload.type === 'offer');
  const visible = () => hooks.stream.mock.calls.filter(([stream]) => !!stream);
  return { hooks, session, original, source, peer, offers, visible };
}
async function offer(session: MediaSession, generation = 1) {
  await session.receive({ type: 'media.reset', generation });
  await session.receive({ type: 'media.signal', generation, presentation: presentation(generation), payload: { type: 'offer', sdp: 'offer' } });
}

describe('generation-scoped video connections', () => {
  beforeEach(() => {
    vi.useFakeTimers(); Peer.peers = []; Peer.nextOffer = undefined; Peer.nextRemote = undefined;
    vi.stubGlobal('RTCPeerConnection', Peer); vi.stubGlobal('MediaStream', Stream);
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('sends a reset synchronously, transmits only a live video clone, and preserves the authorized source', async () => {
    const h = harness();
    const pending = h.session.present(presentation(), h.source);
    expect(h.hooks.send).toHaveBeenCalledExactlyOnceWith({ type: 'media.reset', generation: 1 });
    await pending;
    expect(h.offers()).toHaveLength(1);
    const clone = h.original.clones[0];
    expect(clone.enabled).toBe(true); expect(clone.contentHint).toBe('detail');
    expect(h.peer().sender.setParameters).toHaveBeenCalledWith({ encodings: [{ maxBitrate: 2_500_000, maxFramerate: 24 }] });
    expect(h.peer().addTrack.mock.calls[0][0]).toBe(clone);
    expect(h.original.enabled).toBe(false);
    h.session.stop();
    expect(clone.stop).toHaveBeenCalledOnce(); expect(h.original.stop).not.toHaveBeenCalled();
    expect(h.peer().close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('cannot send an old offer after replacement or stop while createOffer is pending', async () => {
    const h = harness(); const pendingOffer = Promise.withResolvers<RTCSessionDescriptionInit>(); Peer.nextOffer = pendingOffer.promise;
    const first = h.session.present(presentation(), h.source); await settled();
    const firstPeer = h.peer(); Peer.nextOffer = undefined;
    await h.session.present(presentation(2), h.source);
    pendingOffer.resolve({ type: 'offer', sdp: 'old offer' }); await first;
    expect(firstPeer.setLocalDescription).not.toHaveBeenCalled();
    expect(h.offers().map(message => message.generation)).toEqual([2]);
    expect(h.original.clones[0].stop).toHaveBeenCalledOnce();

    const next = Promise.withResolvers<RTCSessionDescriptionInit>(); Peer.nextOffer = next.promise;
    const last = h.session.present(presentation(3), h.source); await settled(); h.session.stop();
    next.resolve({ type: 'offer', sdp: 'stopped offer' }); await last;
    expect(h.offers().map(message => message.generation)).toEqual([2]);
    expect(h.original.clones.every(track => track.stop.mock.calls.length === 1)).toBe(true);
  });

  it('allows a waiting generation to become ready without retaining a previous connection', async () => {
    const h = harness();
    await h.session.present(undefined, undefined, 5);
    expect(Peer.peers).toHaveLength(0);
    await h.session.present(presentation(5), h.source);
    expect(h.offers().map(message => message.generation)).toEqual([5]);
    await h.session.present(presentation(4), h.source);
    await h.session.present(presentation(5), h.source);
    expect(Peer.peers).toHaveLength(1);
    h.session.stop();
  });

  it('lets the guest negotiate when a waiting host becomes ready in the same generation', async () => {
    const host = harness(); const guest = harness('guest');
    await host.session.present(undefined, undefined, 4);
    await host.session.present(undefined, undefined, 4);
    await host.session.present(presentation(4), host.source);
    const hostPeer = Peer.peers[0];
    for (const [message] of host.hooks.send.mock.calls) await guest.session.receive(message);
    for (const [message] of guest.hooks.send.mock.calls) await host.session.receive(message);
    expect(host.hooks.send.mock.calls.filter(([message]) => message.type === 'media.reset')).toHaveLength(1);
    expect(hostPeer.remoteDescription?.type).toBe('answer');
    guest.peer().connect(); await settled(); guest.peer().track();
    expect(guest.visible()[0][1].generation).toBe(4);
    host.session.stop(); guest.session.stop();
  });

  it('waits for both a received track and a verified direct candidate pair before exposing video', async () => {
    const h = harness('guest'); await offer(h.session);
    const track = h.peer().track();
    expect(h.visible()).toHaveLength(0);
    h.peer().connect(); await settled();
    expect(h.visible()).toHaveLength(1);
    expect(h.visible()[0][1]).toEqual(presentation());
    expect((h.visible()[0][0] as Stream).getVideoTracks()).toEqual([track]);
    expect(vi.getTimerCount()).toBe(0);
    h.session.stop(); expect(track.stop).toHaveBeenCalledOnce();
  });

  it('also exposes a track that arrives after direct route verification', async () => {
    const h = harness('guest'); await offer(h.session);
    h.peer().connect(); await settled(); expect(h.visible()).toHaveLength(0);
    h.peer().track(); expect(h.visible()).toHaveLength(1);
    h.session.stop();
  });

  it('clears the old stream on reset and ignores late tracks, offers, ICE, and stale reset messages', async () => {
    const h = harness('guest'); await offer(h.session);
    const oldPeer = h.peer(); const lateTrack = oldPeer.ontrack!;
    const firstTrack = oldPeer.track(); oldPeer.connect(); await settled();
    await h.session.receive({ type: 'media.reset', generation: 2 });
    expect(h.hooks.stream).toHaveBeenLastCalledWith(undefined, undefined);
    expect(firstTrack.stop).toHaveBeenCalledOnce();
    const oldTrack = new Track(); lateTrack({ track: oldTrack, streams: [] });
    expect(oldTrack.stop).toHaveBeenCalledOnce();
    await h.session.receive({ type: 'media.signal', generation: 1, presentation: presentation(), payload: { type: 'offer', sdp: 'old' } });
    await h.session.receive({ type: 'media.signal', generation: 1, payload: { type: 'ice', candidate: { candidate: 'old' } } });
    expect(Peer.peers).toHaveLength(1); expect(oldPeer.addIceCandidate).not.toHaveBeenCalled();
    await h.session.receive({ type: 'media.signal', generation: 2, presentation: presentation(2), payload: { type: 'offer', sdp: 'new' } });
    const newPeer = h.peer(); await h.session.receive({ type: 'media.reset', generation: 1 });
    await h.session.receive({ type: 'media.signal', generation: 1, payload: { type: 'ice', candidate: { candidate: 'a=candidate:0 1 udp 1 host 1 typ relay' } } });
    expect(newPeer.close).not.toHaveBeenCalled();
    expect(h.hooks.error).not.toHaveBeenCalled();
    newPeer.connect(); await settled(); newPeer.track();
    expect(h.visible().map(call => call[1].generation)).toEqual([1, 2]);
    h.session.stop();
  });

  it('cannot answer or deliver a stream after stop during setRemoteDescription', async () => {
    const h = harness('guest'); const remote = Promise.withResolvers<void>(); Peer.nextRemote = remote.promise;
    const pending = offer(h.session); await settled();
    const oldPeer = h.peer(); const lateTrack = oldPeer.ontrack!;
    h.session.stop(); remote.resolve(); await pending;
    lateTrack({ track: new Track(), streams: [] });
    expect(oldPeer.createAnswer).not.toHaveBeenCalled(); expect(h.visible()).toHaveLength(0);
    await offer(h.session, 2); expect(Peer.peers).toHaveLength(1);
    expect(h.hooks.error).not.toHaveBeenCalled();
  });

  it('ignores old host answers and cannot flush pending ICE after stop during remote description', async () => {
    const h = harness(); await h.session.present(presentation(), h.source);
    await h.session.present(presentation(2), h.source);
    await h.session.receive({ type: 'media.signal', generation: 1, payload: { type: 'answer', sdp: 'old' } });
    expect(h.peer().setRemoteDescription).not.toHaveBeenCalled();
    await h.session.receive({ type: 'media.signal', generation: 2, payload: { type: 'ice', candidate: { candidate: 'candidate' } } });
    const remote = Promise.withResolvers<void>(); Peer.nextRemote = remote.promise;
    const pending = h.session.receive({ type: 'media.signal', generation: 2, payload: { type: 'answer', sdp: 'answer' } });
    await settled(); h.session.stop(); remote.resolve(); await pending;
    expect(h.peer().addIceCandidate).not.toHaveBeenCalled();
  });

  it('queues candidates before the offer and forwards the end-of-candidates marker', async () => {
    const h = harness('guest'); await h.session.receive({ type: 'media.reset', generation: 1 });
    await h.session.receive({ type: 'media.signal', generation: 1, payload: { type: 'ice', candidate: { candidate: 'candidate' } } });
    await h.session.receive({ type: 'media.signal', generation: 1, payload: { type: 'ice', candidate: null } });
    await h.session.receive({ type: 'media.signal', generation: 1, presentation: presentation(), payload: { type: 'offer', sdp: 'offer' } });
    expect(h.peer().addIceCandidate.mock.calls).toEqual([[{ candidate: 'candidate' }], [undefined]]);
    h.peer().onicecandidate?.({ candidate: null });
    expect(h.hooks.send).toHaveBeenLastCalledWith({ type: 'media.signal', generation: 1, payload: { type: 'ice', candidate: null } });
    h.session.stop();
  });

  it('bounds ICE candidates and seals overflowed generations until the next host reset', async () => {
    const h = harness('guest'); await h.session.receive({ type: 'media.reset', generation: 1 });
    for (let i = 0; i < 101; i++) await h.session.receive({ type: 'media.signal', generation: 1, payload: { type: 'ice', candidate: { candidate: `candidate-${i}` } } });
    await h.session.receive({ type: 'media.signal', generation: 1, presentation: presentation(), payload: { type: 'offer', sdp: 'offer' } });
    expect(Peer.peers).toHaveLength(0); expect(h.hooks.error).toHaveBeenCalledExactlyOnceWith('Too many pending video candidates.');
    await offer(h.session, 2); expect(Peer.peers).toHaveLength(1); h.session.stop();
  });

  it('rejects relay signals and relay-selected pairs before exposing video', async () => {
    const h = harness('guest'); await offer(h.session); h.peer().track();
    h.peer().getStats.mockResolvedValue(stats('host', 'relay'));
    h.peer().connect(); await settled();
    expect(h.visible()).toHaveLength(0); expect(h.hooks.error).toHaveBeenCalledExactlyOnceWith('Relayed video connections are not allowed.');
    expect(h.peer().close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    await h.session.receive({ type: 'media.signal', generation: 1, presentation: presentation(), payload: { type: 'offer', sdp: 'offer' } });
    expect(Peer.peers).toHaveLength(1);
    await h.session.receive({ type: 'media.reset', generation: 2 });
    await h.session.receive({ type: 'media.signal', generation: 2, presentation: presentation(2), payload: { type: 'offer', sdp: 'a=candidate:0 1 udp 1 host 1 typ relay' } });
    expect(Peer.peers).toHaveLength(1); expect(h.hooks.error).toHaveBeenCalledTimes(2);
    h.session.stop();
  });

  it('also verifies the host route and stops only cloned video on a relay result', async () => {
    const h = harness(); await h.session.present(presentation(), h.source);
    h.peer().getStats.mockResolvedValue(stats('relay', 'host')); h.peer().connect(); await settled();
    expect(h.original.clones[0].stop).toHaveBeenCalledOnce(); expect(h.original.stop).not.toHaveBeenCalled();
    expect(h.hooks.send).toHaveBeenLastCalledWith({ type: 'media.reset', generation: 1 });
    expect(h.hooks.error).toHaveBeenCalledExactlyOnceWith('Relayed video connections are not allowed.');
    h.session.stop();
  });

  it('does not expose a stream from an old pending stats result', async () => {
    const h = harness('guest'); await offer(h.session); h.peer().track();
    const pendingStats = Promise.withResolvers<ReturnType<typeof stats>>(); h.peer().getStats.mockReturnValue(pendingStats.promise);
    h.peer().connect(); await settled(); await h.session.receive({ type: 'media.reset', generation: 2 });
    pendingStats.resolve(stats()); await settled();
    expect(h.visible()).toHaveLength(0); expect(vi.getTimerCount()).toBe(0); h.session.stop();
  });

  it('times out media without stopping the authorized capture and does not retry automatically', async () => {
    const h = harness(); await h.session.present(presentation(), h.source);
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.hooks.error).toHaveBeenCalledExactlyOnceWith('The shared video connection timed out.');
    expect(h.original.stop).not.toHaveBeenCalled(); expect(h.original.clones[0].stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30000); expect(Peer.peers).toHaveLength(1);
    await h.session.present(presentation(), h.source); expect(Peer.peers).toHaveLength(1);
    await h.session.present(presentation(2), h.source); expect(Peer.peers).toHaveLength(2); h.session.stop();
  });

  it('bounds direct-route verification retries and clears them on stop', async () => {
    const h = harness('guest'); await offer(h.session);
    h.peer().getStats.mockResolvedValue(new Map()); h.peer().connect(); await settled();
    await vi.advanceTimersByTimeAsync(1900);
    expect(h.peer().getStats).toHaveBeenCalledTimes(20);
    expect(h.hooks.error).toHaveBeenCalledExactlyOnceWith('Could not verify a direct video connection.');
    expect(vi.getTimerCount()).toBe(0); h.session.stop();
  });

  it('requires ordered resets, matching presentation generations, and fresh offers after cancellation', async () => {
    const h = harness('guest');
    const message: MediaSignal = { type: 'media.signal', generation: 1, presentation: presentation(), payload: { type: 'offer', sdp: 'offer' } };
    await h.session.receive(message); expect(Peer.peers).toHaveLength(0);
    await h.session.receive({ type: 'media.reset', generation: 1 });
    await h.session.receive({ ...message, presentation: presentation(2) }); expect(Peer.peers).toHaveLength(0);
    await h.session.receive(message); expect(Peer.peers).toHaveLength(1);
    await h.session.receive(message); expect(Peer.peers).toHaveLength(1);
    await h.session.receive({ type: 'media.reset', generation: 1 });
    await h.session.receive(message); expect(Peer.peers).toHaveLength(1);
    expect(h.peer().close).toHaveBeenCalledOnce(); h.session.stop();
  });

  it('rejects TURN configuration before allocating a peer', () => {
    expect(() => new MediaSession('host', [{ urls: ['stun:example.com', 'turn:example.com'] }], { send: vi.fn(), stream: vi.fn(), error: vi.fn() })).toThrow('only support STUN');
    expect(Peer.peers).toHaveLength(0);
  });
});
