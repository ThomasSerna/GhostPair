import { ControlCommandSchema, PresentationSchema, isSupportedUrl, type ControlConfiguration, type Presentation, type TabInfo } from '@ghostpair/protocol';
import { installDomControl } from './dom-control';
import { FrameControl } from './frame-control';

interface Hooks {
  state: (tabs: TabInfo[], activeTabId: number | undefined, generation: number, presentation?: Presentation) => void;
  error: (message: string) => void;
  detached: () => void;
  acquire: (tabId: number, captureId: string, streamId: string) => Promise<void>;
  release: (captureId: string) => Promise<void>;
}
export const MAX_CAPTURED_TABS = 5;

export class TabCapture {
  private windowId?: number;
  private activeTabId?: number;
  private generation = 0;
  private epoch = 0;
  private inputRevision = 0;
  private paused = false;
  private control = true;
  private configuring = false;
  private configuration: ControlConfiguration = { mode: 'visual', revision: 0, preferences: { notices: false, text: { duration: 'persistent', seconds: 10 }, other: { duration: 'persistent', seconds: 3 }, accentColor: '#7871e8' } };
  private tabs: TabInfo[] = [];
  private sources = new Map<number, string>();
  private acquiring = new Map<number, { canceled: boolean }>();
  private presentation?: Presentation;
  private timer?: ReturnType<typeof setTimeout>;
  private serial: Promise<void> = Promise.resolve();
  private frameControl = new FrameControl(p => this.presentation === p && this.windowId !== undefined && this.activeTabId === p.tabId && this.sources.get(p.tabId) === p.captureId && !this.paused && this.control && !this.configuring);

  constructor(private hooks: Hooks) {
    chrome.webNavigation.onBeforeNavigate.addListener(info => {
      if (info.tabId === this.activeTabId && info.frameId === 0) { this.invalidate(); this.schedule(); }
    });
    chrome.tabs.onActivated.addListener(info => { if (info.windowId === this.windowId) { this.invalidate(); this.schedule(); } });
    chrome.tabs.onUpdated.addListener((id, change, tab) => {
      if (tab.windowId !== this.windowId) return;
      // A child frame can set the tab's status to loading without changing its video document.
      if (id === this.activeTabId && change.url) this.invalidate();
      if (change.status || change.url || change.title) this.schedule();
    });
    chrome.tabs.onCreated.addListener(tab => { if (tab.windowId === this.windowId) this.schedule(); });
    chrome.tabs.onRemoved.addListener((id, info) => { if (info.windowId === this.windowId) void this.release(id); });
    chrome.tabs.onDetached.addListener((id, info) => { if (info.oldWindowId === this.windowId) void this.release(id); });
    chrome.tabs.onAttached.addListener((_id, info) => { if (info.newWindowId === this.windowId) this.schedule(); });
    chrome.tabs.onZoomChange.addListener(info => { if (info.tabId === this.activeTabId) { this.invalidate(true); this.schedule(); } });
    chrome.windows.onBoundsChanged.addListener(window => {
      if (window.id !== this.windowId) return;
      this.invalidate(window.state !== 'minimized');
      if (window.state === 'minimized') { this.hooks.error('The shared window was minimized. Start a new session when it is visible.'); this.hooks.detached(); }
      else this.schedule();
    });
    chrome.tabCapture.onStatusChanged.addListener(info => {
      if (!['stopped', 'error'].includes(info.status) || !this.sources.has(info.tabId) && !this.acquiring.has(info.tabId)) return;
      const pending = this.acquiring.get(info.tabId); if (pending) pending.canceled = true;
      this.invalidate(); void this.release(info.tabId);
      // A native cancellation ends the session, including clipboard synchronization.
      this.hooks.detached();
    });
  }
  async start(windowId: number) {
    ++this.epoch; this.windowId = windowId; this.control = true; this.paused = false;
    this.invalidate(); await this.refresh();
  }
  async authorize(tabId: number) {
    const epoch = this.epoch;
    const tab = await chrome.tabs.get(tabId);
    if (this.windowId === undefined || tab.windowId !== this.windowId || !tab.active || tab.incognito || !isSupportedUrl(tab.url ?? '')) throw new Error('Invoke GhostPair on a supported active tab in the shared window.');
    if (this.sources.has(tabId)) { this.invalidate(); await this.refresh(); return; }
    if (this.sources.size >= MAX_CAPTURED_TABS) throw new Error('Release a shared tab before adding another. A session supports five captures.');
    const captureId = crypto.randomUUID();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    if (epoch !== this.epoch) throw new Error('Sharing was canceled.');
    const pending = { canceled: false }; this.acquiring.set(tabId, pending);
    try {
      await this.hooks.acquire(tabId, captureId, streamId);
      if (epoch !== this.epoch) { await this.hooks.release(captureId); return; }
      const currentTab = await chrome.tabs.get(tabId).catch(() => undefined);
      if (pending.canceled) { await this.hooks.release(captureId); throw new Error('Browser capture was canceled. Start a new session.'); }
      if (epoch !== this.epoch || !currentTab || currentTab.windowId !== this.windowId || currentTab.incognito) { await this.hooks.release(captureId); throw new Error('The tab left the shared window.'); }
      this.sources.set(tabId, captureId); this.invalidate(); await this.refresh();
    } finally { if (this.acquiring.get(tabId) === pending) this.acquiring.delete(tabId); }
  }
  async release(tabId: number) {
    const captureId = this.sources.get(tabId); this.sources.delete(tabId);
    if (tabId === this.activeTabId) this.invalidate();
    if (captureId) {
      await Promise.allSettled([this.hooks.release(captureId), chrome.tabs.sendMessage(tabId, { target: 'ghostpair.dom', operation: 'dispose', captureId })]);
    }
    this.schedule();
  }
  async stop() {
    ++this.epoch; this.windowId = undefined; clearTimeout(this.timer);
    this.invalidate();
    const sources = [...this.sources]; this.sources.clear();
    await Promise.allSettled(sources.flatMap(([tabId, captureId]) => [this.hooks.release(captureId), chrome.tabs.sendMessage(tabId, { target: 'ghostpair.dom', operation: 'dispose', captureId })]));
    this.tabs = []; this.activeTabId = undefined; this.publish();
  }
  async setPaused(paused: boolean) { this.paused = paused; this.invalidate(); await this.refresh(); }
  async setControl(enabled: boolean) { this.control = enabled; if (!enabled) { this.invalidate(); await this.refresh(); } }
  async configure(configuration: ControlConfiguration) {
    this.configuring = true; ++this.inputRevision;
    this.configuration = configuration;
    try { await this.frameControl.configure(configuration); }
    catch (error) { this.invalidate(); throw error; }
    finally { this.configuring = false; }
  }
  private releaseInput() {
    ++this.inputRevision;
    return this.frameControl.release();
  }
  private invalidate(preserveVisual = false) {
    ++this.inputRevision;
    if (preserveVisual) void this.frameControl.release(); else void this.frameControl.clear();
    this.presentation = undefined; ++this.generation; this.publish();
  }
  private publish() { this.hooks.state(this.tabs, this.activeTabId, this.generation, this.presentation); }
  private schedule() {
    clearTimeout(this.timer);
    if (this.windowId !== undefined) this.timer = setTimeout(() => { void this.refresh().catch(error => this.hooks.error(error.message)); }, 150);
  }
  geometry(message: Record<string, any>, sender: chrome.runtime.MessageSender) {
    const current = this.presentation;
    if (!current || sender.tab?.id !== current.tabId || sender.documentId !== current.documentId || message.captureId !== current.captureId || message.generation !== current.generation) return;
    const parsed = PresentationSchema.safeParse({ ...current, ...message.geometry });
    if (!parsed.success || JSON.stringify(parsed.data) === JSON.stringify(current)) return;
    this.invalidate(true); this.schedule();
  }
  refresh(): Promise<void> {
    const work = this.serial.then(() => this.refreshNow());
    this.serial = work.catch(() => undefined); return work;
  }
  private async refreshNow() {
    const windowId = this.windowId, epoch = this.epoch;
    if (windowId === undefined) return;
    const tabs = await chrome.tabs.query({ windowId });
    if (epoch !== this.epoch) return;
    const active = tabs.find(tab => tab.active);
    if (this.activeTabId !== active?.id) { this.activeTabId = active?.id; this.invalidate(); }
    this.tabs = tabs.filter(tab => tab.id !== undefined && !tab.incognito).map(tab => ({ id: tab.id!, title: tab.title ?? '', url: tab.url ?? '', active: tab.active, supported: isSupportedUrl(tab.url ?? ''), authorized: this.sources.has(tab.id!), captureState: this.sources.has(tab.id!) ? isSupportedUrl(tab.url ?? '') ? 'ready' : 'unavailable' : 'pending' }));
    const captureId = active?.id === undefined ? undefined : this.sources.get(active.id);
    if (this.paused || !captureId || !active?.id || !isSupportedUrl(active.url ?? '')) { if (this.presentation) this.invalidate(); this.publish(); return; }
    if (this.presentation?.tabId === active.id) { this.publish(); return; }
    if (active.status === 'loading') { this.publish(); return; }
    const generation = this.generation;
    try {
      const injection = (await chrome.scripting.executeScript({ target: { tabId: active.id, frameIds: [0] }, world: 'ISOLATED', func: installDomControl, args: [captureId, generation, true, this.configuration] }))[0];
      if (epoch !== this.epoch || generation !== this.generation || !injection?.documentId || !injection.result || this.sources.get(active.id) !== captureId) return;
      const now = await chrome.tabs.get(active.id);
      if (epoch !== this.epoch || generation !== this.generation || !now.active || now.windowId !== windowId || now.url !== active.url || now.status === 'loading') return;
      this.presentation = PresentationSchema.parse({ ...injection.result, captureId, tabId: active.id, documentId: injection.documentId, generation });
      const presentation = this.presentation;
      // A slow child must not delay publication of the already captured top document.
      void this.frameControl.bind(presentation).catch(() => { if (this.presentation === presentation) this.hooks.error('Embedded page discovery is unavailable. Check the extension navigation permission.'); });
    } catch (error) {
      if (epoch !== this.epoch || generation !== this.generation) return;
      this.presentation = undefined;
      const tab = this.tabs.find(t => t.id === active.id); if (tab) tab.captureState = 'unavailable';
      this.hooks.error(`Page control could not be installed. Check site permissions in the extension menu. ${error instanceof Error ? error.message : ''}`.trim());
    }
    this.publish();
  }
  async execute(value: unknown) {
    const command = ControlCommandSchema.parse(value);
    if (command.controlRevision !== this.configuration.revision) {
      if (command.type === 'input.release') return;
      throw new Error('The interaction mode changed. Try the action again.');
    }
    if (command.type === 'input.release') {
      const p = this.presentation;
      if (p && command.tabId === p.tabId && command.captureId === p.captureId && command.documentId === p.documentId && command.generation === p.generation) await this.releaseInput();
      return;
    }
    const inputRevision = this.inputRevision;
    if (this.windowId === undefined || this.paused || !this.control || this.configuring) throw new Error('Remote control is unavailable.');
    if (command.type === 'tab.create') {
      if (!isSupportedUrl(command.url)) throw new Error('Only HTTP and HTTPS pages can be opened.');
      await chrome.tabs.create({ windowId: this.windowId, url: command.url, active: true }); return;
    }
    const epoch = this.epoch;
    const tab = await chrome.tabs.get(command.tabId);
    if (epoch !== this.epoch || inputRevision !== this.inputRevision || this.paused || !this.control || tab.windowId !== this.windowId || tab.incognito) throw new Error('The target is outside the shared session.');
    if (command.type === 'tab.activate') { this.invalidate(); await chrome.tabs.update(tab.id!, { active: true }); return; }
    if (command.type === 'tab.close') { await chrome.tabs.remove(tab.id!); return; }
    const current = this.presentation;
    if (!current || !tab.active || !isSupportedUrl(tab.url ?? '') || command.tabId !== current.tabId || command.generation !== current.generation || !('captureId' in command) || command.captureId !== current.captureId || !('documentId' in command) || command.documentId !== current.documentId) throw new Error('The shared page changed. Wait for its current video.');
    if (command.type === 'navigate') {
      if (!isSupportedUrl(command.url)) throw new Error('Only HTTP and HTTPS navigation is supported.');
      this.invalidate(); await chrome.tabs.update(tab.id!, { url: command.url }); return;
    }
    if (command.type === 'reload') { this.invalidate(); await chrome.tabs.reload(tab.id!); return; }
    if (command.type === 'history') { this.invalidate(); await (command.direction === 'back' ? chrome.tabs.goBack(tab.id!) : chrome.tabs.goForward(tab.id!)); this.schedule(); return; }
    if ('x' in command && (command.x > current.viewportWidth || command.y > current.viewportHeight)) throw new Error('Pointer coordinates are outside the shared viewport.');
    await this.frameControl.execute(command);
  }
}
