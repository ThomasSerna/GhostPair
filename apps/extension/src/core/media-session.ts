import { isRelaySignal, type MediaSignal, type Presentation, type SignalPayload } from '@ghostpair/protocol';

export type { MediaSignal, Presentation } from '@ghostpair/protocol';

interface MediaHooks {
  send: (message: MediaSignal) => void;
  stream: (stream: MediaStream | undefined, presentation: Presentation | undefined) => void;
  error: (message: string) => void;
}

interface Connection {
  pc: RTCPeerConnection;
  epoch: number;
  presentation: Presentation;
  tracks: MediaStreamTrack[];
  pendingIce: (RTCIceCandidateInit | null)[];
  remoteSet: boolean;
  awaitingAnswer: boolean;
  direct: boolean;
  delivered: boolean;
  verifying: boolean;
  stream?: MediaStream;
  timeout?: ReturnType<typeof setTimeout>;
  retry?: ReturnType<typeof setTimeout>;
}

/** A disposable video connection. The authenticated control connection carries its signals. */
export class MediaSession {
  private generation = -1;
  private epoch = 0;
  private stopped = false;
  private awaitingOffer = false;
  private sealed = false;
  private pendingIce: (RTCIceCandidateInit | null)[] = [];
  private connection?: Connection;

  constructor(private role: 'host' | 'guest', private iceServers: RTCIceServer[], private hooks: MediaHooks) {
    if (!iceServers.every(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).every(url => /^stuns?:[^\s]+$/i.test(url)))) {
      throw new Error('Video connections only support STUN servers.');
    }
  }

  /** The reset is sent before asynchronous offer creation, so input can be blocked immediately. */
  async present(presentation?: Presentation, source?: MediaStream, generation = presentation?.generation ?? this.generation + 1): Promise<void> {
    if (this.stopped || this.role !== 'host' || generation < this.generation) return;
    if (presentation && (presentation.generation !== generation || (generation === this.generation && (this.connection || this.sealed)))) return;
    const repeated = generation === this.generation;
    if (!presentation && repeated && !this.connection) return;
    this.clear();
    this.generation = generation;
    this.sealed = !presentation && repeated;
    if (!repeated || !presentation) this.hooks.send({ type: 'media.reset', generation });
    if (!presentation) return;

    let connection: Connection | undefined;
    try {
      const track = source?.getVideoTracks().find(track => track.readyState === 'live');
      if (!track) throw new Error('The authorized tab has no live video track.');
      connection = this.create(presentation);
      const clone = track.clone();
      clone.enabled = true;
      clone.contentHint = 'detail';
      connection.tracks.push(clone);
      clone.onended = () => this.fail(connection!, 'The shared video ended. Authorize the tab again.');
      const sender = connection.pc.addTrack(clone, new MediaStream([clone]));
      try {
        const parameters = sender.getParameters();
        parameters.encodings = [{ ...parameters.encodings?.[0], maxBitrate: 2_500_000, maxFramerate: 24 }];
        await sender.setParameters(parameters);
      } catch { /* Encoding limits are optional in browsers that do not expose sender parameters yet. */ }
      if (!this.current(connection)) return;
      const offer = await connection.pc.createOffer();
      if (!this.current(connection)) return;
      await connection.pc.setLocalDescription(offer);
      if (!this.current(connection)) return;
      connection.awaitingAnswer = true;
      this.send(connection, { type: 'offer', sdp: connection.pc.localDescription?.sdp ?? offer.sdp ?? '' }, connection.presentation);
    } catch {
      if (connection) this.fail(connection, 'Could not start the shared video.');
      else if (!this.stopped && this.generation === generation) {
        this.sealed = true;
        this.hooks.send({ type: 'media.reset', generation });
        this.hooks.error('The authorized tab has no available video stream.');
      }
    }
  }

  async receive(message: MediaSignal): Promise<void> {
    if (this.stopped || message.generation < this.generation) return;
    if (message.type === 'media.reset') {
      if (this.role !== 'guest') return;
      const fresh = message.generation > this.generation;
      this.clear();
      this.generation = message.generation;
      // A repeated reset ends this generation; an old offer cannot revive its stream.
      this.awaitingOffer = fresh;
      this.sealed = !fresh;
      return;
    }
    // The ordered control channel must deliver a reset before any signal for a new generation.
    if (message.generation !== this.generation || this.sealed) return;
    let connection = this.connection;
    const payload = message.payload;
    if (isRelaySignal(payload)) {
      if (connection) this.fail(connection, 'Relayed video connections are not allowed.');
      else { this.sealed = true; this.awaitingOffer = false; this.pendingIce = []; this.hooks.error('Relayed video connections are not allowed.'); }
      return;
    }
    try {
      if (payload.type === 'offer') {
        if (this.role !== 'guest' || !this.awaitingOffer || connection || message.presentation?.generation !== message.generation) return;
        this.awaitingOffer = false;
        connection = this.create(message.presentation);
        connection.pendingIce = this.pendingIce;
        this.pendingIce = [];
        await connection.pc.setRemoteDescription(payload);
        if (!this.current(connection)) return;
        connection.remoteSet = true;
        await this.flushIce(connection);
        if (!this.current(connection)) return;
        const answer = await connection.pc.createAnswer();
        if (!this.current(connection)) return;
        await connection.pc.setLocalDescription(answer);
        if (this.current(connection)) this.send(connection, { type: 'answer', sdp: connection.pc.localDescription?.sdp ?? answer.sdp ?? '' });
      } else if (payload.type === 'answer') {
        if (this.role !== 'host' || !connection?.awaitingAnswer) return;
        connection.awaitingAnswer = false;
        await connection.pc.setRemoteDescription(payload);
        if (!this.current(connection)) return;
        connection.remoteSet = true;
        await this.flushIce(connection);
      } else if (connection) {
        if (connection.remoteSet) await connection.pc.addIceCandidate(payload.candidate ?? undefined);
        else if (connection.pendingIce.length < 100) connection.pendingIce.push(payload.candidate);
        else this.fail(connection, 'Too many pending video candidates.');
      } else if (this.role === 'guest' && this.awaitingOffer) {
        if (this.pendingIce.length < 100) this.pendingIce.push(payload.candidate);
        else { this.sealed = true; this.awaitingOffer = false; this.pendingIce = []; this.hooks.error('Too many pending video candidates.'); }
      }
    } catch {
      if (connection) this.fail(connection, 'Could not negotiate the shared video.');
      else if (!this.stopped && this.generation === message.generation) {
        this.sealed = true; this.awaitingOffer = false; this.pendingIce = [];
        this.hooks.error('Could not prepare the shared video.');
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.sealed = true;
    this.clear();
  }

  private current(connection: Connection): boolean {
    return !this.stopped && this.connection === connection && connection.epoch === this.epoch;
  }

  private create(presentation: Presentation): Connection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle', iceCandidatePoolSize: 0 });
    const connection: Connection = {
      pc, epoch: this.epoch, presentation: { ...presentation }, tracks: [], pendingIce: [], remoteSet: false,
      awaitingAnswer: false, direct: false, delivered: false, verifying: false,
    };
    this.connection = connection;
    connection.timeout = setTimeout(() => this.fail(connection, 'The shared video connection timed out.'), 10000);
    pc.onicecandidate = event => this.send(connection, { type: 'ice', candidate: event.candidate?.toJSON() ?? null });
    pc.onconnectionstatechange = () => {
      if (!this.current(connection)) return;
      if (pc.connectionState === 'connected') void this.verifyDirect(connection);
      else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) this.fail(connection, 'The shared video connection ended.');
    };
    pc.ontrack = event => {
      if (!this.current(connection)) { event.track.stop(); return; }
      if (this.role !== 'guest' || event.track.kind !== 'video' || connection.stream) {
        event.track.stop(); this.fail(connection, 'The peer sent an unexpected media track.'); return;
      }
      connection.tracks.push(event.track);
      connection.stream = new MediaStream([event.track]);
      event.track.onended = () => this.fail(connection, 'The shared video ended.');
      this.deliver(connection);
    };
    return connection;
  }

  private send(connection: Connection, payload: SignalPayload, presentation?: Presentation): void {
    if (!this.current(connection)) return;
    if (isRelaySignal(payload)) { this.fail(connection, 'Relayed video connections are not allowed.'); return; }
    this.hooks.send({ type: 'media.signal', generation: connection.presentation.generation, payload, ...(presentation ? { presentation } : {}) });
  }

  private async flushIce(connection: Connection): Promise<void> {
    while (this.current(connection) && connection.pendingIce.length) {
      await connection.pc.addIceCandidate(connection.pendingIce.shift() ?? undefined);
    }
  }

  private async verifyDirect(connection: Connection, attempt = 0): Promise<void> {
    if (!this.current(connection) || connection.verifying) return;
    connection.verifying = true;
    try {
      const stats = await connection.pc.getStats();
      if (!this.current(connection)) return;
      let pair: RTCStats | undefined;
      stats.forEach(report => { if (report.type === 'transport' && report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId); });
      if (!pair) stats.forEach(report => { if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) pair = report; });
      const selected = pair as RTCIceCandidatePairStats | undefined;
      if (selected) {
        const local = stats.get(selected.localCandidateId!);
        const remote = stats.get(selected.remoteCandidateId!);
        if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') {
          this.fail(connection, 'Relayed video connections are not allowed.'); return;
        }
        if (['host', 'srflx', 'prflx'].includes(local?.candidateType) && ['host', 'srflx', 'prflx'].includes(remote?.candidateType)) {
          connection.direct = true;
          if (this.role === 'host') clearTimeout(connection.timeout);
          this.deliver(connection);
          return;
        }
      }
      if (attempt >= 19) { this.fail(connection, 'Could not verify a direct video connection.'); return; }
      connection.retry = setTimeout(() => { void this.verifyDirect(connection, attempt + 1); }, 100);
    } catch {
      this.fail(connection, 'Could not verify a direct video connection.');
    } finally {
      connection.verifying = false;
    }
  }

  private deliver(connection: Connection): void {
    if (!this.current(connection) || this.role !== 'guest' || !connection.direct || !connection.stream || connection.delivered) return;
    connection.delivered = true;
    clearTimeout(connection.timeout);
    this.hooks.stream(connection.stream, connection.presentation);
  }

  private fail(connection: Connection, message: string): void {
    if (!this.current(connection)) return;
    this.sealed = true;
    this.clear();
    if (this.role === 'host') this.hooks.send({ type: 'media.reset', generation: this.generation });
    this.hooks.error(message);
  }

  private clear(): void {
    ++this.epoch;
    const previous = this.connection;
    this.connection = undefined;
    this.awaitingOffer = false;
    this.pendingIce = [];
    if (previous) {
      clearTimeout(previous.timeout); clearTimeout(previous.retry);
      previous.pc.onicecandidate = null; previous.pc.onconnectionstatechange = null; previous.pc.ontrack = null;
      for (const track of previous.tracks) { track.onended = null; track.stop(); }
      previous.pc.close();
    }
    this.hooks.stream(undefined, undefined);
  }
}
