import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserCapture, jpegDimensions } from './capture';

function event() {
  const listeners: ((...args: any[]) => void)[] = [];
  return { addListener: (listener: (...args: any[]) => void) => listeners.push(listener), emit: (...args: any[]) => listeners.forEach(listener => listener(...args)) };
}
function jpeg(width = 1280, height = 720): string {
  return btoa(String.fromCharCode(255, 216, 255, 192, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 17, 0, 255, 217));
}
async function settled() { for (let i = 0; i < 25; i++) await Promise.resolve(); }

function harness() {
  const tab: chrome.tabs.Tab = { id: 12, windowId: 4, active: true, incognito: false, index: 0, pinned: false, highlighted: true, selected: true, discarded: false, autoDiscardable: true, groupId: -1, url: 'https://example.com', title: 'Example', frozen: false };
  let zoom = 1;
  const browser = {
    debugger: { onEvent: event(), onDetach: event(), attach: vi.fn(async () => undefined), detach: vi.fn(async () => undefined), sendCommand: vi.fn(async (_target: object, _method: string, _params?: object): Promise<object | undefined> => undefined) },
    windows: { get: vi.fn(async () => ({ id: 4, type: 'normal', state: 'normal', incognito: false })), onBoundsChanged: event(), onRemoved: event() },
    tabs: {
      onActivated: event(), onUpdated: event(), onCreated: event(), onRemoved: event(), onDetached: event(), onAttached: event(), onZoomChange: event(),
      query: vi.fn(async () => [{ ...tab }]), get: vi.fn(async () => ({ ...tab })), getZoom: vi.fn(async () => zoom),
      create: vi.fn(async () => undefined), update: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), goBack: vi.fn(async () => undefined), goForward: vi.fn(async () => undefined), reload: vi.fn(async () => undefined),
    },
  };
  vi.stubGlobal('chrome', browser);
  const hooks = { frame: vi.fn(), state: vi.fn(), error: vi.fn(), detached: vi.fn() };
  const capture = new BrowserCapture(hooks);
  const emitFrame = async (overrides: Record<string, unknown> = {}) => {
    browser.debugger.onEvent.emit({ tabId: 12 }, 'Page.screencastFrame', { sessionId: 1, data: jpeg(), metadata: { deviceWidth: 1600, deviceHeight: 900, offsetTop: 0, pageScaleFactor: 1, timestamp: Date.now() / 1000 + 0.1, ...overrides } });
    await settled();
  };
  const target = () => ({ tabId: 12, generation: hooks.frame.mock.lastCall![0].meta.generation });
  return { browser, tab, hooks, capture, emitFrame, target, setZoom: (value: number) => { zoom = value; } };
}

describe('JPEG dimensions', () => {
  it('finds dimensions without decoding pixels and rejects malformed inputs', () => {
    expect(jpegDimensions(jpeg())).toEqual({ width: 1280, height: 720 });
    expect(jpegDimensions(jpeg(820, 620))).toEqual({ width: 820, height: 620 });
    for (const invalid of ['not base64!!', '', btoa('not a jpeg'), jpeg(0, 100), jpeg().slice(0, 8)]) expect(jpegDimensions(invalid)).toBeUndefined();
  });
});

describe('BrowserCapture authorization and lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-06T00:00:00Z')); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('captures the authorized active HTTP page and maps browser zoom independently of JPEG size', async () => {
    const h = harness(); h.setZoom(1.25); await h.capture.start(4); await h.emitFrame();
    expect(h.browser.debugger.attach).toHaveBeenCalledExactlyOnceWith({ tabId: 12 }, '1.3');
    expect(h.browser.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 12 }, 'Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
    expect(h.hooks.frame.mock.lastCall![0].meta).toMatchObject({ width: 1280, height: 720, viewportWidth: 1280, viewportHeight: 720, pageScaleFactor: 1 });
    await h.capture.execute({ type: 'pointer', ...h.target(), event: 'down', x: 137, y: 42, buttons: 1 });
    expect(h.browser.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 12 }, 'Input.dispatchMouseEvent', expect.objectContaining({ x: 137, y: 42, type: 'mousePressed' }));
    await h.capture.stop();
  });

  it('never attaches to an internal page or an incognito tab', async () => {
    const h = harness(); h.tab.url = 'chrome://settings'; await h.capture.start(4);
    expect(h.browser.debugger.attach).not.toHaveBeenCalled();
    expect(h.hooks.state.mock.lastCall![0][0].supported).toBe(false);
    h.tab.url = 'https://example.com'; h.tab.incognito = true; await h.capture.refresh();
    expect(h.browser.debugger.attach).not.toHaveBeenCalled(); expect(h.hooks.state.mock.lastCall![0]).toEqual([]);
    await h.capture.stop();
  });

  it('rejects old generations immediately on navigation and ACKs discarded frames', async () => {
    const h = harness(); await h.capture.start(4); await h.emitFrame(); const old = h.target();
    h.browser.tabs.onUpdated.emit(12, { status: 'loading' }, h.tab);
    await expect(h.capture.execute({ type: 'text', ...old, text: 'stale' })).rejects.toThrow('página cambió');
    await h.emitFrame({ timestamp: Date.now() / 1000 - 1 });
    expect(h.hooks.frame).toHaveBeenCalledTimes(1);
    expect(h.browser.debugger.sendCommand.mock.calls.filter(call => call[1] === 'Page.screencastFrameAck')).toHaveLength(2);
    await h.emitFrame(); expect(h.target().generation).toBeGreaterThan(old.generation);
    await h.capture.execute({ type: 'text', ...h.target(), text: '日本語 🐈' });
    expect(h.browser.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 12 }, 'Input.insertText', { text: '日本語 🐈' });
    await h.capture.stop();
  });

  it('invalidates geometry on resize and browser zoom', async () => {
    const h = harness(); await h.capture.start(4); await h.emitFrame(); const first = h.target();
    await h.emitFrame({ deviceWidth: 820, deviceHeight: 620 });
    expect(h.target().generation).toBeGreaterThan(first.generation);
    const resized = h.target(); h.setZoom(1.25); h.browser.tabs.onZoomChange.emit({ tabId: 12, newZoomFactor: 1.25 });
    await expect(h.capture.execute({ type: 'key', ...resized, event: 'down', key: 'a', code: 'KeyA', keyCode: 65 })).rejects.toThrow('página cambió');
    await h.emitFrame({ deviceWidth: 820, deviceHeight: 620 });
    expect(h.hooks.frame.mock.lastCall![0].meta).toMatchObject({ viewportWidth: 656, viewportHeight: 496 }); await h.capture.stop();
  });

  it('checks the current window on every command and rejects arbitrary or out-of-page input', async () => {
    const h = harness(); await h.capture.start(4); await h.emitFrame();
    await expect(h.capture.execute({ type: 'Runtime.evaluate', expression: 'alert(1)' })).rejects.toThrow('Orden no válida');
    await expect(h.capture.execute({ type: 'pointer', ...h.target(), event: 'down', x: 2000, y: 10 })).rejects.toThrow('fuera de la página');
    await expect(h.capture.execute({ type: 'navigate', ...h.target(), url: 'javascript:alert(1)' })).rejects.toThrow('HTTP o HTTPS');
    h.tab.windowId = 7;
    await expect(h.capture.execute({ type: 'tab.close', tabId: 12 })).rejects.toThrow('ventana autorizada');
    expect(h.browser.tabs.remove).not.toHaveBeenCalled(); await h.capture.stop();
  });

  it('releases held keys and mouse buttons before pause and refuses further input', async () => {
    const h = harness(); await h.capture.start(4); await h.emitFrame();
    await h.capture.execute({ type: 'key', ...h.target(), event: 'down', key: 'Control', code: 'ControlLeft', keyCode: 17, modifiers: 2 });
    await h.capture.execute({ type: 'pointer', ...h.target(), event: 'down', x: 10, y: 20, buttons: 1 });
    await h.capture.execute({ type: 'pointer', ...h.target(), event: 'down', button: 'right', x: 10, y: 20, buttons: 3 });
    await h.capture.setPaused(true);
    expect(h.browser.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 12 }, 'Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyUp', key: 'Control' }));
    expect(h.browser.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 12 }, 'Input.dispatchMouseEvent', expect.objectContaining({ type: 'mouseReleased', buttons: 0 }));
    expect(h.browser.debugger.sendCommand.mock.calls.filter(call => call[1] === 'Input.dispatchMouseEvent' && (call[2] as { type: string }).type === 'mouseReleased')).toHaveLength(2);
    await expect(h.capture.execute({ type: 'text', ...h.target(), text: 'after pause' })).rejects.toThrow('detenido'); await h.capture.stop();
  });

  it('releases an in-flight keydown when control is revoked', async () => {
    const h = harness(); await h.capture.start(4); await h.emitFrame();
    let finish!: () => void;
    h.browser.debugger.sendCommand.mockImplementation(async (_target, method, params) => {
      if (method === 'Input.dispatchKeyEvent' && (params as { type: string }).type === 'rawKeyDown') await new Promise<void>(done => { finish = done; });
      return undefined;
    });
    const input = h.capture.execute({ type: 'key', ...h.target(), event: 'down', key: 'Shift', code: 'ShiftLeft', keyCode: 16 });
    await settled(); const revoke = h.capture.setControl(false); finish(); await Promise.all([input, revoke]);
    expect(h.browser.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 12 }, 'Input.dispatchKeyEvent', expect.objectContaining({ type: 'keyUp', key: 'Shift' })); await h.capture.stop();
  });

  it('fails closed when the browser detaches the debugger and never automatically reattaches', async () => {
    const h = harness(); await h.capture.start(4); await h.emitFrame();
    h.browser.debugger.onDetach.emit({ tabId: 12 }, 'canceled_by_user');
    h.browser.tabs.onUpdated.emit(12, { title: 'Updated' }, h.tab); await settled();
    expect(h.hooks.detached).toHaveBeenCalledTimes(1); expect(h.browser.debugger.attach).toHaveBeenCalledTimes(1);
    await expect(h.capture.execute({ type: 'tab.create', url: 'https://example.com' })).rejects.toThrow('detenido'); await h.capture.stop();
  });

  it('continues on the next authorized tab when the captured tab closes', async () => {
    const h = harness(); await h.capture.start(4); await h.emitFrame();
    h.tab.id = 13;
    h.browser.debugger.onDetach.emit({ tabId: 12 }, 'target_closed');
    await h.capture.refresh();
    expect(h.hooks.detached).not.toHaveBeenCalled();
    expect(h.browser.debugger.attach).toHaveBeenLastCalledWith({ tabId: 13 }, '1.3');
    await h.capture.stop();
  });

  it('fails closed when the authorized window is minimized', async () => {
    const h = harness(); await h.capture.start(4); await h.emitFrame();
    h.browser.windows.onBoundsChanged.emit({ id: 4, state: 'minimized' }); await settled();
    expect(h.hooks.detached).toHaveBeenCalledTimes(1); expect(h.browser.debugger.detach).toHaveBeenCalledTimes(1);
    h.browser.windows.onBoundsChanged.emit({ id: 4, state: 'normal' }); await h.capture.refresh();
    expect(h.browser.debugger.attach).toHaveBeenCalledTimes(1); await h.capture.stop();
  });

  it('propagates attach failures instead of silently starting a broken session', async () => {
    const h = harness(); h.browser.debugger.attach.mockRejectedValueOnce(new Error('Debugger denied'));
    await expect(h.capture.start(4)).rejects.toThrow('Debugger denied'); expect(h.hooks.error).toHaveBeenCalledTimes(1); await h.capture.stop();
  });
});
