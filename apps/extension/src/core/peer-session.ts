import { z } from 'zod';
import { ControlModeSchema, ControlCommandSchema, PresentationSchema, MediaSignalSchema, SettingsSchema, ServerSignalMessageSchema, isRelaySignal, PROTOCOL_VERSION, MAX_CLIPBOARD_BYTES, type ControlCommand, type Settings, type SignalPayload, type Presentation, type MediaSignal } from '@ghostpair/protocol';
import { MediaSession } from './media-session';
import { ClipboardSync, type ClipboardAdapter, type ClipboardUpdate } from './clipboard';


type Role = 'host' | 'guest';
export const SnapshotSchema = z.object({
  controlMode: ControlModeSchema, controlRevision: z.number().int().nonnegative(),
  presentation: PresentationSchema.optional(), paused: z.boolean(), controlEnabled: z.boolean(), clipboardEnabled: z.boolean(),
  activeTabId: z.number().int().nonnegative().optional(), generation: z.number().int().nonnegative(),
  tabs: z.array(z.object({ id: z.number().int().nonnegative(), title: z.string().max(4096), url: z.string().max(8192), active: z.boolean(), supported: z.boolean(), authorized: z.boolean().optional(), captureState: z.enum(['pending', 'ready', 'unavailable']).optional() }).strict()).max(500),
}).strict();
type Snapshot = z.infer<typeof SnapshotSchema>;
const PeerMessageSchema = z.discriminatedUnion('type', [...MediaSignalSchema.options,
  z.object({ type: z.literal('hello'), protocol: z.number().int(), sessionId: z.string().max(128), role: z.enum(['host', 'guest']) }).strict(),
  z.object({ type: z.literal('snapshot'), snapshot: SnapshotSchema }).strict(),
  z.object({ type: z.literal('command'), command: ControlCommandSchema, requestId: z.string().max(64).optional() }).strict(),
  z.object({ type: z.literal('command.result'), requestId: z.string().max(64), ok: z.boolean(), error: z.string().max(512).optional() }).strict(),
  z.object({ type: z.literal('clipboard.enabled'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('notice'), message: z.string().max(512) }).strict(),
  z.object({ type: z.literal('stop'), reason: z.string().max(512) }).strict(),
  z.object({ type: z.literal('ping'), time: z.number().finite() }).strict(),
  z.object({ type: z.literal('pong'), time: z.number().finite() }).strict(),
]);

const FragmentSchema = z.object({ transfer: z.string().max(64), index: z.number().int().nonnegative(), count: z.number().int().min(1).max(256), data: z.string().max(4000) }).strict();
export class JsonChannel {
  private queue: string[] = [];
  private bytes = 0;
  private partial = new Map<string, { count: number; parts: Map<number, string>; size: number; until: number }>();
  private sequence = 0;
  private failed = false;
  constructor(private channel: RTCDataChannel, private receive: (value: unknown) => void, private failure: () => void) {
    channel.bufferedAmountLowThreshold = 32 * 1024;
    channel.onbufferedamountlow = () => this.flush();
    channel.onmessage = event => this.message(event.data);
  }
  send(value: unknown): boolean {
    const text = JSON.stringify(value);
    if (this.failed || text.length > 900_000 || this.bytes + text.length > 1_000_000 || this.channel.readyState !== 'open') return false;
    const transfer = String(++this.sequence);
    const count = Math.ceil(text.length / 4000);
    const packets = text.length <= 4000 ? [text] : Array.from({ length: count }, (_, index) => JSON.stringify({ transfer, index, count, data: text.slice(index * 4000, (index + 1) * 4000) }));
    if (this.bytes + packets.reduce((size, packet) => size + packet.length, 0) > 1_000_000) return false;
    for (const packet of packets) { this.queue.push(packet); this.bytes += packet.length; }
    this.flush(); return !this.failed;
  }
  private flush() {
    while (this.queue.length && this.channel.readyState === 'open' && this.channel.bufferedAmount < 64 * 1024) {
      const packet = this.queue.shift()!; this.bytes -= packet.length;
      try { this.channel.send(packet); } catch { this.failed = true; this.clear(); this.failure(); break; }
    }
  }
  clear() { this.queue = []; this.bytes = 0; this.partial.clear(); }
  private message(data: unknown) {
    if (typeof data !== 'string' || data.length > 20_000) return;
    let value: unknown; try { value = JSON.parse(data); } catch { return; }
    if (typeof value !== 'object' || !value) return;
    if (!('transfer' in value)) { this.receive(value); return; }
    const result = FragmentSchema.safeParse(value); if (!result.success) return;
    const f = result.data; if (f.index >= f.count) return;
    for (const [id, item] of this.partial) if (item.until < Date.now()) this.partial.delete(id);
    let entry = this.partial.get(f.transfer);
    if (!entry) { if (this.partial.size >= 2) return; entry = { count: f.count, parts: new Map(), size: 0, until: Date.now() + 5000 }; this.partial.set(f.transfer, entry); }
    if (entry.count !== f.count || entry.parts.has(f.index)) return;
    entry.size += f.data.length;
    if (entry.size > 900_000) { this.partial.delete(f.transfer); return; }
    entry.parts.set(f.index, f.data);
    if (entry.parts.size !== f.count) return;
    this.partial.delete(f.transfer);
    try { this.receive(JSON.parse(Array.from({ length: f.count }, (_, i) => entry!.parts.get(i)!).join(''))); } catch { /* invalid peer message */ }
  }
}

export function createPeerSession(notify: (type: string, payload?: Record<string, any>) => void, dispatch: (message: Record<string, any>) => Promise<any>, clipboardAdapter: ClipboardAdapter, mediaHooks: { stream?: (stream: MediaStream | undefined, meta: Presentation | undefined) => void; source?: (captureId: string) => MediaStream | undefined } = {}) {
let role: Role | undefined;
let sessionId: string | undefined;
let socket: WebSocket | undefined;
let peer: RTCPeerConnection | undefined;
let controlChannel: RTCDataChannel | undefined;
let media: MediaSession | undefined; let mediaKey = ''; let pendingMedia: MediaSignal[] = [];
let clipboardChannel: RTCDataChannel | undefined;
let controlPipe: JsonChannel | undefined;
let clipboardPipe: JsonChannel | undefined;
let clipboardSync: ClipboardSync | undefined;
let clipboardEnabled = false;
let remoteClipboardEnabled = false;
let paused = false;
let connected = false;
let direct = false;
let greeted = false;
let ending = false;
let epoch = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let pulse: ReturnType<typeof setInterval> | undefined;
let negotiation: Promise<void> = Promise.resolve();
let pendingIce: (RTCIceCandidateInit | null)[] = [];
let latestSnapshot: Snapshot | undefined;


let commandsPerSecond = 0;
let commandWindow = 0;
let inputRevision = 0;


const pendingCommands = new Map<string, { resolve: (value: { ok: boolean; error?: string }) => void; timer: ReturnType<typeof setTimeout> }>();


function sendPeer(value: unknown) {
  const sent = controlPipe?.send(value) ?? false;
  if (!sent && connected && !ending) fail('The control connection is congested. Start a new session.');
  return sent;
}
function sendSignal(payload: SignalPayload) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !sessionId || isRelaySignal(payload)) return;
  socket.send(JSON.stringify({ type: 'signal', sessionId, payload }));
}

function syncClipboard() {
  if (connected && greeted && clipboardEnabled && remoteClipboardEnabled && !paused && clipboardChannel?.readyState === 'open') void clipboardSync?.start();
  else clipboardSync?.stop();
}

function cleanup(reason = 'Session ended.', inform = false, failed = false) {
  if (ending) return;
  ending = true; ++epoch;
  for (const pending of pendingCommands.values()) { clearTimeout(pending.timer); pending.resolve({ ok: false, error: 'Session ended.' }); }
  pendingCommands.clear();
  clipboardSync?.stop(); clipboardSync = undefined;
  if (connected) sendPeer({ type: 'stop', reason: reason.slice(0, 512) });
  if (role === 'host' && sessionId && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'host.close', sessionId }));
  clearTimeout(timer); clearInterval(pulse); timer = undefined; pulse = undefined;
  controlPipe?.clear(); clipboardPipe?.clear(); controlPipe = undefined; clipboardPipe = undefined;
  const previous = peer; peer = undefined;
  previous?.close(); socket?.close(); socket = undefined;
  controlChannel = undefined; clipboardChannel = undefined; media?.stop(); media = undefined; mediaKey = ''; pendingMedia = [];
  connected = false; direct = false; greeted = false; role = undefined; sessionId = undefined;
  clipboardEnabled = false; remoteClipboardEnabled = false; paused = false;
  latestSnapshot = undefined; pendingIce = [];
  commandsPerSecond = 0; commandWindow = 0;
  ++inputRevision;
  ending = false;
  if (inform) notify('transport.ended', { reason, failed });
}
function fail(reason: string) { cleanup(reason, true, true); }

async function verifyDirect(pc: RTCPeerConnection, current: number) {
  for (let i = 0; i < 20 && peer === pc && epoch === current; i++) {
    const stats = await pc.getStats();
    if (peer !== pc || epoch !== current) return;
    let selected: any;
    stats.forEach(report => { if (report.type === 'transport' && report.selectedCandidatePairId) selected = stats.get(report.selectedCandidatePairId); });
    if (!selected) stats.forEach(report => { if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) selected = report; });
    if (selected) {
      const local = stats.get(selected.localCandidateId); const remote = stats.get(selected.remoteCandidateId);
      if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') { fail('GhostPair cannot use this connection. Try another network.'); return; }
      if (local?.candidateType && remote?.candidateType) { direct = true; await establish(); return; }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (peer === pc && epoch === current) fail('Could not verify the connection between the devices. Try another network.');
}

async function establish() {
  if (connected || !direct || !greeted || !sessionId || !role || controlChannel?.readyState !== 'open') return;
  connected = true; clearTimeout(timer);
  const current = epoch;
  clipboardSync = new ClipboardSync(role, clipboardAdapter, update => {
    if (!clipboardPipe?.send(update)) notify('transport.notice', { message: 'Clipboard sharing is busy. The latest copied text was not sent.' });
  }, message => {
    if (!clipboardSync?.isActive) { clipboardEnabled = false; sendPeer({ type: 'clipboard.enabled', enabled: false }); notify('transport.clipboard', { remoteEnabled: remoteClipboardEnabled, disabled: true }); }
    notify('transport.notice', { message });
  });
  sendPeer({ type: 'clipboard.enabled', enabled: clipboardEnabled });
  notify('transport.connected', { sessionId });
  syncClipboard();
  if (latestSnapshot && role === 'guest') notify('transport.snapshot', { snapshot: latestSnapshot });
  const queued = pendingMedia; pendingMedia = [];
  for (const message of queued) { if (epoch !== current) return; await media?.receive(message); }
}

async function receiveControl(message: z.infer<typeof PeerMessageSchema>) {
  if (message.type === 'hello') {
    if (message.protocol !== PROTOCOL_VERSION) { fail('Incompatible GhostPair versions. Update both extensions.'); return; }
    if (message.sessionId !== sessionId || message.role === role) { fail('The session identity does not match.'); return; }
    greeted = true; await establish(); return;
  }
  if (!greeted) return;
  if (!connected) {
    if (message.type === 'media.reset' || message.type === 'media.signal') { if (pendingMedia.length < 100) pendingMedia.push(message); return; }
    // Data channels can open before getStats verifies the candidate pair.
    // Keep authenticated initial state so a static page does not need a second frame.
    if (message.type === 'snapshot' && role === 'guest') { latestSnapshot = message.snapshot; paused = latestSnapshot.paused; remoteClipboardEnabled = latestSnapshot.clipboardEnabled; }
    if (message.type === 'clipboard.enabled') remoteClipboardEnabled = message.enabled;
    if (message.type === 'stop') cleanup(message.reason, true);
    return;
  }
  switch (message.type) {
    case 'media.reset': case 'media.signal': await media?.receive(message); break;
    case 'snapshot':
      if (role !== 'guest') return;
      latestSnapshot = message.snapshot; paused = latestSnapshot.paused; remoteClipboardEnabled = latestSnapshot.clipboardEnabled;
      notify('transport.snapshot', { snapshot: latestSnapshot });
      syncClipboard();
      break;
    case 'command': {
      if (role !== 'host' || paused) return;
      if (latestSnapshot && message.command.controlRevision !== latestSnapshot.controlRevision) {
        if (message.requestId) sendPeer({ type: 'command.result', requestId: message.requestId, ok: false, error: 'The interaction mode changed.' });
        return;
      }
      if (Date.now() - commandWindow >= 1000) { commandWindow = Date.now(); commandsPerSecond = 0; }
      if (message.command.type !== 'input.release' && ++commandsPerSecond > 250) { fail('The participant exceeded the input rate limit. Start a new session.'); return; }
      const current = epoch, revision = inputRevision;
      let reply;
      try { reply = await dispatch({ type: 'transport.command', command: message.command }); }
      catch {
        if (epoch === current && revision === inputRevision) { fail('Page controls stopped working. Start a new session.'); return; }
      }
      if (epoch !== current) return;
      if (revision !== inputRevision && reply?.ok !== true) {
        if (message.requestId) sendPeer({ type: 'command.result', requestId: message.requestId, ok: false, error: 'The input was canceled.' });
        return;
      }
      if (message.requestId) sendPeer({ type: 'command.result', requestId: message.requestId, ok: reply?.ok === true, ...(reply?.error ? { error: String(reply.error).slice(0, 512) } : {}) });
      else if (!reply?.ok) sendPeer({ type: 'notice', message: reply?.error ?? 'Could not apply the action.' });
      break;
    }
    case 'command.result': {
      const pending = pendingCommands.get(message.requestId);
      if (pending) { clearTimeout(pending.timer); pendingCommands.delete(message.requestId); pending.resolve(message); }
      break;
    }
    case 'clipboard.enabled': remoteClipboardEnabled = message.enabled; notify('transport.clipboard', { remoteEnabled: remoteClipboardEnabled }); syncClipboard(); break;
    case 'notice': notify('transport.notice', { message: message.message }); break;
    case 'stop': cleanup(message.reason, true); break;
    case 'ping': sendPeer({ type: 'pong', time: message.time }); break;
  }
}

function attachChannel(channel: RTCDataChannel, current: number) {
  if (channel.label === 'control') {
    if (controlChannel) { channel.close(); return; }
    controlChannel = channel;
    let controls: Promise<void> = Promise.resolve();
    let pendingControls = 0;
    controlPipe = new JsonChannel(channel, value => {
      if (epoch !== current) return;
      const reset = connected && greeted && typeof value === 'object' && value !== null && 'type' in value && value.type === 'media.reset';
      if (!reset && ++pendingControls > 256) { fail('The participant sent too many pending commands.'); return; }
      const parsed = PeerMessageSchema.safeParse(value);
      const message = parsed.success ? parsed.data : undefined;
      if (reset) { if (message) void receiveControl(message); return; }
      const command = message?.type === 'command' ? message.command : undefined;
      if (command && connected && greeted && role === 'host' && (paused || latestSnapshot?.controlEnabled === false) && command.type !== 'input.release') {
        --pendingControls;
        if (message?.type === 'command' && message.requestId) sendPeer({ type: 'command.result', requestId: message.requestId, ok: false, error: 'Remote control is unavailable.' });
        return;
      }
      const p = latestSnapshot?.presentation;
      const cancels = connected && greeted && role === 'host' && command?.type === 'input.release' && p &&
        command.tabId === p.tabId && command.captureId === p.captureId && command.documentId === p.documentId && command.generation === p.generation && command.controlRevision === latestSnapshot?.controlRevision;
      if (message && ((connected && greeted && message.type === 'stop') || cancels)) {
        ++inputRevision;
        // Cancel in-flight host input immediately, without waiting behind a slow route.
        const cancellation = receiveControl(message).finally(() => { --pendingControls; });
        controls = Promise.allSettled([controls, cancellation]).then(() => undefined);
        return;
      }
      const revision = inputRevision;
      controls = controls.then(async () => {
        if (epoch !== current) return;
        if (command && revision !== inputRevision) {
          if (message?.type === 'command' && message.requestId) sendPeer({ type: 'command.result', requestId: message.requestId, ok: false, error: 'The input was canceled.' });
          return;
        }
        if (message) await receiveControl(message);
      }).catch(() => undefined).finally(() => { --pendingControls; });
    }, () => { if (epoch === current && !ending) fail('The control connection could not send input. Start a new session.'); });
    channel.onopen = () => { if (epoch !== current) return; sendPeer({ type: 'hello', protocol: PROTOCOL_VERSION, sessionId, role }); };
    channel.onclose = () => { if (epoch === current && !ending && role) cleanup('The other participant disconnected.', true); };
  } else if (channel.label === 'clipboard') {
    if (clipboardChannel) { channel.close(); return; }
    clipboardChannel = channel;
    clipboardPipe = new JsonChannel(channel, value => {
      if (epoch !== current || !connected || !clipboardEnabled || !remoteClipboardEnabled || paused || !value || typeof value !== 'object') return;
      const update = value as ClipboardUpdate;
      if (update.origin !== (role === 'host' ? 'guest' : 'host') || typeof update.text !== 'string' || update.text.length > MAX_CLIPBOARD_BYTES) return;
      void clipboardSync?.receive(update);
    }, () => { if (epoch === current && !ending) fail('The clipboard connection failed. Start a new session.'); });
    channel.onopen = syncClipboard;
    channel.onclose = () => { clipboardSync?.stop(); };
  } else channel.close();
}

async function createPeer(settings: Settings, current: number) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: settings.stunUrls }], bundlePolicy: 'max-bundle', iceCandidatePoolSize: 0 });
  peer = pc; direct = false; greeted = false;
  media = new MediaSession(role!, [{ urls: settings.stunUrls }], { send: message => { sendPeer(message); }, stream: (stream, meta) => mediaHooks.stream?.(stream, meta), error: message => notify('transport.notice', { message }) });
  pc.onicecandidate = event => { if (epoch === current) sendSignal({ type: 'ice', candidate: event.candidate?.toJSON() ?? null }); };
  pc.onconnectionstatechange = () => {
    if (peer !== pc || epoch !== current || ending) return;
    if (pc.connectionState === 'connected') void verifyDirect(pc, current).catch(() => { if (peer === pc && epoch === current) fail('Could not verify the connection.'); });
    else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) cleanup('The session connection was interrupted. Start a new session.', true, true);
  };
  pc.ondatachannel = event => { if (peer === pc && epoch === current) attachChannel(event.channel, current); else event.channel.close(); };
  timer = setTimeout(() => { if (epoch === current && !connected) fail('Could not connect within 30 seconds. Your network may be blocking the connection. Try another network.'); }, 30000);
  if (role === 'host') {
    attachChannel(pc.createDataChannel('control', { ordered: true }), current);

    attachChannel(pc.createDataChannel('clipboard', { ordered: true }), current);
    const offer = await pc.createOffer();
    if (epoch !== current) return;
    await pc.setLocalDescription(offer);
    if (epoch !== current) return;
    sendSignal({ type: 'offer', sdp: offer.sdp! });
  }
}

async function signal(payload: SignalPayload, current: number) {
  const pc = peer; if (!pc || epoch !== current) return;
  if (isRelaySignal(payload)) { fail('GhostPair cannot use this connection. Try another network.'); return; }
  if (payload.type === 'ice') {
    if (!payload.candidate) return;
    if (!pc.remoteDescription) { if (pendingIce.length < 100) pendingIce.push(payload.candidate); return; }
    await pc.addIceCandidate(payload.candidate); return;
  }
  if ((payload.type === 'offer' && role !== 'guest') || (payload.type === 'answer' && role !== 'host')) throw new Error('The connection details do not match this session.');
  await pc.setRemoteDescription(payload);
  if (epoch !== current) return;
  const queuedIce = pendingIce; pendingIce = [];
  for (const candidate of queuedIce) { if (epoch !== current) return; if (candidate) await pc.addIceCandidate(candidate); }
  if (epoch !== current) return;
  if (payload.type === 'offer') {
    const answer = await pc.createAnswer();
    if (epoch !== current) return;
    await pc.setLocalDescription(answer);
    if (epoch !== current) return;
    sendSignal({ type: 'answer', sdp: answer.sdp! });
  }
}

async function start(message: Record<string, any>) {
  cleanup();
  const settings = SettingsSchema.parse(message.settings);
  if (!['host', 'guest'].includes(message.role)) throw new Error('Invalid settings.');
  const current = ++epoch;
  role = message.role; clipboardEnabled = message.clipboard === true; paused = false;
  pulse = setInterval(() => notify('transport.pulse'), 20000);
  const url = new URL('/v1/connect', settings.signalingUrl); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url); socket = ws;
  timer = setTimeout(() => { if (epoch === current) fail('Could not reach the connection server. Check your network and try again.'); }, 12000);
  ws.onopen = () => {
    if (epoch !== current) return;
    ws.send(JSON.stringify(role === 'host' ? { type: 'host.open', deviceId: message.deviceId, ownerToken: message.ownerToken, password: message.password } : { type: 'guest.join', deviceId: message.deviceId, password: message.password }));
    // Do not retain the human password after dispatch.
    message.password = ''; message.ownerToken = undefined;
  };
  ws.onmessage = event => {
    if (epoch !== current || typeof event.data !== 'string' || event.data.length > 65536) return;
    let parsed: ReturnType<typeof ServerSignalMessageSchema.safeParse>;
    try { parsed = ServerSignalMessageSchema.safeParse(JSON.parse(event.data)); } catch { return; }
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'host.ready') {
      sessionId = message.sessionId; clearTimeout(timer);
      notify('transport.status', { status: 'waiting', sessionId }); return;
    }
    if (message.type === 'paired') {
      if (message.role !== role || peer) { fail('The received session does not match.'); return; }
      sessionId = message.sessionId; clearTimeout(timer);
      notify('transport.status', { status: 'connecting', sessionId });
      negotiation = createPeer(settings, current).catch(() => { if (epoch === current) fail('Could not prepare the connection. Start a new session.'); }); return;
    }
    if (message.type === 'signal' && message.sessionId === sessionId) {
      negotiation = negotiation.then(() => signal(message.payload, current)).catch(() => { if (epoch === current) fail('Could not connect the devices. Try again or use another network.'); }); return;
    }
    if (message.type === 'ended' && message.sessionId === sessionId) { cleanup(message.reason, true); return; }
    if (message.type === 'error') {
      if (!connected) fail(message.message);
      else notify('transport.notice', { message: message.message });
    }
  };
  ws.onclose = () => {
    if (epoch !== current || ending) return;
    if (connected) notify('transport.notice', { message: 'The connection server is unavailable. Your session is still connected.' });
    else fail('The server closed the connection. Check settings or start a new session.');
  };
  ws.onerror = () => { if (epoch === current && !connected) fail('Could not reach the connection server. Check your network and connection settings.'); };
}

async function onMessage(message: Record<string, any>) {
  switch (message.type) {
    case 'identity.register': {
      const settings = SettingsSchema.parse(message.settings);
      const response = await fetch(new URL('/v1/devices', settings.signalingUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`The connection server could not set up GhostPair (${response.status}). Check the connection settings and try again.`);
      return { ok: true, identity: await response.json() };
    }
    case 'session.start': await start(message); return { ok: true };
    case 'session.stop': cleanup(message.reason); return { ok: true };
    case 'session.state': {
      if (role !== 'host' || !connected) break;
      const snapshot = SnapshotSchema.parse(message.snapshot);
      if (snapshot.controlRevision !== latestSnapshot?.controlRevision || snapshot.paused || !snapshot.controlEnabled || JSON.stringify(snapshot.presentation) !== JSON.stringify(latestSnapshot?.presentation)) ++inputRevision;
      paused = snapshot.paused; latestSnapshot = snapshot;
      sendPeer({ type: 'snapshot', snapshot }); syncClipboard();
      const key = JSON.stringify([snapshot.generation, snapshot.presentation, snapshot.paused]);
      if (key !== mediaKey) { mediaKey = key; void media?.present(snapshot.paused ? undefined : snapshot.presentation, snapshot.presentation ? mediaHooks.source?.(snapshot.presentation.captureId) : undefined, snapshot.generation); }
      break;
    }
    case 'session.clipboard': {
      clipboardEnabled = message.enabled === true; paused = message.paused === true;
      sendPeer({ type: 'clipboard.enabled', enabled: clipboardEnabled }); syncClipboard(); break;
    }
    case 'session.notice': sendPeer({ type: 'notice', message: String(message.message).slice(0, 512) }); break;
    case 'session.command': {
      if (role !== 'guest' || !connected || paused || !latestSnapshot?.controlEnabled) return { ok: false, error: 'Remote control is unavailable.' };
      const command = ControlCommandSchema.parse(message.command);
      if (message.requestId) {
        if (pendingCommands.size >= 32) { fail('Too many pending actions. Start a new session.'); return { ok: false, error: 'Too many pending actions.' }; }
        return new Promise<{ ok: boolean; error?: string }>(resolve => {
          const requestId = String(message.requestId);
          const timer = setTimeout(() => { pendingCommands.delete(requestId); resolve({ ok: false, error: 'The person sharing did not confirm the action. Check the tab list before trying again.' }); }, 10000);
          pendingCommands.set(requestId, { resolve, timer });
          if (!sendPeer({ type: 'command', command, requestId })) { clearTimeout(timer); pendingCommands.delete(requestId); resolve({ ok: false, error: 'The connection is congested.' }); if (role) fail('The connection is congested. Start a new session.'); }
        });
      }
      if (command.type === 'text' && command.text.length > 2048) {
        const chars = Array.from(command.text);
        for (let i = 0; i < chars.length; i += 2048) if (!sendPeer({ type: 'command', command: { ...command, text: chars.slice(i, i + 2048).join('') } })) {
          if (role) fail('The connection is congested. Start a new session.');
          return { ok: false, error: 'The connection failed. Part of the text was not sent.' };
        }
      } else if (!sendPeer({ type: 'command', command })) {
        if (role) fail('The connection is congested. Start a new session.');
        return { ok: false, error: 'The connection failed. The action was not sent.' };
      }
      break;
    }
  }
  return { ok: true };
}

return { handle: onMessage, stop: cleanup };
}
