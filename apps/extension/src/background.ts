import { ControlModeSchema, VisualPreferencesSchema, PasswordSchema, SettingsSchema, validateSignalingUrl, type AppState, type Settings } from '@ghostpair/protocol';
import { TabCapture } from './core/tab-capture';
import { dismissNotification, patchState } from './core/notifications';

const defaults: Settings = SettingsSchema.parse({ signalingUrl: import.meta.env.VITE_SIGNALING_URL || 'http://127.0.0.1:8787', stunUrls: (import.meta.env.VITE_STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map((s: string) => s.trim()).filter(Boolean) });
if (!validateSignalingUrl(defaults.signalingUrl)) throw new Error('Invalid build signaling URL.');
let visualPreferences = VisualPreferencesSchema.parse({});
let state: AppState = idle(defaults);
let authorizedWindowId: number | undefined;
let creatingOffscreen: Promise<void> | undefined;
let terminating: Promise<void> | undefined;
let mutation: Promise<unknown> = Promise.resolve();
let sessionEpoch = 0;
let viewerTabId: number | undefined;
let ownerPort: chrome.runtime.Port | undefined;
const viewers = new Set<chrome.runtime.Port>();
const pending = new Map<string, { resolve: (reply: any) => void; timer: ReturnType<typeof setTimeout> }>();
function idle(settings: Settings, deviceId?: string): AppState { return { role: null, status: 'idle', deviceId, paused: false, controlEnabled: true, controlMode: 'visual', controlRevision: 0, visualPreferences, clipboardEnabled: false, remoteClipboardEnabled: false, tabs: [], generation: 0, settings }; }
const pageUrl = (url?: string) => url?.split(/[?#]/)[0];
const isViewer = (sender: chrome.runtime.MessageSender) => pageUrl(sender.url) === chrome.runtime.getURL('viewer.html');
async function openViewer() {
  const url = chrome.runtime.getURL('viewer.html'), tabs = await chrome.tabs.query({ url });
  const existing = tabs.find(tab => tab.id === viewerTabId) ?? tabs[0];
  if (existing?.id !== undefined) { viewerTabId = existing.id; await chrome.tabs.update(existing.id, { active: true }); await chrome.windows.update(existing.windowId, { focused: true }); }
  else viewerTabId = (await chrome.tabs.create({ url })).id;
}
async function hasOffscreen() { return (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [chrome.runtime.getURL('offscreen.html')] })).length > 0; }
async function offscreen() {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.WEB_RTC, chrome.offscreen.Reason.CLIPBOARD], justification: 'Authorized tab capture, peer connection and optional clipboard synchronization.' }).finally(() => { creatingOffscreen = undefined; });
  await creatingOffscreen;
}
const toOffscreen = (type: string, payload: object = {}) => chrome.runtime.sendMessage({ target: 'offscreen', type, ...payload });
function toViewer(type: string, payload: object = {}): Promise<any> {
  if (!ownerPort) return Promise.resolve({ ok: false, error: 'Open the connection page before joining.' });
  if (pending.size >= 64) return Promise.resolve({ ok: false, error: 'Too many pending viewer operations.' });
  return new Promise(resolve => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); resolve({ ok: false, error: 'The viewer did not respond.' }); }, 12000);
    pending.set(requestId, { resolve, timer });
    try { ownerPort!.postMessage({ type: 'transport.request', requestId, message: { type, ...payload } }); }
    catch { clearTimeout(timer); pending.delete(requestId); resolve({ ok: false, error: 'The viewer closed.' }); }
  });
}
function transport(type: string, payload: object = {}) { return state.role === 'guest' && type.startsWith('session.') ? toViewer(type, payload) : toOffscreen(type, payload); }
function broadcast() {
  for (const port of viewers) { try { port.postMessage({ type: 'state', state }); } catch { viewers.delete(port); } }
  void chrome.runtime.sendMessage({ type: 'state', state }).catch(() => undefined);
  void chrome.storage.session.set({ appState: state });
  void chrome.action.setBadgeText({ text: '' });
  void chrome.action.setTitle({ title: 'GhostPair' });
}
function update(patch: Partial<AppState>) { state = patchState(state, patch); broadcast(); }
function hostState() {
  if (state.role !== 'host' || !['connected', 'paused'].includes(state.status)) return;
  const { paused, controlEnabled, controlMode, controlRevision, clipboardEnabled, tabs, activeTabId, generation, presentation } = state;
  void transport('session.state', { snapshot: { paused, controlEnabled, controlMode, controlRevision, clipboardEnabled, tabs, activeTabId, generation, presentation } }).catch(() => undefined);
}
const capture = new TabCapture({
  state: (tabs, activeTabId, generation, presentation) => { if (state.role === 'host') { update({ tabs, activeTabId, generation, presentation }); hostState(); } },
  error: message => update({ notice: message }), detached: () => { void stop('The browser stopped sharing. Start a new session.'); },
  acquire: async (tabId, captureId, streamId) => { const reply = await toOffscreen('capture.add', { tabId, captureId, streamId }); if (!reply?.ok) throw new Error(reply?.error ?? 'Tab capture failed.'); },
  release: async captureId => { if (await hasOffscreen()) await toOffscreen('capture.remove', { captureId }); },
});
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const saved = await chrome.storage.local.get(['settings', 'identities', 'visualPreferences']);
  const preferences = VisualPreferencesSchema.safeParse(saved.visualPreferences);
  visualPreferences = preferences.success ? preferences.data : VisualPreferencesSchema.parse({});
  const parsed = SettingsSchema.safeParse(saved.settings);
  const settings = parsed.success && validateSignalingUrl(parsed.data.signalingUrl) ? parsed.data : defaults;
  const identity = (saved.identities as Record<string, { deviceId: string }> | undefined)?.[settings.signalingUrl];
  const previous = (await chrome.storage.session.get('appState')).appState as AppState | undefined;
  state = idle(settings, identity?.deviceId);
  if (previous?.role && !['idle', 'error'].includes(previous.status)) {
    if (await hasOffscreen()) await toOffscreen('session.stop').catch(() => undefined);
    state = patchState(state, { notice: 'The extension restarted. Start a new session.' });
  }
  broadcast();
})();
async function identity() {
  const saved = await chrome.storage.local.get('identities');
  const identities = (saved.identities ?? {}) as Record<string, { deviceId: string; ownerToken: string }>;
  const key = state.settings.signalingUrl;
  if (identities[key]) return identities[key]!;
  const result = await toOffscreen('identity.register', { settings: state.settings });
  if (!result?.ok || !/^[0-9a-f]{32}$/.test(result.identity?.deviceId ?? '') || !/^[0-9a-f]{64}$/.test(result.identity?.ownerToken ?? '')) throw new Error(result?.error ?? 'Could not register this installation.');
  identities[key] = result.identity; await chrome.storage.local.set({ identities });
  return result.identity as { deviceId: string; ownerToken: string };
}
async function stop(reason?: string): Promise<void> {
  if (terminating) return terminating;
  ++sessionEpoch;
  const previousDevice = state.deviceId;
  update({ status: 'idle', paused: true, controlEnabled: false, clipboardEnabled: false, remoteClipboardEnabled: false, presentation: undefined });
  authorizedWindowId = undefined;
  terminating = (async () => {
    const peerStop = state.role === 'guest' ? toViewer('session.stop', { reason }) : hasOffscreen().then(exists => exists ? toOffscreen('session.stop', { reason }) : undefined);
    await Promise.allSettled([capture.stop(), peerStop]);
    if (await hasOffscreen()) await toOffscreen('clipboard.stop').catch(() => undefined);
    state = patchState(idle(state.settings, previousDevice), reason ? { notice: reason } : {}); broadcast();
  })().finally(() => { terminating = undefined; });
  return terminating;
}
async function permissions(host: boolean, clipboard: boolean) { return chrome.permissions.contains({ origins: host ? ['http://*/*', 'https://*/*'] : [`${new URL(state.settings.signalingUrl).origin}/*`], ...(clipboard ? { permissions: ['clipboardRead', 'clipboardWrite'] } : {}) }); }
async function action(message: Record<string, any>, sender: chrome.runtime.MessageSender): Promise<AppState> {
  switch (message.type) {
    case 'ui.status': return state;
    case 'ui.notification.dismiss': state = dismissNotification(state, String(message.id)); broadcast(); return state;
    case 'ui.viewer.open': await openViewer(); return state;
    case 'ui.settings.reset': case 'ui.settings.save': {
      if (!['idle', 'error'].includes(state.status)) throw new Error('End the session before changing settings.');
      const settings = message.type === 'ui.settings.reset' ? defaults : SettingsSchema.parse(message.settings);
      if (!validateSignalingUrl(settings.signalingUrl)) throw new Error('Use HTTPS for signaling, or HTTP on localhost.');
      if (message.type === 'ui.settings.reset') await chrome.storage.local.remove('settings'); else await chrome.storage.local.set({ settings });
      const identities = (await chrome.storage.local.get('identities')).identities as Record<string, { deviceId: string }> | undefined;
      state = idle(settings, identities?.[settings.signalingUrl]?.deviceId); broadcast(); return state;
    }
    case 'ui.host.start': case 'ui.guest.start': {
      if (terminating) await terminating;
      if (!['idle', 'error'].includes(state.status)) throw new Error('A session is already active.');
      const epoch = ++sessionEpoch, current = () => epoch === sessionEpoch;
      const host = message.type === 'ui.host.start';
      if (!host && (!isViewer(sender) || sender.tab?.id !== viewerTabId || !ownerPort)) throw new Error('Join from the connection page.');
      const password = PasswordSchema.parse(message.password), clipboard = message.clipboard === true;
      if (!await permissions(host, clipboard)) throw new Error('Grant the selected permissions before starting.');
      if (!current()) return state;
      update({ role: host ? 'host' : 'guest', status: 'starting', notification: undefined, error: undefined, notice: undefined, clipboardEnabled: clipboard, paused: false, controlEnabled: true, tabs: [], presentation: undefined });
      try {
        await offscreen(); if (!current()) return state;
        if (host) {
          const window = sender.tab ? await chrome.windows.get(sender.tab.windowId) : await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
          if (window.incognito || window.type !== 'normal' || window.id === undefined) throw new Error('Select a normal browser window.');
          authorizedWindowId = window.id;
          const active = (await chrome.tabs.query({ windowId: window.id, active: true }))[0];
          if (active?.id === undefined) throw new Error('Select the page to share.');
          if (!current()) return state;
          await capture.start(window.id); if (!current()) return state;
          await capture.configure({ mode: state.controlMode, revision: state.controlRevision, preferences: visualPreferences }); if (!current()) return state;
          await capture.authorize(active.id); if (!current()) return state;
        }
        const owner = host ? await identity() : undefined; if (!current()) return state;
        const deviceId = host ? owner!.deviceId : String(message.deviceId ?? '').replace(/[\s-]/g, '').toLowerCase();
        if (!/^[0-9a-f]{32}$/.test(deviceId)) throw new Error('Enter a 32-character GhostPair address.');
        if (host) update({ deviceId });
        else { const reply = await toOffscreen('clipboard.configure', { enabled: clipboard }); if (!reply?.ok) throw new Error(reply?.error); }
        const reply = await transport('session.start', { role: host ? 'host' : 'guest', settings: state.settings, deviceId, ownerToken: owner?.ownerToken, password, clipboard });
        if (!current()) return state;
        if (!reply?.ok) throw new Error(reply?.error ?? 'Could not start the session.');
      } catch (error) { if (!current()) return state; await stop(); update({ status: 'error', error: error instanceof Error ? error.message : 'Could not start the session.' }); }
      return state;
    }
    case 'ui.host.authorize': {
      if (state.role !== 'host' || authorizedWindowId === undefined) throw new Error('Start a host session first.');
      if (!await permissions(true, false)) throw new Error('Grant site access before sharing.');
      const tab = (await chrome.tabs.query({ active: true, windowId: authorizedWindowId }))[0];
      if (tab?.id === undefined) throw new Error('Select a tab in the shared window.');
      await capture.authorize(tab.id); return state;
    }
    case 'ui.host.release': if (state.role !== 'host') throw new Error('Only the host can release captures.'); await capture.release(Number(message.tabId)); return state;
    case 'ui.command': {
      if (state.role !== 'guest' || state.status !== 'connected' || state.paused || !state.controlEnabled) throw new Error('Remote control is unavailable.');
      const reply = await transport('session.command', { command: message.command, requestId: crypto.randomUUID() });
      if (!reply?.ok) throw new Error(reply?.error ?? 'Could not complete the action.'); return state;
    }
    case 'ui.pause': {
      if (state.role !== 'host' || !['connected', 'paused'].includes(state.status)) throw new Error('The session is not connected.');
      const paused = message.paused === true; update({ paused, status: paused ? 'paused' : 'connected' });
      await capture.setPaused(paused); hostState(); await transport('session.clipboard', { enabled: state.clipboardEnabled, paused }); return state;
    }
    case 'ui.control': {
      if (state.role !== 'host') throw new Error('Only the host can change control.');
      update({ controlEnabled: message.enabled === true }); await capture.setControl(state.controlEnabled); hostState(); return state;
    }
    case 'ui.control.mode': case 'ui.visual.clear': {
      if (state.role !== 'host') throw new Error('Only the host can change the simulation.');
      const mode = message.type === 'ui.control.mode' ? ControlModeSchema.parse(message.mode) : state.controlMode;
      const revision = state.controlRevision + 1;
      try { await capture.configure({ mode, revision, preferences: visualPreferences }); }
      catch (error) { update({ controlEnabled: false, controlMode: mode, controlRevision: revision }); await capture.setControl(false); hostState(); throw error; }
      update({ controlMode: mode, controlRevision: revision }); hostState(); return state;
    }
    case 'ui.visual.preferences': {
      if (state.role && state.role !== 'host') throw new Error('Only the host can change simulation preferences.');
      const preferences = VisualPreferencesSchema.parse(message.preferences);
      if (state.role === 'host') await capture.configure({ mode: state.controlMode, revision: state.controlRevision, preferences });
      await chrome.storage.local.set({ visualPreferences: preferences });
      visualPreferences = preferences; update({ visualPreferences }); return state;
    }
    case 'ui.clipboard': {
      const enabled = message.enabled === true;
      if (enabled && !await chrome.permissions.contains({ permissions: ['clipboardRead', 'clipboardWrite'] })) throw new Error('Grant clipboard access on this device.');
      update({ clipboardEnabled: enabled });
      if (state.role === 'guest') await toOffscreen('clipboard.configure', { enabled });
      if (state.role) await transport('session.clipboard', { enabled, paused: state.paused }); hostState(); return state;
    }
    default: throw new Error('Unknown operation.');
  }
}
async function fromTransport(message: Record<string, any>) {
  if (message.type === 'transport.pulse' || !state.role || terminating) return;
  switch (message.type) {
    case 'transport.status': if (['waiting', 'connecting'].includes(message.status)) update({ status: message.status, sessionId: message.sessionId ?? state.sessionId }); break;
    case 'transport.connected': update({ status: 'connected', sessionId: message.sessionId, connection: { direct: true } }); hostState(); break;
    case 'transport.ended': await stop(String(message.reason || 'Session ended.')); if (message.failed) update({ status: 'error', error: String(message.reason || 'Connection failed.') }); break;
    case 'transport.notice': update({ notice: String(message.message || '') }); break;
    case 'transport.clipboard': update({ remoteClipboardEnabled: message.remoteEnabled === true, ...(message.disabled ? { clipboardEnabled: false } : {}) }); break;
    case 'transport.stats': if (state.connection) update({ connection: { ...state.connection, latencyMs: message.latencyMs } }); break;
    case 'transport.snapshot': if (state.role === 'guest') { const remote = message.snapshot; update({ tabs: remote.tabs, activeTabId: remote.activeTabId, generation: remote.generation, presentation: remote.presentation, paused: remote.paused, controlEnabled: remote.controlEnabled, controlMode: remote.controlMode, controlRevision: remote.controlRevision, remoteClipboardEnabled: remote.clipboardEnabled, status: remote.paused ? 'paused' : 'connected' }); } break;
    case 'transport.command': {
      if (state.role !== 'host' || state.status !== 'connected' || state.paused) return { ok: false, error: 'Remote control is unavailable.' };
      try { await capture.execute(message.command); return { ok: true }; } catch (error) { return { ok: false, error: (error as Error).message }; }
    }
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'background') return;
  const fromOffscreen = pageUrl(sender.url) === chrome.runtime.getURL('offscreen.html'), fromViewer = isViewer(sender), fromPopup = pageUrl(sender.url) === chrome.runtime.getURL('popup.html');
  if (!fromOffscreen && !fromViewer && !fromPopup && message.type !== 'dom.geometry') return;
  void (async () => {
    await ready;
    if (message.type === 'dom.geometry') { capture.geometry(message, sender); return { ok: true }; }
    if (fromOffscreen || fromViewer && sender.tab?.id === viewerTabId && message.type.startsWith('transport.')) return await fromTransport(message) ?? { ok: true, state };
    if (message.type === 'ui.status') return { ok: true, state };
    if (message.type === 'ui.stop') { await stop(); return { ok: true, state }; }
    if (message.type === 'ui.clipboard.read' || message.type === 'ui.clipboard.write') {
      if (!fromViewer || sender.tab?.id !== viewerTabId || state.role !== 'guest' || !state.clipboardEnabled || !state.remoteClipboardEnabled || state.paused || state.status !== 'connected') throw new Error('Clipboard sharing is disabled.');
      return await toOffscreen(message.type === 'ui.clipboard.read' ? 'clipboard.read' : 'clipboard.write', { text: message.text });
    }
    const work = mutation.then(() => action(message, sender)); mutation = work.catch(() => undefined); return { ok: true, state: await work };
  })().then(respond).catch(error => respond({ ok: false, error: error instanceof Error ? error.message : 'Could not complete the operation.' }));
  return true;
});
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'viewer' || port.sender?.id !== chrome.runtime.id || !isViewer(port.sender) || port.sender.tab?.id === undefined) return;
  const tabId = port.sender.tab.id;
  if (ownerPort && viewerTabId !== tabId) { port.postMessage({ type: 'viewer.duplicate' }); void openViewer(); return; }
  ownerPort = port; viewerTabId = tabId; viewers.add(port);
  void ready.then(() => port.postMessage({ type: 'state', state })).catch(() => undefined);
  port.onDisconnect.addListener(() => {
    viewers.delete(port); if (ownerPort !== port) return; ownerPort = undefined;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.resolve({ ok: false, error: 'The viewer closed.' }); } pending.clear();
    if (state.role === 'guest') void stop('The connection page closed. Start a new session.');
  });
  port.onMessage.addListener(message => {
    if (port !== ownerPort) return;
    if (message?.type === 'transport.reply') { const entry = pending.get(message.requestId); if (entry) { clearTimeout(entry.timer); pending.delete(message.requestId); entry.resolve(message.reply); } }
  });
});
chrome.commands.onCommand.addListener(command => { if (command === 'stop-session') void ready.then(() => stop()); });
chrome.permissions.onRemoved.addListener(() => { void ready.then(async () => {
  if (!state.role) return;
  if (!await permissions(state.role === 'host', false)) { await stop('Required site access was removed.'); return; }
  if (state.clipboardEnabled && !await chrome.permissions.contains({ permissions: ['clipboardRead', 'clipboardWrite'] })) {
    update({ clipboardEnabled: false, notice: 'Clipboard access was removed.' }); await toOffscreen('clipboard.configure', { enabled: false });
    await transport('session.clipboard', { enabled: false, paused: state.paused }); hostState();
  }
}); });
chrome.windows.onRemoved.addListener(windowId => { if (windowId === authorizedWindowId) void stop('The shared window closed.'); });
