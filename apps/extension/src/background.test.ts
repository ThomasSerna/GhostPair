import { afterEach, describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => ({
  start: vi.fn(async (): Promise<void> => undefined), stop: vi.fn(async (): Promise<void> => undefined),
  setControl: vi.fn(async () => undefined), setPaused: vi.fn(async () => undefined),
  execute: vi.fn(async () => undefined), profile: vi.fn(async () => undefined),
}));
vi.mock('./core/capture', () => ({ BrowserCapture: class { constructor() { return capture; } } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function event() { return { addListener: vi.fn() }; }

async function harness() {
  vi.resetModules(); vi.clearAllMocks();
  capture.stop.mockImplementation(async () => undefined);
  capture.start.mockImplementation(async () => undefined);
  const stored: Record<string, unknown> = {};
  const registered = { deviceId: 'a'.repeat(32), ownerToken: 'b'.repeat(64) };
  const runtime = {
    id: 'test-extension', getURL: (path: string) => `chrome-extension://test-extension/${path}`,
    ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
    getContexts: vi.fn(async () => [{}]), onMessage: event(), onConnect: event(),
    sendMessage: vi.fn(async (message: Record<string, unknown>): Promise<unknown> => message.type === 'identity.register' ? { ok: true, identity: registered } : { ok: true }),
  };
  const browser = {
    runtime,
    storage: {
      local: { setAccessLevel: vi.fn(async () => undefined), get: vi.fn(async () => stored), set: vi.fn(async (value: object) => Object.assign(stored, value)) },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
    },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setTitle: vi.fn() },
    permissions: { contains: vi.fn(async () => true), onRemoved: event() },
    windows: { get: vi.fn(async () => ({ id: 7, type: 'normal', incognito: false })), onRemoved: event() },
    tabs: { create: vi.fn() }, commands: { onCommand: event() }, debugger: { detach: vi.fn() },
  };
  vi.stubGlobal('chrome', browser);
  await import('./background');
  const send = (type: string, fields: object = {}, transport = false) => new Promise<any>(resolve => {
    const listener = runtime.onMessage.addListener.mock.calls[0]![0];
    listener({ target: 'background', type, ...fields }, { id: runtime.id, url: runtime.getURL(transport ? 'offscreen.html' : 'popup.html'), ...(!transport ? { tab: { windowId: 7 } } : {}) }, resolve);
  });
  await send('ui.status');
  return { browser, runtime, send, registered };
}

afterEach(() => vi.unstubAllGlobals());

describe('background session cancellation', () => {
  it('does not start transport if Stop arrives during the permission check', async () => {
    const h = await harness(); const permission = deferred<boolean>();
    h.browser.permissions.contains.mockReturnValueOnce(permission.promise);
    const starting = h.send('ui.host.start', { password: 'Synthetic-pass-42' });
    await vi.waitFor(() => expect(h.browser.permissions.contains).toHaveBeenCalled());
    expect((await h.send('ui.stop')).state.status).toBe('idle');
    permission.resolve(true); await starting;
    expect((await h.send('ui.status')).state.role).toBeNull();
    expect(h.runtime.sendMessage.mock.calls.some(([m]) => m.type === 'session.start')).toBe(false);
  });

  it('stops transport immediately while capture cleanup and registration are pending', async () => {
    const h = await harness(); const registration = deferred<unknown>(); const stoppedCapture = deferred<void>();
    h.runtime.sendMessage.mockImplementation(async message => message.type === 'identity.register' ? registration.promise : { ok: true });
    capture.stop.mockReturnValueOnce(stoppedCapture.promise);
    const starting = h.send('ui.host.start', { password: 'Synthetic-pass-42' });
    await vi.waitFor(() => expect(h.runtime.sendMessage.mock.calls.some(([m]) => m.type === 'identity.register')).toBe(true));
    const stopping = h.send('ui.stop');
    await vi.waitFor(() => expect(h.runtime.sendMessage.mock.calls.some(([m]) => m.type === 'session.stop')).toBe(true));
    registration.resolve({ ok: true, identity: h.registered });
    await starting;
    expect(h.runtime.sendMessage.mock.calls.some(([m]) => m.type === 'session.start')).toBe(false);
    stoppedCapture.resolve(); await stopping;
    expect((await h.send('ui.status')).state.status).toBe('idle');
  });

  it('does not revive a session after capture startup completes following Stop', async () => {
    const h = await harness(); const attached = deferred<void>();
    capture.start.mockReturnValueOnce(attached.promise);
    await h.send('ui.host.start', { password: 'Synthetic-pass-42' });
    const connecting = h.send('transport.connected', { sessionId: 'session' }, true);
    await vi.waitFor(() => expect(capture.start).toHaveBeenCalledWith(7));
    await h.send('ui.stop'); attached.resolve(); await connecting;
    const result = await h.send('ui.status');
    expect(result.state.status).toBe('idle'); expect(result.state.role).toBeNull();
    expect(capture.stop).toHaveBeenCalled();
  });
});
