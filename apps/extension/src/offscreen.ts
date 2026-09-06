import { z } from 'zod';
import { ControlCommandSchema, FrameMetaSchema, SettingsSchema, ServerSignalMessageSchema, isRelaySignal, validateSignalingUrl, PROTOCOL_VERSION, MAX_CLIPBOARD_BYTES, type ControlCommand, type Settings, type SignalPayload, type FrameMeta, type ViewerFrame } from '@ghostpair/protocol';
import { encodeFrame, FrameAssembler } from '@ghostpair/protocol/frames';
import { ClipboardSync, createDomClipboard, type ClipboardUpdate } from './core/clipboard';
import { jpegDimensions } from './core/capture';

type Role = 'host' | 'guest';
const SnapshotSchema = z.object({
  paused: z.boolean(), controlEnabled: z.boolean(), clipboardEnabled: z.boolean(),
  activeTabId: z.number().int().nonnegative().optional(), generation: z.number().int().nonnegative(),
  tabs: z.array(z.object({ id: z.number().int().nonnegative(), title: z.string().max(4096), url: z.string().max(8192), active: z.boolean(), supported: z.boolean() }).strict()).max(500),
}).strict();
type Snapshot = z.infer<typeof SnapshotSchema>;
const PeerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), protocol: z.literal(PROTOCOL_VERSION), sessionId: z.string().max(128), role: z.enum(['host', 'guest']) }).strict(),
  z.object({ type: z.literal('snapshot'), snapshot: SnapshotSchema }).strict(),
  z.object({ type: z.literal('command'), command: ControlCommandSchema }).strict(),
  z.object({ type: z.literal('clipboard.enabled'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('notice'), message: z.string().max(512) }).strict(),
  z.object({ type: z.literal('stop'), reason: z.string().max(512) }).strict(),
  z.object({ type: z.literal('ping'), time: z.number().finite() }).strict(),
  z.object({ type: z.literal('pong'), time: z.number().finite() }).strict(),
]);

const FragmentSchema = z.object({ transfer: z.string().max(64), index: z.number().int().nonnegative(), count: z.number().int().min(1).max(256), data: z.string().max(4000) }).strict();
class JsonChannel {
  private queue: string[] = [];
  private bytes = 0;
  private partial = new Map<string, { count: number; parts: Map<number, string>; size: number; until: number }>();
  private sequence = 0;
  constructor(private channel: RTCDataChannel, private receive: (value: unknown) => void) {
    channel.bufferedAmountLowThreshold = 32 * 1024;
    channel.onbufferedamountlow = () => this.flush();
    channel.onmessage = event => this.message(event.data);
  }
  send(value: unknown): boolean {
    const text = JSON.stringify(value);
    if (text.length > 900_000 || this.bytes + text.length > 1_000_000 || this.channel.readyState !== 'open') return false;
    const transfer = String(++this.sequence);
    const count = Math.ceil(text.length / 4000);
    const packets = text.length <= 4000 ? [text] : Array.from({ length: count }, (_, index) => JSON.stringify({ transfer, index, count, data: text.slice(index * 4000, (index + 1) * 4000) }));
    for (const packet of packets) { this.queue.push(packet); this.bytes += packet.length; }
    this.flush(); return true;
  }
  private flush() {
    while (this.queue.length && this.channel.readyState === 'open' && this.channel.bufferedAmount < 64 * 1024) {
      const packet = this.queue.shift()!; this.bytes -= packet.length;
      try { this.channel.send(packet); } catch { this.queue = []; this.bytes = 0; break; }
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

let role: Role | undefined;
let sessionId: string | undefined;
let socket: WebSocket | undefined;
let peer: RTCPeerConnection | undefined;
let controlChannel: RTCDataChannel | undefined;
let imageChannel: RTCDataChannel | undefined;
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
let health: ReturnType<typeof setInterval> | undefined;
let negotiation: Promise<void> = Promise.resolve();
let pendingIce: (RTCIceCandidateInit | null)[] = [];
let latestSnapshot: Snapshot | undefined;
let lastFrame: ViewerFrame | undefined;
let lastProfile = 0;
let commandsPerSecond = 0;
let commandWindow = 0;
const assembler = new FrameAssembler();
const clipboardAdapter = createDomClipboard(document);

function notify(type: string, payload: object = {}) { void chrome.runtime.sendMessage({ target: 'background', type, ...payload }).catch(() => undefined); }
function sendPeer(value: unknown) { return controlPipe?.send(value) ?? false; }
function sendSignal(payload: SignalPayload) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !sessionId || isRelaySignal(payload)) return;
  socket.send(JSON.stringify({ type: 'signal', sessionId, payload }));
}

function syncClipboard() {
  if (connected && greeted && clipboardEnabled && remoteClipboardEnabled && !paused && clipboardChannel?.readyState === 'open') void clipboardSync?.start();
  else clipboardSync?.stop();
}

function cleanup(reason = 'Sesión terminada.', inform = false, failed = false) {
  if (ending) return;
  ending = true; ++epoch;
  clipboardSync?.stop(); clipboardSync = undefined;
  if (connected) sendPeer({ type: 'stop', reason: reason.slice(0, 512) });
  if (role === 'host' && sessionId && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'host.close', sessionId }));
  clearTimeout(timer); clearInterval(health); timer = undefined; health = undefined;
  controlPipe?.clear(); clipboardPipe?.clear(); controlPipe = undefined; clipboardPipe = undefined;
  const previous = peer; peer = undefined;
  previous?.close(); socket?.close(); socket = undefined;
  controlChannel = undefined; imageChannel = undefined; clipboardChannel = undefined;
  connected = false; direct = false; greeted = false; role = undefined; sessionId = undefined;
  clipboardEnabled = false; remoteClipboardEnabled = false; paused = false;
  lastFrame = undefined; latestSnapshot = undefined; pendingIce = []; assembler.clear();
  ending = false;
  if (inform) notify('transport.ended', { reason, failed });
}
function fail(reason: string) { cleanup(reason, true, true); }

async function verifyDirect(pc: RTCPeerConnection, current: number) {
  for (let i = 0; i < 20 && peer === pc && epoch === current; i++) {
    const stats = await pc.getStats();
    let selected: any;
    stats.forEach(report => { if (report.type === 'transport' && report.selectedCandidatePairId) selected = stats.get(report.selectedCandidatePairId); });
    if (!selected) stats.forEach(report => { if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) selected = report; });
    if (selected) {
      const local = stats.get(selected.localCandidateId); const remote = stats.get(selected.remoteCandidateId);
      if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') { fail('La ruta usa una retransmisión que GhostPair no permite.'); return; }
      if (local?.candidateType && remote?.candidateType) { direct = true; await establish(); return; }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (peer === pc && epoch === current) fail('No se pudo verificar una ruta directa entre los equipos.');
}

async function establish() {
  if (connected || !direct || !greeted || !sessionId || !role || controlChannel?.readyState !== 'open') return;
  connected = true; clearTimeout(timer);
  clipboardSync = new ClipboardSync(role, clipboardAdapter, update => {
    if (!clipboardPipe?.send(update)) notify('transport.notice', { message: 'El portapapeles está congestionado. El último cambio no se transmitió.' });
  }, message => {
    if (!clipboardSync?.isActive) { clipboardEnabled = false; sendPeer({ type: 'clipboard.enabled', enabled: false }); notify('transport.clipboard', { remoteEnabled: remoteClipboardEnabled, disabled: true }); }
    notify('transport.notice', { message });
  });
  sendPeer({ type: 'clipboard.enabled', enabled: clipboardEnabled });
  notify('transport.connected', { sessionId });
  syncClipboard();
  if (latestSnapshot && role === 'guest') notify('transport.snapshot', { snapshot: latestSnapshot });
  health = setInterval(() => { if (connected) sendPeer({ type: 'ping', time: Date.now() }); }, 3000);
}

async function receiveControl(value: unknown) {
  const result = PeerMessageSchema.safeParse(value);
  if (!result.success) return;
  const message = result.data;
  if (message.type === 'hello') {
    if (message.sessionId !== sessionId || message.role === role) { fail('La identidad de sesión no coincide.'); return; }
    greeted = true; await establish(); return;
  }
  if (!greeted) return;
  if (!connected) {
    // Data channels can open before getStats verifies the candidate pair.
    // Keep authenticated initial state so a static page does not need a second frame.
    if (message.type === 'snapshot' && role === 'guest') { latestSnapshot = message.snapshot; paused = latestSnapshot.paused; remoteClipboardEnabled = latestSnapshot.clipboardEnabled; }
    if (message.type === 'clipboard.enabled') remoteClipboardEnabled = message.enabled;
    if (message.type === 'stop') cleanup(message.reason, true);
    return;
  }
  switch (message.type) {
    case 'snapshot':
      if (role !== 'guest') return;
      latestSnapshot = message.snapshot; paused = latestSnapshot.paused; remoteClipboardEnabled = latestSnapshot.clipboardEnabled;
      notify('transport.snapshot', { snapshot: latestSnapshot });
      syncClipboard();
      if (lastFrame?.meta.generation === latestSnapshot.generation && lastFrame.meta.tabId === latestSnapshot.activeTabId) notify('transport.frame', { frame: lastFrame });
      break;
    case 'command': {
      if (role !== 'host' || paused) return;
      if (Date.now() - commandWindow >= 1000) { commandWindow = Date.now(); commandsPerSecond = 0; }
      if (++commandsPerSecond > 250) return;
      await chrome.runtime.sendMessage({ target: 'background', type: 'transport.command', command: message.command });
      break;
    }
    case 'clipboard.enabled': remoteClipboardEnabled = message.enabled; notify('transport.clipboard', { remoteEnabled: remoteClipboardEnabled }); syncClipboard(); break;
    case 'notice': notify('transport.notice', { message: message.message }); break;
    case 'stop': cleanup(message.reason, true); break;
    case 'ping': sendPeer({ type: 'pong', time: message.time }); break;
    case 'pong': notify('transport.stats', { latencyMs: Math.max(0, Math.min(60000, Date.now() - message.time)) }); break;
  }
}

function attachChannel(channel: RTCDataChannel, current: number) {
  if (channel.label === 'control') {
    if (controlChannel) { channel.close(); return; }
    controlChannel = channel;
    let controls: Promise<void> = Promise.resolve();
    let pendingControls = 0;
    controlPipe = new JsonChannel(channel, value => {
      if (++pendingControls > 256) { fail('El participante envió demasiadas órdenes pendientes.'); return; }
      controls = controls.then(() => epoch === current ? receiveControl(value) : undefined).catch(() => undefined).finally(() => { --pendingControls; });
    });
    channel.onopen = () => { if (epoch !== current) return; sendPeer({ type: 'hello', protocol: PROTOCOL_VERSION, sessionId, role }); };
    channel.onclose = () => { if (epoch === current && !ending && role) cleanup('La otra persona se desconectó.', true); };
  } else if (channel.label === 'frames') {
    if (imageChannel) { channel.close(); return; }
    imageChannel = channel; channel.binaryType = 'arraybuffer';
    channel.onmessage = event => {
      if (epoch !== current || role !== 'guest' || !connected || paused || !(event.data instanceof ArrayBuffer)) return;
      const result = assembler.push(event.data); if (!result) return;
      // Parse dimensions before allocating an image decoder; metadata alone is untrusted.
      let binary = ''; for (let i = 0; i < result.jpeg.length; i += 8192) binary += String.fromCharCode(...result.jpeg.subarray(i, i + 8192));
      const base64 = btoa(binary);
      const size = jpegDimensions(base64);
      if (!size || size.width !== result.meta.width || size.height !== result.meta.height) return;
      lastFrame = { dataUrl: `data:image/jpeg;base64,${base64}`, meta: result.meta };
      if (latestSnapshot?.generation === result.meta.generation && latestSnapshot.activeTabId === result.meta.tabId) notify('transport.frame', { frame: lastFrame });
    };
  } else if (channel.label === 'clipboard') {
    if (clipboardChannel) { channel.close(); return; }
    clipboardChannel = channel;
    clipboardPipe = new JsonChannel(channel, value => {
      if (epoch !== current || !connected || !clipboardEnabled || !remoteClipboardEnabled || paused || !value || typeof value !== 'object') return;
      const update = value as ClipboardUpdate;
      if (update.origin !== (role === 'host' ? 'guest' : 'host') || typeof update.text !== 'string' || update.text.length > MAX_CLIPBOARD_BYTES) return;
      void clipboardSync?.receive(update);
    });
    channel.onopen = syncClipboard;
    channel.onclose = () => { clipboardSync?.stop(); };
  } else channel.close();
}

async function createPeer(settings: Settings, current: number) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: settings.stunUrls }], bundlePolicy: 'max-bundle', iceCandidatePoolSize: 0 });
  peer = pc; direct = false; greeted = false;
  pc.onicecandidate = event => { if (epoch === current) sendSignal({ type: 'ice', candidate: event.candidate?.toJSON() ?? null }); };
  pc.onconnectionstatechange = () => {
    if (peer !== pc || epoch !== current || ending) return;
    if (pc.connectionState === 'connected') void verifyDirect(pc, current).catch(() => fail('No se pudo verificar la conexión.'));
    else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) cleanup('Se interrumpió la conexión directa. Inicia otra sesión.', true, true);
  };
  pc.ondatachannel = event => attachChannel(event.channel, current);
  timer = setTimeout(() => { if (epoch === current && !connected) fail('No se encontró una conexión P2P directa en 30 segundos. La red puede bloquearla.'); }, 30000);
  if (role === 'host') {
    attachChannel(pc.createDataChannel('control', { ordered: true }), current);
    attachChannel(pc.createDataChannel('frames', { ordered: false, maxRetransmits: 0 }), current);
    attachChannel(pc.createDataChannel('clipboard', { ordered: true }), current);
    const offer = await pc.createOffer();
    if (epoch !== current) return;
    await pc.setLocalDescription(offer);
    sendSignal({ type: 'offer', sdp: offer.sdp! });
  }
}

async function signal(payload: SignalPayload, current: number) {
  const pc = peer; if (!pc || epoch !== current || isRelaySignal(payload)) { if (isRelaySignal(payload)) fail('La señal contiene una ruta de retransmisión no permitida.'); return; }
  if (payload.type === 'ice') {
    if (!payload.candidate) return;
    if (!pc.remoteDescription) { if (pendingIce.length < 100) pendingIce.push(payload.candidate); return; }
    await pc.addIceCandidate(payload.candidate); return;
  }
  if ((payload.type === 'offer' && role !== 'guest') || (payload.type === 'answer' && role !== 'host')) throw new Error('Rol de señalización incorrecto.');
  await pc.setRemoteDescription(payload);
  for (const candidate of pendingIce) if (candidate) await pc.addIceCandidate(candidate);
  pendingIce = [];
  if (payload.type === 'offer') {
    const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
    sendSignal({ type: 'answer', sdp: answer.sdp! });
  }
}

async function start(message: Record<string, any>) {
  cleanup();
  const settings = SettingsSchema.parse(message.settings);
  if (!validateSignalingUrl(settings.signalingUrl) || !['host', 'guest'].includes(message.role)) throw new Error('Configuración no válida.');
  const current = ++epoch;
  role = message.role; clipboardEnabled = message.clipboard === true; paused = false;
  const url = new URL('/v1/connect', settings.signalingUrl); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url); socket = ws;
  timer = setTimeout(() => { if (epoch === current) fail('No se pudo contactar el servidor de conexión.'); }, 12000);
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
      if (message.role !== role || peer) { fail('La sesión recibida no coincide.'); return; }
      sessionId = message.sessionId; clearTimeout(timer);
      notify('transport.status', { status: 'connecting', sessionId });
      negotiation = createPeer(settings, current).catch(() => { if (epoch === current) fail('No se pudo preparar WebRTC.'); }); return;
    }
    if (message.type === 'signal' && message.sessionId === sessionId) {
      negotiation = negotiation.then(() => signal(message.payload, current)).catch(() => { if (epoch === current) fail('No se pudo negociar la conexión directa.'); }); return;
    }
    if (message.type === 'ended' && message.sessionId === sessionId) { cleanup(message.reason, true); return; }
    if (message.type === 'error') {
      if (!connected) fail(message.message);
      else notify('transport.notice', { message: message.message });
    }
  };
  ws.onclose = () => {
    if (epoch !== current || ending) return;
    if (connected) notify('transport.notice', { message: 'El servidor se desconectó. La sesión P2P continúa.' });
    else fail('El servidor cerró la conexión. Revisa la configuración o inicia otra sesión.');
  };
  ws.onerror = () => { if (epoch === current && !connected) fail('No se pudo conectar. Comprueba el servidor y que autorice el ID de esta extensión.'); };
}

async function onMessage(message: Record<string, any>) {
  switch (message.type) {
    case 'identity.register': {
      const settings = SettingsSchema.parse(message.settings);
      if (!validateSignalingUrl(settings.signalingUrl)) throw new Error('Servidor no válido.');
      const response = await fetch(new URL('/v1/devices', settings.signalingUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Registro rechazado (${response.status}). Autoriza el ID de la extensión en el servidor.`);
      return { ok: true, identity: await response.json() };
    }
    case 'session.start': await start(message); return { ok: true };
    case 'session.stop': cleanup(message.reason); return { ok: true };
    case 'session.state': {
      if (role !== 'host' || !connected) break;
      const snapshot = SnapshotSchema.parse(message.snapshot);
      paused = snapshot.paused; latestSnapshot = snapshot;
      sendPeer({ type: 'snapshot', snapshot }); syncClipboard(); break;
    }
    case 'session.clipboard': {
      clipboardEnabled = message.enabled === true; paused = message.paused === true;
      sendPeer({ type: 'clipboard.enabled', enabled: clipboardEnabled }); syncClipboard(); break;
    }
    case 'session.notice': sendPeer({ type: 'notice', message: String(message.message).slice(0, 512) }); break;
    case 'session.command': {
      if (role !== 'guest' || !connected || paused || !latestSnapshot?.controlEnabled) break;
      const command = ControlCommandSchema.parse(message.command);
      if (command.type === 'text' && command.text.length > 2048) {
        const chars = Array.from(command.text);
        for (let i = 0; i < chars.length; i += 2048) if (!sendPeer({ type: 'command', command: { ...command, text: chars.slice(i, i + 2048).join('') } })) { notify('transport.notice', { message: 'La conexión está congestionada. Parte del texto no se envió.' }); break; }
      } else if (!sendPeer({ type: 'command', command })) notify('transport.notice', { message: 'La conexión está congestionada. La acción no se envió.' });
      break;
    }
    case 'session.resendFrame': if (lastFrame && connected && !paused) notify('transport.frame', { frame: lastFrame }); break;
    case 'capture.frame': {
      if (role !== 'host' || !connected || paused || imageChannel?.readyState !== 'open') break;
      const meta = FrameMetaSchema.parse(message.frame.meta) as FrameMeta;
      const data = String(message.frame.data);
      if (data.length > 3_000_000) break;
      const congested = imageChannel.bufferedAmount > 256 * 1024;
      if (Date.now() - lastProfile > 3000) { lastProfile = Date.now(); notify('transport.profile', { congested }); }
      if (congested) break;
      const raw = atob(data); const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
      const packets = encodeFrame(meta, bytes);
      for (const packet of packets) { if (imageChannel.bufferedAmount > 512 * 1024) break; imageChannel.send(packet); }
      break;
    }
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only the extension service worker may direct this document.
  if (sender.id !== chrome.runtime.id || sender.tab || (sender.url && sender.url !== chrome.runtime.getURL('background.js')) || message?.target !== 'offscreen') return;
  void onMessage(message).then(respond).catch(error => respond({ ok: false, error: error instanceof Error ? error.message : 'No se pudo procesar la operación.' }));
  return true;
});
