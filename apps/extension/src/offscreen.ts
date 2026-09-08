import { MAX_CLIPBOARD_BYTES } from '@ghostpair/protocol';
import { createPeerSession } from './core/peer-session';
import { createDomClipboard } from './core/clipboard';

const clipboard = createDomClipboard(document);
let guestClipboard = false;
let captureEpoch = 0;
const sources = new Map<string, MediaStream>();
const dispatch = (message: Record<string, unknown>) => chrome.runtime.sendMessage({ target: 'background', ...message });
const session = createPeerSession((type, payload = {}) => { void dispatch({ type, ...payload }).catch(() => undefined); }, dispatch, clipboard, {
  source: captureId => {
    for (const [id, stream] of sources) for (const track of stream.getTracks()) track.enabled = id === captureId;
    return sources.get(captureId);
  },
});
function release(captureId: string) { const stream = sources.get(captureId); sources.delete(captureId); stream?.getTracks().forEach(track => track.stop()); }
async function handle(message: Record<string, any>) {
  if (message.type === 'capture.add') {
    if (sources.size >= 5 || sources.has(message.captureId)) throw new Error('The capture limit was reached.');
    const epoch = captureEpoch;
    const video = { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: String(message.streamId), maxWidth: 1280, maxHeight: 720, maxFrameRate: 24 } };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video } as MediaStreamConstraints);
    if (epoch !== captureEpoch) { stream.getTracks().forEach(track => track.stop()); throw new Error('Sharing was canceled.'); }
    stream.getVideoTracks().forEach(track => { track.contentHint = 'detail'; track.enabled = false; });
    sources.set(String(message.captureId), stream);
    return { ok: true };
  }
  if (message.type === 'capture.remove') { release(String(message.captureId)); return { ok: true }; }
  if (message.type === 'session.stop') { ++captureEpoch; session.stop(message.reason); for (const id of sources.keys()) release(id); guestClipboard = false; return { ok: true }; }
  if (message.type === 'clipboard.configure') { guestClipboard = message.enabled === true; return { ok: true }; }
  if (message.type === 'clipboard.stop') { guestClipboard = false; return { ok: true }; }
  if (message.type === 'clipboard.read' || message.type === 'clipboard.write') {
    if (!guestClipboard) throw new Error('Clipboard sharing is disabled.');
    if (message.type === 'clipboard.read') return { ok: true, text: await clipboard.read() };
    if (typeof message.text !== 'string' || new TextEncoder().encode(message.text).length > MAX_CLIPBOARD_BYTES) throw new Error('Clipboard text exceeds the limit.');
    await clipboard.write(message.text); return { ok: true };
  }
  return session.handle(message);
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || (sender.url && sender.url !== chrome.runtime.getURL('background.js')) || message?.target !== 'offscreen') return;
  void handle(message).then(respond).catch(error => respond({ ok: false, error: error instanceof Error ? error.message : 'Could not process the operation.' }));
  return true;
});
