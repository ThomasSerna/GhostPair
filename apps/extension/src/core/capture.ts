import { ControlCommandSchema, isSupportedUrl, type ControlCommand, type FrameMeta, type TabInfo } from '@ghostpair/protocol';

export interface CapturedFrame { data: string; meta: FrameMeta }
interface ScreencastEvent { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number; offsetTop: number; pageScaleFactor: number; timestamp?: number } }
interface CaptureHooks {
  frame: (frame: CapturedFrame) => void;
  state: (tabs: TabInfo[], activeTabId: number | undefined, generation: number) => void;
  error: (message: string) => void;
  detached: () => void;
}

/** JPEG dimensions are independent from viewport DIP dimensions when CDP downsizes. */
export function jpegDimensions(data: string): { width: number; height: number } | undefined {
  let raw: string;
  try { raw = atob(data); } catch { return; }
  if (raw.charCodeAt(0) !== 255 || raw.charCodeAt(1) !== 216) return;
  let i = 2;
  while (i + 8 < raw.length) {
    if (raw.charCodeAt(i++) !== 255) return;
    while (raw.charCodeAt(i) === 255) i++;
    const marker = raw.charCodeAt(i++);
    if (marker === 217 || marker === 218) return;
    const size = (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1);
    if (size < 2 || i + size > raw.length) return;
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (size < 8) return;
      const height = (raw.charCodeAt(i + 3) << 8) | raw.charCodeAt(i + 4);
      const width = (raw.charCodeAt(i + 5) << 8) | raw.charCodeAt(i + 6);
      return width && height ? { width, height } : undefined;
    }
    i += size;
  }
}

export class BrowserCapture {
  private windowId?: number;
  private tabId?: number;
  private attached?: number;
  private generation = 0;
  private frameId = 0;
  private paused = true;
  private control = true;
  private ready = false;
  private since = 0;
  private geometry = '';
  private lastFrame = 0;
  private quality = 80;
  private intervalMs = 1000 / 15;
  private tabs: TabInfo[] = [];
  private serial: Promise<void> = Promise.resolve();
  private inputQueue: Promise<void> = Promise.resolve();
  private inputPending = 0;
  private frameInFlight = false;
  private viewport?: { width: number; height: number };
  private heldKeys = new Map<string, Extract<ControlCommand, { type: 'key' }>>();
  private mouse = new Map<'left' | 'middle' | 'right', { tabId: number; x: number; y: number }>();

  constructor(private readonly hooks: CaptureHooks) {
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId !== this.attached || source.sessionId) return;
      if (method === 'Page.screencastFrame') void this.frame(params as ScreencastEvent, source.tabId!).catch(() => undefined);
      if (method === 'Page.frameStartedLoading' || method === 'Page.frameResized') this.invalidate();
    });
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (source.tabId !== this.attached) return;
      this.attached = undefined;
      if (reason === 'target_closed') {
        this.invalidate();
        this.requestRefresh();
        return;
      }
      this.paused = true;
      this.invalidate();
      this.hooks.detached();
    });
    chrome.tabs.onActivated.addListener(info => { if (info.windowId === this.windowId) { this.invalidate(); this.requestRefresh(); } });
    chrome.tabs.onUpdated.addListener((id, change, tab) => {
      if (tab.windowId !== this.windowId) return;
      if (id === this.tabId && (change.status === 'loading' || change.url)) this.invalidate();
      if (change.status || change.url || change.title) this.requestRefresh();
    });
    chrome.tabs.onCreated.addListener(tab => { if (tab.windowId === this.windowId) this.requestRefresh(); });
    chrome.tabs.onRemoved.addListener((id, info) => { if (info.windowId === this.windowId) { if (id === this.tabId) this.invalidate(); this.requestRefresh(); } });
    chrome.tabs.onDetached.addListener((id, info) => { if (info.oldWindowId === this.windowId) { if (id === this.tabId) this.invalidate(); this.requestRefresh(); } });
    chrome.tabs.onAttached.addListener((_id, info) => { if (info.newWindowId === this.windowId) this.requestRefresh(); });
    chrome.tabs.onZoomChange.addListener(info => { if (info.tabId === this.tabId) this.invalidate(); });
    chrome.windows.onBoundsChanged.addListener(window => {
      if (window.id !== this.windowId || window.state !== 'minimized') return;
      this.paused = true;
      this.invalidate();
      this.hooks.error('La ventana se minimizó. Inicia otra sesión cuando vuelva a estar visible.');
      this.hooks.detached();
      void this.enqueue(() => this.detach()).catch(() => undefined);
    });
    chrome.windows.onRemoved.addListener(id => {
      if (id !== this.windowId) return;
      this.paused = true;
      this.invalidate();
      this.hooks.detached();
    });
  }

  async start(windowId: number): Promise<void> {
    this.windowId = windowId;
    this.paused = false;
    this.control = true;
    await this.refresh();
  }

  async stop(): Promise<void> {
    this.windowId = undefined;
    this.paused = true;
    this.invalidate();
    await this.inputQueue;
    await this.release();
    await this.enqueue(() => this.detach());
    this.tabs = [];
    this.tabId = undefined;
  }

  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
    this.invalidate();
    await this.inputQueue;
    await this.release();
    await this.refresh();
  }

  async setControl(enabled: boolean): Promise<void> {
    this.control = enabled;
    if (!enabled) { await this.inputQueue; await this.release(); }
  }

  async profile(congested: boolean): Promise<void> {
    const quality = congested ? 50 : 80;
    if (this.quality === quality) return;
    this.quality = quality;
    this.intervalMs = 1000 / (congested ? 8 : 15);
    await this.enqueue(async () => {
      if (this.attached === undefined || this.paused) return;
      await this.command(this.attached, 'Page.stopScreencast');
      await this.screencast(this.attached);
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.serial.then(task);
    this.serial = next.catch(error => this.hooks.error(error instanceof Error ? error.message : 'No se pudo capturar la página.'));
    return next;
  }

  private requestRefresh(): void { void this.refresh().catch(() => undefined); }

  private invalidate(): void {
    this.ready = false;
    this.viewport = undefined;
    this.generation++;
    this.since = Date.now() / 1000;
    this.geometry = '';
    this.lastFrame = 0;
    void this.release();
    this.hooks.state(this.tabs, this.tabId, this.generation);
  }

  async refresh(): Promise<void> {
    return this.enqueue(async () => {
      const windowId = this.windowId;
      if (windowId === undefined) return;
      const window = await chrome.windows.get(windowId);
      if (window.state === 'minimized' || window.incognito || window.type !== 'normal') throw new Error('Comparte una ventana normal visible.');
      const tabs = await chrome.tabs.query({ windowId });
      if (windowId !== this.windowId) return;
      this.tabs = tabs.filter(t => t.id !== undefined && !t.incognito).map(t => ({ id: t.id!, title: t.title ?? '', url: t.url ?? '', active: t.active, supported: isSupportedUrl(t.url ?? '') }));
      const active = tabs.find(t => t.active && !t.incognito);
      if (this.tabId !== active?.id) { this.tabId = active?.id; this.invalidate(); }
      this.hooks.state(this.tabs, this.tabId, this.generation);
      if (this.paused || active?.id === undefined || !isSupportedUrl(active.url ?? '')) { await this.detach(); return; }
      if (this.attached !== active.id) {
        await this.detach();
        await chrome.debugger.attach({ tabId: active.id }, '1.3');
        this.attached = active.id;
        if (this.windowId !== windowId || this.paused) { await this.detach(); return; }
        await this.command(active.id, 'Page.enable');
        await this.screencast(active.id);
      }
    });
  }

  private async screencast(tabId: number): Promise<void> {
    await this.command(tabId, 'Page.startScreencast', { format: 'jpeg', quality: this.quality, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  }

  private async detach(): Promise<void> {
    const tabId = this.attached;
    this.attached = undefined;
    this.ready = false;
    if (tabId === undefined) return;
    await this.release(tabId);
    try { await this.command(tabId, 'Page.stopScreencast'); } catch { /* target may have closed */ }
    try { await chrome.debugger.detach({ tabId }); } catch { /* already detached */ }
  }

  private async frame(frame: ScreencastEvent, tabId: number): Promise<void> {
    // ACK even skipped frames, or Chromium will stop producing the stream.
    void this.command(tabId, 'Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
    if (this.frameInFlight || this.paused || this.windowId === undefined || tabId !== this.tabId || tabId !== this.attached) return;
    this.frameInFlight = true;
    try {
    const meta = frame.metadata;
    if (meta.timestamp && meta.timestamp < this.since) return;
    const epoch = this.generation;
    const [tab, zoom] = await Promise.all([chrome.tabs.get(tabId), chrome.tabs.getZoom(tabId)]);
    if (this.paused || !tab || tab.windowId !== this.windowId || !tab.active || tab.incognito || !isSupportedUrl(tab.url ?? '') || epoch !== this.generation || !Number.isFinite(zoom) || zoom <= 0) return;
    const geometry = `${meta.deviceWidth}:${meta.deviceHeight}:${meta.offsetTop}:${meta.pageScaleFactor}:${zoom}`;
    if (this.geometry && this.geometry !== geometry) this.invalidate();
    this.geometry = geometry;
    if (Date.now() - this.lastFrame < this.intervalMs) return;
    const size = jpegDimensions(frame.data);
    if (!size || size.width > 1920 || size.height > 1920) return;
    this.ready = true;
    this.viewport = { width: meta.deviceWidth / zoom, height: meta.deviceHeight / zoom };
    this.lastFrame = Date.now();
    this.hooks.frame({ data: frame.data, meta: { frameId: ++this.frameId, tabId, generation: this.generation, ...size, viewportWidth: this.viewport.width, viewportHeight: this.viewport.height, offsetTop: (meta.offsetTop ?? 0) / zoom, pageScaleFactor: meta.pageScaleFactor || 1, timestamp: Date.now() } });
    } finally { this.frameInFlight = false; }
  }

  async execute(input: unknown): Promise<void> {
    const parsed = ControlCommandSchema.safeParse(input);
    if (!parsed.success) throw new Error('Orden no válida.');
    if (this.inputPending >= 128) throw new Error('Demasiadas órdenes pendientes.');
    this.inputPending++;
    const operation = this.inputQueue.then(() => this.executeCommand(parsed.data));
    this.inputQueue = operation.catch(() => undefined);
    try { await operation; } finally { this.inputPending--; }
  }

  private async executeCommand(command: ControlCommand): Promise<void> {
    if (this.windowId === undefined || this.paused || !this.control) throw new Error('El control remoto está detenido.');
    const windowId = this.windowId;
    if (command.type === 'tab.create') {
      if (!isSupportedUrl(command.url)) throw new Error('Solo se pueden abrir páginas HTTP o HTTPS.');
      await chrome.tabs.create({ windowId, url: command.url, active: true });
      await this.refresh(); return;
    }
    const tab = await chrome.tabs.get(command.tabId);
    if (this.windowId !== windowId || this.paused || !this.control || tab.windowId !== windowId || tab.incognito) throw new Error('La pestaña no pertenece a la ventana autorizada.');
    if (command.type === 'tab.activate') { await chrome.tabs.update(command.tabId, { active: true }); await this.refresh(); return; }
    if (command.type === 'tab.close') { await chrome.tabs.remove(command.tabId); await this.refresh(); return; }
    if (command.tabId !== this.attached || command.tabId !== this.tabId || command.generation !== this.generation || !this.ready || !tab.active || !isSupportedUrl(tab.url ?? '')) throw new Error('La página cambió. Espera una imagen actualizada.');
    if ((command.type === 'pointer' || command.type === 'wheel') && (!this.viewport || command.x > this.viewport.width || command.y > this.viewport.height)) throw new Error('Las coordenadas están fuera de la página.');
    switch (command.type) {
      case 'pointer':
        if (command.event === 'down') this.mouse.set(command.button, { tabId: tab.id!, x: command.x, y: command.y });
        else if (command.event === 'up') this.mouse.delete(command.button);
        else for (const value of this.mouse.values()) { value.x = command.x; value.y = command.y; }
        await this.command(tab.id!, 'Input.dispatchMouseEvent', { type: { move: 'mouseMoved', down: 'mousePressed', up: 'mouseReleased' }[command.event], x: command.x, y: command.y, button: command.event === 'move' && !command.buttons ? 'none' : command.button, buttons: command.buttons, clickCount: command.clickCount, modifiers: command.modifiers });
        break;
      case 'wheel': await this.command(tab.id!, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: command.x, y: command.y, deltaX: command.deltaX, deltaY: command.deltaY, modifiers: command.modifiers }); break;
      case 'key': {
        if (command.event === 'down') this.heldKeys.set(command.code, command); else this.heldKeys.delete(command.code);
        // Enter needs the character-bearing keyDown event for native textarea and
        // form behavior. Printable text is committed separately via insertText.
        const enter = command.event === 'down' && command.key === 'Enter' && (command.modifiers & 7) === 0;
        await this.command(tab.id!, 'Input.dispatchKeyEvent', { type: command.event === 'down' ? enter ? 'keyDown' : 'rawKeyDown' : 'keyUp', key: command.key, code: command.code, windowsVirtualKeyCode: command.keyCode, nativeVirtualKeyCode: command.keyCode, modifiers: command.modifiers, autoRepeat: command.repeat, ...(enter ? { text: '\r', unmodifiedText: '\r' } : {}) });
        break;
      }
      case 'text':
        if (new TextEncoder().encode(command.text).byteLength > 256 * 1024) throw new Error('El texto supera el límite de 256 KiB.');
        await this.command(tab.id!, 'Input.insertText', { text: command.text }); break;
      case 'navigate':
        if (!isSupportedUrl(command.url)) throw new Error('Solo se permiten páginas HTTP o HTTPS.');
        this.invalidate(); await chrome.tabs.update(tab.id!, { url: command.url }); break;
      case 'history': this.invalidate(); if (command.direction === 'back') await chrome.tabs.goBack(tab.id!); else await chrome.tabs.goForward(tab.id!); break;
      case 'reload': this.invalidate(); await chrome.tabs.reload(tab.id!); break;
    }
  }

  private command(tabId: number, method: string, params?: Record<string, unknown>): Promise<object | undefined> { return chrome.debugger.sendCommand({ tabId }, method, params); }

  private async release(tabId = this.attached): Promise<void> {
    const keys = [...this.heldKeys.values()]; const buttons = [...this.mouse.entries()];
    this.heldKeys.clear(); this.mouse.clear();
    await Promise.allSettled(keys.map(key => this.command(key.tabId ?? tabId!, 'Input.dispatchKeyEvent', { type: 'keyUp', key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode })));
    for (const [button, mouse] of buttons) await this.command(mouse.tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: mouse.x, y: mouse.y, button, buttons: 0, clickCount: 1 }).catch(() => undefined);
  }
}
