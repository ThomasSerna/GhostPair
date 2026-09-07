import { createPeerSession } from './core/peer-session';
import { createDomClipboard } from './core/clipboard';

const dispatch = (message: Record<string, unknown>) => chrome.runtime.sendMessage({ target: 'background', ...message });
const session = createPeerSession((type, payload = {}) => { void dispatch({ type, ...payload }).catch(() => undefined); }, dispatch, createDomClipboard(document));

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || (sender.url && sender.url !== chrome.runtime.getURL('background.js')) || message?.target !== 'offscreen') return;
  void session.handle(message).then(respond).catch(error => respond({ ok: false, error: error instanceof Error ? error.message : 'Could not process the operation.' }));
  return true;
});
