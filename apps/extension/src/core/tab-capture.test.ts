import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Presentation, type TabInfo } from '@ghostpair/protocol';
import { MAX_CAPTURED_TABS, TabCapture } from './tab-capture';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function event() {
  const addListener = vi.fn();
  return { addListener, emit: (...args: any[]) => { for (const [listener] of addListener.mock.calls) listener(...args); } };
}
async function settled() { for (let i = 0; i < 25; i++) await Promise.resolve(); }
function harness() {
  const tabs = new Map<number, any>([[12, { id: 12, windowId: 4, active: true, incognito: false, url: 'https://example.com', title: 'Example', status: 'complete' }]]);
  const geometry = { viewportWidth: 1280, viewportHeight: 720, offsetLeft: 0, offsetTop: 0, scale: 1 };
  let documentId = 'document-one';
  const browser = {
    windows: { onBoundsChanged: event() },
    tabs: {
      onActivated: event(), onUpdated: event(), onCreated: event(), onRemoved: event(), onDetached: event(), onAttached: event(), onZoomChange: event(),
      query: vi.fn(async (query: { windowId: number }) => [...tabs.values()].filter(tab => tab.windowId === query.windowId).map(tab => ({ ...tab }))),
      get: vi.fn(async (id: number): Promise<any> => { const tab = tabs.get(id); if (!tab) throw new Error('Tab closed'); return { ...tab }; }),
      create: vi.fn(async (_options: object) => ({})), update: vi.fn(async (_id: number, _options: object) => ({})), remove: vi.fn(async (_id: number) => {}),
      goBack: vi.fn(async (_id: number) => {}), goForward: vi.fn(async (_id: number) => {}), reload: vi.fn(async (_id: number) => {}),
      sendMessage: vi.fn(async (_id: number, _message: any, _options?: object): Promise<any> => ({ ok: true, token: 'prepared' })),
    },
    tabCapture: { onStatusChanged: event(), getMediaStreamId: vi.fn(async ({ targetTabId }: { targetTabId: number }) => `stream-${targetTabId}`) },
    scripting: { executeScript: vi.fn(async (_options: any): Promise<any[]> => [{ frameId: 0, documentId, result: { ...geometry } }]) },
    webNavigation: {
      onBeforeNavigate: event(), onCommitted: event(), onErrorOccurred: event(), onCompleted: event(),
      getAllFrames: vi.fn(async () => [{ frameId: 0, documentId, parentFrameId: -1, documentLifecycle: 'active', url: 'https://example.com' }]),
    },
  };
  vi.stubGlobal('chrome', browser);
  const hooks = {
    state: vi.fn<(tabs: TabInfo[], activeTabId: number | undefined, generation: number, presentation?: Presentation) => void>(),
    error: vi.fn(), detached: vi.fn(), acquire: vi.fn(async (_tabId: number, _captureId: string, _streamId: string) => {}), release: vi.fn(async (_captureId: string) => {}),
  };
  const capture = new TabCapture(hooks);
  const current = () => hooks.state.mock.lastCall?.[3];
  const target = () => { const p = current()!; return { tabId: p.tabId, generation: p.generation, captureId: p.captureId, documentId: p.documentId }; };
  const add = (id: number, options: Record<string, unknown> = {}) => { const tab = { ...tabs.get(12), id, active: false, ...options }; tabs.set(id, tab); return tab; };
  const activate = (id: number) => { for (const tab of tabs.values()) tab.active = tab.id === id; browser.tabs.onActivated.emit({ tabId: id, windowId: tabs.get(id).windowId }); };
  const share = async () => { await capture.start(4); await capture.authorize(12); };
  const commands = () => browser.tabs.sendMessage.mock.calls.filter(([, message]) => message.operation === 'prepare');
  return { browser, tabs, geometry, hooks, capture, current, target, add, activate, share, commands, document: (value: string) => { documentId = value; } };
}

describe('TabCapture authorization and scoped control', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('releases current input without activation and ignores old release targets', async () => {
    const h = harness(); await h.share();
    const original = h.target();
    await h.capture.execute({ type: 'input.release', ...original });
    expect(h.browser.tabs.sendMessage.mock.calls.some(([, message]) => message.operation === 'release')).toBe(true);
    expect(h.commands()).toHaveLength(0);
    h.browser.tabs.onZoomChange.emit({ tabId: 12 }); await h.capture.refresh();
    h.browser.tabs.sendMessage.mockClear();
    await h.capture.execute({ type: 'input.release', ...original });
    expect(h.browser.tabs.sendMessage).not.toHaveBeenCalled();
    await h.capture.execute({ type: 'input.release', ...h.target() });
    await h.capture.execute({ type: 'input.release', ...h.target() });
    expect(h.commands()).toHaveLength(0);
    await h.capture.stop();
  });

  it('consumes the tab stream once and installs control only in its authorized active document', async () => {
    const h = harness(); h.add(13); await h.share();
    expect(h.browser.tabCapture.getMediaStreamId).toHaveBeenCalledExactlyOnceWith({ targetTabId: 12 });
    expect(h.hooks.acquire).toHaveBeenCalledExactlyOnceWith(12, h.current()!.captureId, 'stream-12');
    expect(h.browser.scripting.executeScript).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ target: { tabId: 12, frameIds: [0] }, world: 'ISOLATED', args: [h.current()!.captureId, h.current()!.generation] }));
    expect(h.current()).toMatchObject({ tabId: 12, documentId: 'document-one', ...h.geometry });
    expect(h.hooks.state.mock.lastCall![0].find(tab => tab.id === 13)).toMatchObject({ authorized: false, captureState: 'pending' });
    await h.capture.execute({ type: 'text', ...h.target(), text: '日本語 🐈' });
    expect(h.commands()[0]).toEqual([12, expect.objectContaining({ operation: 'prepare', captureId: h.current()!.captureId, generation: h.current()!.generation, command: expect.objectContaining({ text: '日本語 🐈' }) }), { documentId: 'document-one' }]);
    await h.capture.authorize(12); expect(h.browser.tabCapture.getMediaStreamId).toHaveBeenCalledTimes(1); await h.capture.stop();
  });

  it('refuses outside-window, inactive, incognito, internal, and store-page authorization', async () => {
    const h = harness(); await h.capture.start(4);
    for (const overrides of [{ windowId: 5 }, { active: false }, { incognito: true }, { url: 'chrome://settings' }, { url: 'https://chromewebstore.google.com/detail/test' }]) {
      const original = { ...h.tabs.get(12) }; Object.assign(h.tabs.get(12), overrides);
      await expect(h.capture.authorize(12)).rejects.toThrow('supported active tab'); h.tabs.set(12, original);
    }
    expect(h.browser.tabCapture.getMediaStreamId).not.toHaveBeenCalled(); expect(h.browser.scripting.executeScript).not.toHaveBeenCalled(); await h.capture.stop();
  });

  it('requires local authorization for a remotely opened tab and retains the shared window scope', async () => {
    const h = harness(); await h.share();
    await h.capture.execute({ type: 'tab.create', url: 'https://other.example.com' });
    expect(h.browser.tabs.create).toHaveBeenCalledWith({ windowId: 4, url: 'https://other.example.com', active: true });
    h.add(13); h.activate(13); await h.capture.refresh();
    expect(h.current()).toBeUndefined(); expect(h.hooks.state.mock.lastCall![0].find(tab => tab.id === 13)).toMatchObject({ authorized: false, captureState: 'pending' });
    expect(h.browser.tabCapture.getMediaStreamId).toHaveBeenCalledTimes(1);
    h.add(14, { windowId: 7 });
    await expect(h.capture.execute({ type: 'tab.activate', tabId: 14 })).rejects.toThrow('outside the shared session');
    await expect(h.capture.execute({ type: 'tab.close', tabId: 14 })).rejects.toThrow('outside the shared session');
    expect(h.browser.tabs.remove).not.toHaveBeenCalled(); await h.capture.stop();
  });

  it('limits a session to five authorized captures until the host releases one', async () => {
    const h = harness(); await h.share();
    for (let id = 13; id < 12 + MAX_CAPTURED_TABS; id++) { h.add(id); h.activate(id); await h.capture.authorize(id); }
    h.add(17); h.activate(17); await expect(h.capture.authorize(17)).rejects.toThrow('five captures');
    expect(h.hooks.acquire).toHaveBeenCalledTimes(5);
    const firstCapture = h.hooks.acquire.mock.calls[0][1]; await h.capture.release(12);
    expect(h.hooks.release).toHaveBeenCalledWith(firstCapture); await h.capture.authorize(17);
    expect(h.hooks.acquire).toHaveBeenCalledTimes(6); await h.capture.stop();
    expect(new Set(h.hooks.release.mock.calls.map(([id]) => id)).size).toBe(6);
  });

  it('rejects input from another document, capture, generation, or viewport', async () => {
    const h = harness(); await h.share(); const target = h.target();
    for (const overrides of [{ documentId: 'old-document' }, { captureId: 'another-capture' }, { generation: target.generation - 1 }]) {
      await expect(h.capture.execute({ type: 'text', ...target, ...overrides, text: 'stale' })).rejects.toThrow('shared page changed');
    }
    await expect(h.capture.execute({ type: 'pointer', ...target, event: 'down', x: 1281, y: 2 })).rejects.toThrow('outside the shared viewport');
    await expect(h.capture.execute({ type: 'navigate', ...target, url: 'javascript:alert(1)' })).rejects.toThrow('HTTP and HTTPS');
    expect(h.commands()).toHaveLength(0); await h.capture.stop();
  });

  it('invalidates immediately on navigation and admits input only for the new document', async () => {
    const h = harness(); await h.share(); const old = h.target();
    Object.assign(h.tabs.get(12), { status: 'loading', url: 'https://second.example.com' });
    h.browser.tabs.onUpdated.emit(12, { status: 'loading', url: 'https://second.example.com' }, h.tabs.get(12));
    expect(h.current()).toBeUndefined();
    await expect(h.capture.execute({ type: 'text', ...old, text: 'old' })).rejects.toThrow('shared page changed');
    h.tabs.get(12).status = 'complete'; h.document('document-two'); await h.capture.refresh();
    expect(h.current()!.generation).toBeGreaterThan(old.generation); expect(h.current()!.documentId).toBe('document-two');
    await h.capture.execute({ type: 'text', ...h.target(), text: 'new' });
    expect(h.commands()).toHaveLength(1); expect(h.commands()[0][2]).toEqual({ documentId: 'document-two' });
    expect(h.browser.tabCapture.getMediaStreamId).toHaveBeenCalledTimes(1); await h.capture.stop();
  });

  it('keeps video and root control available while an embedded document loads', async () => {
    const h = harness(); await h.share(); const original = h.current();
    Object.assign(h.tabs.get(12), { status: 'loading' });
    h.browser.webNavigation.onBeforeNavigate.emit({ tabId: 12, frameId: 9 });
    h.browser.tabs.onUpdated.emit(12, { status: 'loading' }, h.tabs.get(12));
    await h.capture.refresh(); expect(h.current()).toBe(original);
    await h.capture.execute({ type: 'text', ...h.target(), text: 'still usable' });
    h.browser.webNavigation.onBeforeNavigate.emit({ tabId: 12, frameId: 0 });
    expect(h.current()).toBeUndefined(); await h.capture.stop();
  });

  it('rejects a pending action if control is withdrawn and restored while resolving its tab', async () => {
    const h = harness(); await h.share(); const waiting = deferred<any>();
    h.browser.tabs.get.mockReturnValueOnce(waiting.promise);
    const operation = h.capture.execute({ type: 'text', ...h.target(), text: 'stale' });
    await h.capture.setControl(false); await h.capture.setControl(true); waiting.resolve(h.tabs.get(12));
    await expect(operation).rejects.toThrow('outside'); expect(h.commands()).toHaveLength(0); await h.capture.stop();
  });

  it('authenticates geometry reports and blocks old coordinates immediately on resize and zoom', async () => {
    const h = harness(); await h.share(); const old = h.target();
    const message = { captureId: old.captureId, generation: old.generation, geometry: { viewportWidth: 800 } };
    h.capture.geometry(message, { tab: h.tabs.get(12), documentId: 'wrong' }); expect(h.target()).toEqual(old);
    h.geometry.viewportWidth = 800; h.capture.geometry(message, { tab: h.tabs.get(12), documentId: old.documentId });
    expect(h.current()).toBeUndefined();
    await expect(h.capture.execute({ type: 'text', ...old, text: 'old' })).rejects.toThrow('shared page changed');
    await h.capture.refresh(); const resized = h.target(); expect(resized.generation).toBeGreaterThan(old.generation);
    h.browser.tabs.onZoomChange.emit({ tabId: 12, newZoomFactor: 1.25 }); expect(h.current()).toBeUndefined();
    await expect(h.capture.execute({ type: 'text', ...resized, text: 'old' })).rejects.toThrow('shared page changed'); await h.capture.stop();
  });

  it('releases input before pause/control revocation and rejects subsequent commands', async () => {
    const h = harness(); await h.share(); const old = h.target();
    await h.capture.setControl(false);
    expect(h.browser.tabs.sendMessage).toHaveBeenCalledWith(12, { target: 'ghostpair.dom', operation: 'release', captureId: old.captureId, generation: old.generation }, { documentId: old.documentId });
    await expect(h.capture.execute({ type: 'text', ...old, text: 'blocked' })).rejects.toThrow('unavailable');
    await h.capture.setControl(true); await h.capture.setPaused(true); expect(h.current()).toBeUndefined();
    await expect(h.capture.execute({ type: 'tab.create', url: 'https://example.com' })).rejects.toThrow('unavailable');
    await h.capture.setPaused(false); expect(h.current()!.generation).toBeGreaterThan(old.generation); await h.capture.stop();
  });

  it('releases native-cancelled capture and does not reacquire it on later tab updates', async () => {
    const h = harness(); await h.share(); const original = h.target();
    h.browser.tabCapture.onStatusChanged.emit({ tabId: 12, status: 'stopped' }); expect(h.current()).toBeUndefined(); await settled();
    expect(h.hooks.release).toHaveBeenCalledWith(original.captureId);
    h.browser.tabs.onUpdated.emit(12, { title: 'Changed title' }, h.tabs.get(12)); await vi.advanceTimersByTimeAsync(150);
    expect(h.current()).toBeUndefined(); expect(h.hooks.state.mock.lastCall![0][0]).toMatchObject({ authorized: false, captureState: 'pending' });
    expect(h.browser.tabCapture.getMediaStreamId).toHaveBeenCalledTimes(1); expect(h.hooks.detached).toHaveBeenCalledOnce();
    await h.capture.authorize(12); expect(h.current()!.captureId).not.toBe(original.captureId); await h.capture.stop();
  });

  it('disposes a capture when its tab leaves the consented window', async () => {
    const h = harness(); await h.share(); const old = h.target();
    h.tabs.get(12).windowId = 7; h.browser.tabs.onDetached.emit(12, { oldWindowId: 4 }); await settled();
    expect(h.current()).toBeUndefined(); expect(h.hooks.release).toHaveBeenCalledWith(old.captureId);
    await expect(h.capture.execute({ type: 'tab.close', tabId: 12 })).rejects.toThrow('outside the shared session'); await h.capture.stop();
  });

  it('does not consume an expired startup after Stop while the stream id is pending', async () => {
    const h = harness(); await h.capture.start(4); const stream = deferred<string>(); h.browser.tabCapture.getMediaStreamId.mockReturnValueOnce(stream.promise);
    const authorization = h.capture.authorize(12); await settled(); await h.capture.stop();
    stream.resolve('stale-stream'); await expect(authorization).rejects.toThrow('canceled');
    expect(h.hooks.acquire).not.toHaveBeenCalled(); expect(h.current()).toBeUndefined();
  });

  it('releases a source acquired after Stop and cannot publish its document', async () => {
    const h = harness(); await h.capture.start(4); const acquired = deferred<void>(); h.hooks.acquire.mockReturnValueOnce(acquired.promise);
    const authorization = h.capture.authorize(12); await settled(); const captureId = h.hooks.acquire.mock.calls[0][1];
    await h.capture.stop(); acquired.resolve(); await authorization;
    expect(h.hooks.release).toHaveBeenCalledExactlyOnceWith(captureId); expect(h.browser.scripting.executeScript).not.toHaveBeenCalled(); expect(h.current()).toBeUndefined();
  });

  it('cannot publish an injection result that completes after navigation or Stop', async () => {
    const h = harness(); await h.capture.start(4); const injected = deferred<any[]>(); h.browser.scripting.executeScript.mockReturnValueOnce(injected.promise);
    const authorization = h.capture.authorize(12); await settled();
    h.browser.tabs.onUpdated.emit(12, { status: 'loading' }, h.tabs.get(12)); await h.capture.stop();
    injected.resolve([{ documentId: 'old-document', result: h.geometry }]); await authorization;
    expect(h.hooks.state.mock.calls.every(([, , , presentation]) => !presentation)).toBe(true);
    expect(h.current()).toBeUndefined(); expect(h.hooks.release).toHaveBeenCalledOnce();
  });

  it('rechecks a tab that leaves the shared window during capture acquisition', async () => {
    const h = harness(); await h.capture.start(4); const acquired = deferred<void>(); h.hooks.acquire.mockReturnValueOnce(acquired.promise);
    const authorization = h.capture.authorize(12); await settled(); const captureId = h.hooks.acquire.mock.calls[0][1];
    h.tabs.get(12).windowId = 7; h.browser.tabs.onDetached.emit(12, { oldWindowId: 4 });
    acquired.resolve(); await authorization.catch(() => undefined);
    expect(h.hooks.release).toHaveBeenCalledWith(captureId); expect(h.current()).toBeUndefined(); await h.capture.stop();
  });

  it('cannot publish a native capture canceled before acquisition completes', async () => {
    const h = harness(); await h.capture.start(4); const acquired = deferred<void>(); h.hooks.acquire.mockReturnValueOnce(acquired.promise);
    const authorization = h.capture.authorize(12); await settled();
    h.browser.tabCapture.onStatusChanged.emit({ tabId: 12, status: 'stopped' });
    expect(h.hooks.detached).toHaveBeenCalledOnce(); acquired.resolve();
    await expect(authorization).rejects.toThrow('canceled');
    expect(h.hooks.release).toHaveBeenCalled(); expect(h.current()).toBeUndefined();
    expect(h.browser.scripting.executeScript).not.toHaveBeenCalled(); await h.capture.stop();
  });

  it('does not publish a stale injection error after the session was stopped', async () => {
    const h = harness(); await h.capture.start(4); const injected = deferred<any[]>(); h.browser.scripting.executeScript.mockReturnValueOnce(injected.promise);
    const authorization = h.capture.authorize(12); await settled(); await h.capture.stop();
    injected.reject(new Error('The old document was removed')); await authorization;
    expect(h.hooks.error).not.toHaveBeenCalled(); expect(h.current()).toBeUndefined();
  });
});
