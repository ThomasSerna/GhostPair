import { afterEach, describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => ({
  start: vi.fn(async (_windowId: number) => {}), stop: vi.fn(async () => {}),
  authorize: vi.fn(async (_tabId: number) => {}), release: vi.fn(async (_tabId: number) => {}),
  configure: vi.fn(async () => {}), setControl: vi.fn(async () => {}), setPaused: vi.fn(async () => {}), execute: vi.fn(async () => {}), geometry: vi.fn(),
}));
vi.mock('./core/tab-capture', () => ({ TabCapture: class { constructor() { return capture; } } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function event() {
  const addListener = vi.fn();
  return { addListener, emit: (...args: any[]) => { for (const [listener] of addListener.mock.calls) listener(...args); } };
}
async function settled() { for (let i = 0; i < 35; i++) await Promise.resolve(); }
async function harness(stored: Record<string, unknown> = {}) {
  vi.resetModules(); vi.clearAllMocks();
  capture.stop.mockImplementation(async () => {}); capture.start.mockImplementation(async () => {}); capture.authorize.mockImplementation(async () => {});
  const registered = { deviceId: 'a'.repeat(32), ownerToken: 'b'.repeat(64) };
  const runtime = {
    id: 'test-extension', getURL: (path: string) => `chrome-extension://test-extension/${path}`,
    ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
    getContexts: vi.fn(async () => [{}]), onMessage: event(), onConnect: event(),
    sendMessage: vi.fn(async (message: Record<string, unknown>): Promise<any> => message.type === 'identity.register' ? { ok: true, identity: registered } : { ok: true }),
  };
  const browser = {
    runtime,
    storage: {
      local: { setAccessLevel: vi.fn(async () => {}), get: vi.fn(async () => stored), set: vi.fn(async (value: object) => Object.assign(stored, value)), remove: vi.fn(async (key: string) => { delete stored[key]; }) },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
    },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setTitle: vi.fn() },
    permissions: { contains: vi.fn(async () => true), onRemoved: event() },
    windows: { get: vi.fn(async () => ({ id: 7, type: 'normal', incognito: false })), update: vi.fn(), onRemoved: event() },
    tabs: {
      create: vi.fn(async () => ({ id: 9 })), query: vi.fn(async (query: Record<string, unknown>): Promise<any[]> => query.active ? [{ id: 12, windowId: 7, active: true, url: 'https://example.com' }] : []), update: vi.fn(),
    },
    commands: { onCommand: event() },
  };
  vi.stubGlobal('chrome', browser); await import('./background');
  const send = (type: string, fields: object = {}, source: 'popup' | 'offscreen' | 'viewer' = 'popup', tabId = 9) => new Promise<any>(resolve => {
    runtime.onMessage.emit({ target: 'background', type, ...fields }, { id: runtime.id, url: runtime.getURL(`${source}.html`), ...(source !== 'offscreen' ? { tab: { id: tabId, windowId: 7 } } : {}) }, resolve);
  });
  const connectViewer = (id = 9) => {
    const port = {
      name: 'viewer', sender: { id: runtime.id, url: runtime.getURL('viewer.html'), tab: { id, windowId: 7 } }, onMessage: event(), onDisconnect: event(),
      postMessage: vi.fn((message: Record<string, any>) => {
        if (message.type === 'transport.request') queueMicrotask(() => port.onMessage.emit({ type: 'transport.reply', requestId: message.requestId, reply: { ok: true } }));
      }),
    };
    runtime.onConnect.emit(port); return port;
  };
  await send('ui.status');
  const hasOffscreenMessage = (type: string) => runtime.sendMessage.mock.calls.some(([message]) => message.type === type);
  return { stored, browser, runtime, send, connectViewer, registered, hasOffscreenMessage };
}
afterEach(() => vi.unstubAllGlobals());

describe('background connection ownership and settings', () => {
  it('persists preview preferences independently and starts each new session in visual mode', async () => {
    const h = await harness();
    expect((await h.send('ui.status')).state).toMatchObject({ controlMode: 'visual', visualPreferences: { notices: false, text: { duration: 'persistent', seconds: 10 }, other: { duration: 'persistent', seconds: 3 } } });
    await h.send('ui.host.start', { password: 'Eight-42' });
    const preferences = { notices: true, text: { duration: 'temporary', seconds: 0.5 }, other: { duration: 'temporary', seconds: 0.5 }, accentColor: '#12abcd' };
    const saved = await h.send('ui.visual.preferences', { preferences });
    expect(saved.state.status).toBe('starting');
    expect(saved.state.visualPreferences).toEqual(preferences);
    const mode = await h.send('ui.control.mode', { mode: 'live' });
    expect(mode.state).toMatchObject({ controlMode: 'live', controlRevision: 1 });
    expect(capture.configure).toHaveBeenLastCalledWith({ mode: 'live', revision: 1, preferences });
    const cleared = await h.send('ui.visual.clear'); expect(cleared.state.controlRevision).toBe(2);
    await h.send('ui.stop');
    expect((await h.send('ui.status')).state).toMatchObject({ controlMode: 'visual', controlRevision: 0, visualPreferences: preferences });
    await h.send('ui.settings.reset'); expect(h.stored.visualPreferences).toEqual(preferences);
    const restarted = await harness(h.stored); expect((await restarted.send('ui.status')).state.visualPreferences).toEqual(preferences);
  });
  it('upgrades legacy visual preferences and saves colors before hosting', async () => {
    const legacy = { notices: true, duration: 'temporary', seconds: 12 };
    const migrated = { notices: true, text: { duration: 'temporary', seconds: 12 }, other: { duration: 'temporary', seconds: 12 } };
    const h = await harness({ visualPreferences: legacy });
    expect((await h.send('ui.status')).state.visualPreferences).toEqual({ ...migrated, accentColor: '#7871e8' });
    const preferences = { ...migrated, text: { duration: 'temporary', seconds: 0.5 }, accentColor: '#abcdef' };
    expect((await h.send('ui.visual.preferences', { preferences })).state.visualPreferences).toEqual(preferences);
    expect(capture.configure).not.toHaveBeenCalled();
    const invalid = await h.send('ui.visual.preferences', { preferences: { ...preferences, accentColor: 'red' } });
    expect(invalid.ok).toBe(false);
    expect(h.stored.visualPreferences).toEqual(preferences);
    await h.send('ui.host.start', { password: 'Eight-42' });
    expect(capture.configure).toHaveBeenCalledWith({ mode: 'visual', revision: 0, preferences });
  });
  it('preserves manual settings until build defaults are explicitly restored', async () => {
    const h = await harness(); const defaults = (await h.send('ui.status')).state.settings;
    const settings = { signalingUrl: 'https://signal.example.com', stunUrls: ['stun:example.com:3478'] };
    expect((await h.send('ui.settings.save', { settings })).state.settings).toEqual(settings);
    expect((await h.send('ui.status')).state.settings).toEqual(settings);
    expect((await h.send('ui.settings.reset')).state.settings).toEqual(defaults);
    expect(h.browser.storage.local.remove).toHaveBeenCalledWith('settings');
  });
  it('focuses an existing viewer and starts guest transport in its owner without another tab', async () => {
    const h = await harness(); await h.send('ui.viewer.open'); expect(h.browser.tabs.create).toHaveBeenCalledTimes(1);
    h.browser.tabs.query.mockResolvedValue([{ id: 9, windowId: 7 }]); await h.send('ui.viewer.open');
    expect(h.browser.tabs.create).toHaveBeenCalledTimes(1); expect(h.browser.tabs.update).toHaveBeenCalledWith(9, { active: true });
    const port = h.connectViewer(); const result = await h.send('ui.guest.start', { deviceId: 'a'.repeat(32), password: 'Eight-42' }, 'viewer');
    expect(result.ok).toBe(true); expect(result.state.role).toBe('guest');
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'transport.request', message: expect.objectContaining({ type: 'session.start', role: 'guest' }) }));
    expect(h.hasOffscreenMessage('session.start')).toBe(false); expect(h.browser.tabs.create).toHaveBeenCalledTimes(1); await h.send('ui.stop');
  });
  it('requires the owning viewer for guest startup and rejects duplicate viewers', async () => {
    const h = await harness(); const args = { deviceId: 'a'.repeat(32), password: 'Eight-42' };
    expect((await h.send('ui.guest.start', args)).error).toBe('Join from the connection page.');
    expect((await h.send('ui.guest.start', args, 'viewer')).ok).toBe(false);
    h.connectViewer(); const duplicate = h.connectViewer(10);
    expect(duplicate.postMessage).toHaveBeenCalledWith({ type: 'viewer.duplicate' });
    expect((await h.send('ui.guest.start', args, 'viewer', 10)).ok).toBe(false); expect(h.hasOffscreenMessage('session.start')).toBe(false);
  });
  it('starts capture and consumes authorization before registration or peer connection', async () => {
    const h = await harness(); const result = await h.send('ui.host.start', { password: 'Eight-42' });
    expect(result.ok).toBe(true); expect(capture.start).toHaveBeenCalledExactlyOnceWith(7); expect(capture.authorize).toHaveBeenCalledExactlyOnceWith(12);
    const registerIndex = h.runtime.sendMessage.mock.calls.findIndex(([message]) => message.type === 'identity.register');
    expect(capture.start.mock.invocationCallOrder[0]).toBeLessThan(capture.authorize.mock.invocationCallOrder[0]);
    expect(capture.authorize.mock.invocationCallOrder[0]).toBeLessThan(h.runtime.sendMessage.mock.invocationCallOrder[registerIndex]);
    await h.send('transport.connected', { sessionId: 'session' }, 'offscreen');
    expect(capture.start).toHaveBeenCalledTimes(1); expect(capture.authorize).toHaveBeenCalledTimes(1); await h.send('ui.stop');
  });
});
describe('background cancellation', () => {
  it('stops captures, peers and clipboard when required site permission is revoked', async () => {
    const h = await harness(); await h.send('ui.host.start', { password: 'Eight-42', clipboard: true });
    await h.send('transport.connected', { sessionId: 'session' }, 'offscreen');
    h.browser.permissions.contains.mockResolvedValue(false); h.browser.permissions.onRemoved.emit({ origins: ['https://*/*'] }); await settled();
    const current = (await h.send('ui.status')).state;
    expect(current.role).toBeNull(); expect(current.clipboardEnabled).toBe(false); expect(capture.stop).toHaveBeenCalled();
    expect(h.hasOffscreenMessage('session.stop')).toBe(true); expect(h.hasOffscreenMessage('clipboard.stop')).toBe(true);
    expect(current.notification.message).toContain('site access was removed');
  });
  it('does not start capture or transport if Stop arrives during the permission check', async () => {
    const h = await harness(); const permission = deferred<boolean>(); h.browser.permissions.contains.mockReturnValueOnce(permission.promise);
    const starting = h.send('ui.host.start', { password: 'Eight-42' }); await settled(); expect(h.browser.permissions.contains).toHaveBeenCalled();
    expect((await h.send('ui.stop')).state.status).toBe('idle'); permission.resolve(true); await starting;
    expect((await h.send('ui.status')).state.role).toBeNull(); expect(capture.start).not.toHaveBeenCalled(); expect(h.hasOffscreenMessage('session.start')).toBe(false);
  });
  it('does not authorize after capture preparation completes following Stop', async () => {
    const h = await harness(); const prepared = deferred<void>(); capture.start.mockReturnValueOnce(prepared.promise);
    const starting = h.send('ui.host.start', { password: 'Eight-42' }); await settled();
    expect(capture.start).toHaveBeenCalledWith(7); await h.send('ui.stop'); prepared.resolve(); await starting;
    expect((await h.send('ui.status')).state.role).toBeNull(); expect(capture.authorize).not.toHaveBeenCalled();
    expect(h.hasOffscreenMessage('session.start')).toBe(false); expect(capture.stop).toHaveBeenCalled();
  });
  it('does not register after Stop while acquiring an authorized capture', async () => {
    const h = await harness(); const acquired = deferred<void>(); capture.authorize.mockReturnValueOnce(acquired.promise);
    const starting = h.send('ui.host.start', { password: 'Eight-42' }); await settled();
    expect(capture.authorize).toHaveBeenCalledWith(12); await h.send('ui.stop'); acquired.resolve(); await starting;
    expect(h.hasOffscreenMessage('identity.register')).toBe(false); expect(h.hasOffscreenMessage('session.start')).toBe(false);
    expect((await h.send('ui.status')).state.status).toBe('idle');
  });
  it('stops transport immediately while capture cleanup and registration are pending', async () => {
    const h = await harness(); const registration = deferred<unknown>(); const stoppedCapture = deferred<void>();
    h.runtime.sendMessage.mockImplementation(async message => message.type === 'identity.register' ? registration.promise : { ok: true });
    const starting = h.send('ui.host.start', { password: 'Eight-42' }); await settled(); expect(h.hasOffscreenMessage('identity.register')).toBe(true);
    capture.stop.mockReturnValueOnce(stoppedCapture.promise); const stopping = h.send('ui.stop'); await settled(); expect(h.hasOffscreenMessage('session.stop')).toBe(true);
    registration.resolve({ ok: true, identity: h.registered }); await starting; expect(h.hasOffscreenMessage('session.start')).toBe(false);
    stoppedCapture.resolve(); await stopping; expect((await h.send('ui.status')).state.status).toBe('idle');
  });
  it('preempts a serialized remote command with Stop without waiting for its reply', async () => {
    const h = await harness(); const port = h.connectViewer();
    await h.send('ui.guest.start', { deviceId: 'a'.repeat(32), password: 'Eight-42' }, 'viewer'); await h.send('transport.connected', { sessionId: 'session' }, 'viewer');
    let commandRequest: any;
    port.postMessage.mockImplementation(message => {
      if (message.type !== 'transport.request') return;
      if (message.message.type === 'session.command') commandRequest = message;
      else queueMicrotask(() => port.onMessage.emit({ type: 'transport.reply', requestId: message.requestId, reply: { ok: true } }));
    });
    let commandComplete = false;
    const command = h.send('ui.command', { command: { type: 'tab.create', controlRevision: 0, url: 'https://example.com' } }, 'viewer').then(result => { commandComplete = true; return result; });
    await settled(); expect(commandRequest).toBeDefined(); const stopped = await h.send('ui.stop');
    expect(stopped.state.status).toBe('idle'); expect(commandComplete).toBe(false);
    port.onMessage.emit({ type: 'transport.reply', requestId: commandRequest.requestId, reply: { ok: true } }); await command;
    expect((await h.send('ui.status')).state.role).toBeNull();
  });
  it('ends a guest session when its owner viewer closes', async () => {
    const h = await harness(); const port = h.connectViewer(); await h.send('ui.guest.start', { deviceId: 'a'.repeat(32), password: 'Eight-42' }, 'viewer');
    port.onDisconnect.emit(); await settled(); const result = await h.send('ui.status');
    expect(result.state.role).toBeNull(); expect(result.state.status).toBe('idle'); expect(result.state.notification.message).toContain('connection page closed');
  });
});
