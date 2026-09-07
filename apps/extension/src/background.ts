import { PasswordSchema, SettingsSchema, validateSignalingUrl, type AppState, type Settings } from '@ghostpair/protocol';
import { BrowserCapture } from './core/capture';

const defaults: Settings = {
  signalingUrl: import.meta.env.VITE_SIGNALING_URL || 'http://127.0.0.1:8787',
  stunUrls: (import.meta.env.VITE_STUN_URLS || 'stun:stun.l.google.com:19302').split(',').map((s: string) => s.trim()).filter(Boolean),
};
let state: AppState = idle(defaults);
let authorizedWindowId: number | undefined;
let creatingOffscreen: Promise<void> | undefined;
let terminating: Promise<void> | undefined;
let mutation: Promise<unknown> = Promise.resolve();
let sessionEpoch = 0;
const viewers = new Set<chrome.runtime.Port>();

function idle(settings: Settings, deviceId?: string): AppState {
  return { role: null, status: 'idle', deviceId, paused: false, controlEnabled: true, clipboardEnabled: false, remoteClipboardEnabled: false, tabs: [], generation: 0, settings };
}

async function hasOffscreen() {
  return (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [chrome.runtime.getURL('offscreen.html')] })).length > 0;
}
async function offscreen() {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WEB_RTC, chrome.offscreen.Reason.CLIPBOARD], justification: 'Conexión P2P de la sesión autorizada y sincronización opcional de texto.' }).finally(() => { creatingOffscreen = undefined; });
  await creatingOffscreen;
}
async function transport(type: string, payload: object = {}) {
  return chrome.runtime.sendMessage({ target: 'offscreen', type, ...payload });
}

function sharedState() {
  return { paused: state.paused, controlEnabled: state.controlEnabled, clipboardEnabled: state.clipboardEnabled, tabs: state.tabs, activeTabId: state.activeTabId, generation: state.generation };
}
function broadcast() {
  for (const port of viewers) { try { port.postMessage({ type: 'state', state }); } catch { viewers.delete(port); } }
  void chrome.runtime.sendMessage({ type: 'state', state }).catch(() => undefined);
  void chrome.storage.session.set({ appState: state });
  const sharing = state.role === 'host' && !['idle', 'error'].includes(state.status);
  void chrome.action.setBadgeText({ text: sharing ? state.paused ? 'Ⅱ' : 'ON' : '' });
  void chrome.action.setBadgeBackgroundColor({ color: state.paused ? '#d2b573' : '#26724c' });
  void chrome.action.setTitle({ title: sharing ? `GhostPair · ${state.paused ? 'Sesión pausada' : 'Compartiendo páginas'} · Abrir para detener` : 'GhostPair' });
}
function update(patch: Partial<AppState>) { state = { ...state, ...patch }; broadcast(); }
function hostState() { if (state.role === 'host' && ['connected', 'paused'].includes(state.status)) void transport('session.state', { snapshot: sharedState() }).catch(() => undefined); }

const capture = new BrowserCapture({
  frame: frame => { if (state.role === 'host' && state.status === 'connected' && !state.paused) void transport('capture.frame', { frame }).catch(() => undefined); },
  state: (tabs, activeTabId, generation) => { if (state.role === 'host') { update({ tabs, activeTabId, generation }); hostState(); } },
  error: message => { update({ notice: message }); },
  detached: () => { void stop('El navegador detuvo el control. Inicia otra sesión desde el menú.'); },
});

const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const saved = await chrome.storage.local.get(['settings', 'identities']);
  const settings = SettingsSchema.safeParse(saved.settings).success ? saved.settings as Settings : defaults;
  const identity = (saved.identities as Record<string, { deviceId: string }> | undefined)?.[settings.signalingUrl];
  const session = (await chrome.storage.session.get('appState')).appState as AppState | undefined;
  if (session?.role === 'guest' && session.settings.signalingUrl === settings.signalingUrl && await hasOffscreen()) state = session;
  else {
    state = idle(settings, identity?.deviceId);
    if (session?.role === 'host' && !['idle', 'error'].includes(session.status)) {
      if (await hasOffscreen()) await transport('session.stop').catch(() => undefined);
      if (session.activeTabId !== undefined) await chrome.debugger.detach({ tabId: session.activeTabId }).catch(() => undefined);
      state.notice = 'El navegador reinició el control. Inicia una sesión nueva.';
    }
  }
  broadcast();
})();

async function identity() {
  const saved = await chrome.storage.local.get('identities');
  const identities = (saved.identities ?? {}) as Record<string, { deviceId: string; ownerToken: string }>;
  const key = state.settings.signalingUrl;
  if (identities[key]) return identities[key]!;
  // Registration is in offscreen so its extension Origin is preserved by Fetch.
  const result = await transport('identity.register', { settings: state.settings });
  if (!result?.ok || !/^[0-9a-f]{32}$/.test(result.identity?.deviceId ?? '') || !/^[0-9a-f]{64}$/.test(result.identity?.ownerToken ?? '')) throw new Error(result?.error ?? 'No se pudo registrar la instalación.');
  identities[key] = result.identity;
  await chrome.storage.local.set({ identities });
  return result.identity as { deviceId: string; ownerToken: string };
}

async function stop(reason?: string): Promise<void> {
  if (terminating) return terminating;
  ++sessionEpoch;
  const previousDevice = state.deviceId;
  // Block incoming frames/commands before any asynchronous cleanup.
  update({ status: 'idle', paused: true, controlEnabled: false, clipboardEnabled: false, remoteClipboardEnabled: false });
  authorizedWindowId = undefined;
  terminating = (async () => {
    // Stop clipboard/transport immediately, independently of CDP cleanup latency.
    await Promise.allSettled([
      capture.stop(),
      hasOffscreen().then(exists => exists ? transport('session.stop', { reason }) : undefined),
    ]);
    state = { ...idle(state.settings, previousDevice), ...(reason ? { notice: reason } : {}) };
    broadcast();
  })().finally(() => { terminating = undefined; });
  return terminating;
}

async function hasPermissions(clipboard: boolean) {
  const origin = new URL(state.settings.signalingUrl).origin;
  return chrome.permissions.contains({ origins: [`${origin}/*`], ...(clipboard ? { permissions: ['clipboardRead', 'clipboardWrite'] } : {}) });
}

async function action(message: Record<string, any>, sender: chrome.runtime.MessageSender): Promise<AppState> {
  switch (message.type) {
    case 'ui.status': return state;
    case 'ui.settings.reset': {
      if (!['idle', 'error'].includes(state.status)) throw new Error('End the session before changing settings.');
      await chrome.storage.local.remove('settings');
      const identities = (await chrome.storage.local.get('identities')).identities as Record<string, { deviceId: string }> | undefined;
      state = idle(defaults, identities?.[defaults.signalingUrl]?.deviceId);
      broadcast(); return state;
    }
    case 'ui.settings.save': {
      if (!['idle', 'error'].includes(state.status)) throw new Error('Termina la sesión antes de cambiar la configuración.');
      const settings = SettingsSchema.parse(message.settings);
      if (!validateSignalingUrl(settings.signalingUrl)) throw new Error('Se requiere señalización HTTPS; HTTP solo se admite en loopback.');
      await chrome.storage.local.set({ settings });
      const identities = (await chrome.storage.local.get('identities')).identities as Record<string, { deviceId: string }> | undefined;
      state = idle(settings, identities?.[settings.signalingUrl]?.deviceId);
      broadcast(); return state;
    }
    case 'ui.host.start':
    case 'ui.guest.start': {
      if (terminating) await terminating;
      if (!['idle', 'error'].includes(state.status)) throw new Error('Ya hay una sesión activa.');
      const startEpoch = ++sessionEpoch;
      const current = () => startEpoch === sessionEpoch;
      if (!validateSignalingUrl(state.settings.signalingUrl)) throw new Error('Configura un servidor HTTPS válido.');
      const host = message.type === 'ui.host.start';
      const password = host ? PasswordSchema.parse(message.password) : String(message.password ?? '');
      if (!password || password.length > 256) throw new Error('Introduce la contraseña de la sesión.');
      const clipboard = message.clipboard === true;
      if (!await hasPermissions(clipboard)) throw new Error('Autoriza el servidor y los permisos elegidos desde el menú.');
      if (!current()) return state;
      let windowId: number | undefined;
      if (host) {
        const window = sender.tab ? await chrome.windows.get(sender.tab.windowId) : await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        if (window.incognito || window.type !== 'normal') throw new Error('Selecciona una ventana normal del navegador.');
        windowId = window.id;
      }
      if (!current()) return state;
      update({ role: host ? 'host' : 'guest', status: 'starting', error: undefined, notice: undefined, clipboardEnabled: clipboard, paused: false, controlEnabled: true, tabs: [], activeTabId: undefined, generation: 0 });
      try {
        await offscreen();
        if (!current()) return state;
        const owner = host ? await identity() : undefined;
        if (!current()) return state;
        const deviceId = host ? owner!.deviceId : String(message.deviceId ?? '').replace(/[\s-]/g, '').toLowerCase();
        if (!/^[0-9a-f]{32}$/.test(deviceId)) throw new Error('La dirección debe contener 32 caracteres hexadecimales.');
        authorizedWindowId = windowId;
        if (host) update({ deviceId });
        const reply = await transport('session.start', { role: host ? 'host' : 'guest', settings: state.settings, deviceId, ownerToken: owner?.ownerToken, password, clipboard });
        if (!current()) return state;
        if (!reply?.ok) throw new Error(reply?.error ?? 'No se pudo iniciar la conexión.');
        if (!host) await chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
      } catch (error) {
        if (!current()) return state;
        await stop();
        update({ status: 'error', error: error instanceof Error ? error.message : 'No se pudo iniciar la sesión.' });
      }
      return state;
    }
    case 'ui.stop': await stop(); return state;
    case 'ui.pause': {
      if (state.role !== 'host' || !['connected', 'paused'].includes(state.status)) throw new Error('La sesión todavía no está conectada.');
      const paused = message.paused === true;
      update({ paused, status: paused ? 'paused' : 'connected' });
      hostState();
      await Promise.all([capture.setPaused(paused), transport('session.clipboard', { enabled: state.clipboardEnabled, paused })]);
      return state;
    }
    case 'ui.control': {
      if (state.role !== 'host') throw new Error('Solo el anfitrión puede cambiar el control.');
      update({ controlEnabled: message.enabled === true });
      await capture.setControl(state.controlEnabled); hostState(); return state;
    }
    case 'ui.clipboard': {
      const enabled = message.enabled === true;
      if (enabled && !await chrome.permissions.contains({ permissions: ['clipboardRead', 'clipboardWrite'] })) throw new Error('Autoriza el portapapeles en este equipo.');
      update({ clipboardEnabled: enabled });
      if (await hasOffscreen()) await transport('session.clipboard', { enabled, paused: state.paused });
      hostState(); return state;
    }
    default: throw new Error('Operación desconocida.');
  }
}

async function fromTransport(message: Record<string, any>) {
  if (message.type === 'transport.status') {
    if (!state.role || terminating) return;
    const status = message.status as AppState['status'];
    if (['waiting', 'connecting'].includes(status)) update({ status, sessionId: message.sessionId ?? state.sessionId });
    return;
  }
  if (message.type === 'transport.connected') {
    if (!state.role || terminating) return;
    update({ status: 'connected', sessionId: message.sessionId, connection: { direct: true }, notice: undefined });
    if (state.role === 'host' && authorizedWindowId !== undefined) {
      try {
        await capture.start(authorizedWindowId);
        await capture.setControl(state.controlEnabled);
        hostState();
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'El navegador no permitió compartir esta página.';
        await stop(reason); update({ status: 'error', error: reason });
      }
    }
    return;
  }
  if (message.type === 'transport.ended') {
    if (terminating) return;
    const reason = String(message.reason || 'La sesión terminó.');
    await stop(reason);
    if (message.failed) update({ status: 'error', error: reason });
    return;
  }
  if (message.type === 'transport.notice') { update({ notice: String(message.message || '') }); return; }
  if (message.type === 'transport.clipboard') { update({ remoteClipboardEnabled: message.remoteEnabled === true, ...(message.disabled ? { clipboardEnabled: false } : {}) }); return; }
  if (message.type === 'transport.stats') { if (state.connection) update({ connection: { ...state.connection, latencyMs: message.latencyMs } }); return; }
  if (message.type === 'transport.snapshot' && state.role === 'guest') {
    const remote = message.snapshot;
    update({ tabs: remote.tabs, activeTabId: remote.activeTabId, generation: remote.generation, paused: remote.paused, controlEnabled: remote.controlEnabled, remoteClipboardEnabled: remote.clipboardEnabled, status: remote.paused ? 'paused' : 'connected' });
    return;
  }
  if (message.type === 'transport.frame' && state.role === 'guest' && state.status === 'connected') {
    for (const port of viewers) { try { port.postMessage({ type: 'frame', frame: message.frame }); } catch { viewers.delete(port); } }
    return;
  }
  if (message.type === 'transport.command' && state.role === 'host' && state.status === 'connected' && !state.paused) {
    try { await capture.execute(message.command); }
    catch (error) { await transport('session.notice', { message: error instanceof Error ? error.message : 'No se pudo aplicar la acción.' }); }
    return;
  }
  if (message.type === 'transport.profile' && state.role === 'host') await capture.profile(message.congested === true);
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'background') return;
  const fromOffscreen = sender.url === chrome.runtime.getURL('offscreen.html');
  const fromUi = sender.url?.startsWith(chrome.runtime.getURL('popup.html')) || sender.url?.startsWith(chrome.runtime.getURL('viewer.html'));
  if (!fromOffscreen && !fromUi) return;
  void (async () => {
    await ready;
    if (fromOffscreen) { await fromTransport(message); return { ok: true, state }; }
    if (message.type === 'ui.status') return { ok: true, state };
    if (message.type === 'ui.stop') { await stop(); return { ok: true, state }; }
    const pending = mutation.then(() => action(message, sender));
    mutation = pending.catch(() => undefined);
    return { ok: true, state: await pending };
  })().then(respond).catch(error => respond({ ok: false, error: error instanceof Error ? error.message : 'Ocurrió un error.' }));
  return true;
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'viewer' || port.sender?.id !== chrome.runtime.id || !port.sender.url?.startsWith(chrome.runtime.getURL('viewer.html'))) return;
  viewers.add(port);
  void ready.then(async () => {
    port.postMessage({ type: 'state', state });
    if (state.role === 'guest' && await hasOffscreen()) await transport('session.resendFrame');
  }).catch(() => undefined);
  port.onDisconnect.addListener(() => viewers.delete(port));
  port.onMessage.addListener(message => {
    if (message?.type === 'control' && state.role === 'guest' && state.status === 'connected' && state.controlEnabled && !state.paused) void transport('session.command', { command: message.command }).catch(() => undefined);
  });
});
chrome.commands.onCommand.addListener(command => { if (command === 'stop-session') void ready.then(() => stop()); });
chrome.permissions.onRemoved.addListener(() => { void ready.then(async () => {
  if (!state.role) return;
  if (!await hasPermissions(false)) { await stop('Se retiró el permiso del servidor.'); return; }
  if (state.clipboardEnabled && !await chrome.permissions.contains({ permissions: ['clipboardRead', 'clipboardWrite'] })) {
    update({ clipboardEnabled: false, notice: 'Se retiró el permiso del portapapeles.' });
    await transport('session.clipboard', { enabled: false, paused: state.paused }); hostState();
  }
}); });
chrome.windows.onRemoved.addListener(windowId => { if (windowId === authorizedWindowId) void stop('Se cerró la ventana compartida.'); });
