import { isSupportedUrl, type ControlCommand, type ControlConfiguration, type Presentation, type VisualActivity, type VisualCategory } from '@ghostpair/protocol';
import { installDomControl } from './dom-control';

type Input = Extract<ControlCommand, { type: 'pointer' | 'wheel' | 'key' | 'text' }>;
type Frame = { frameId: number; documentId: string; parentFrameId: number; parentDocumentId?: string };
type Step = { frame: Frame; token: string; index?: number };
type Owner = { frame: Frame; path: string };
const changed = () => new Error('The embedded page changed. Try the action again.');

/** Browser identities authorize documents; WindowProxy indices only locate them. */
export class FrameControl {
  private presentation?: Presentation;
  private frames = new Map<string, Frame>();
  private failures = new Map<string, string>();
  private blocked = new Set<number>();
  private revision = 0;
  private queue: Promise<void> = Promise.resolve();
  private syncing?: Promise<void>;
  private pointer?: Owner;
  private canceledPointer = false;
  private keys = new Map<string, Owner>();
  private canceledKeys = new Set<string>();
  private drag?: { token: string; frame: Frame; started: number };
  private configuration: ControlConfiguration = { mode: 'visual', revision: 0, preferences: { notices: false, clickAnimations: true, text: { duration: 'persistent', seconds: 10 }, other: { duration: 'persistent', seconds: 3 }, accentColor: '#7871e8' } };
  private expiry: Partial<Record<VisualCategory, ReturnType<typeof setTimeout>>> = {};
  private lastActivity: Partial<Record<VisualCategory, number>> = {};
  private resetExpiry() {
    for (const timer of Object.values(this.expiry)) clearTimeout(timer);
    this.expiry = {}; this.lastActivity = {};
  }

  async configure(configuration: ControlConfiguration) {
    const reset = configuration.revision !== this.configuration.revision || configuration.mode !== this.configuration.mode;
    if (reset) { await this.release(); this.resetExpiry(); }
    this.configuration = configuration;
    const p = this.presentation;
    if (p) {
      const results = await Promise.allSettled([...this.frames.values()].map(frame => this.message(p, frame, 'configure', { configuration })));
      if (results.some(result => result.status === 'rejected' || !result.value?.ok)) throw new Error('Could not configure the shared page. Try again.');
    }
    this.scheduleExpiry();
  }

  private scheduleExpiry() {
    for (const category of ['text', 'other'] as const) {
      clearTimeout(this.expiry[category]);
      const last = this.lastActivity[category], preference = this.configuration.preferences[category];
      if (last === undefined || this.configuration.mode !== 'visual' || preference.duration !== 'temporary') continue;
      const p = this.presentation, configuration = this.configuration;
      this.expiry[category] = setTimeout(() => {
        const work = this.queue.then(async () => {
          if (!p || this.presentation !== p || this.configuration !== configuration || this.lastActivity[category] !== last) return;
          delete this.lastActivity[category];
          const results = await Promise.allSettled([...this.frames.values()].map(frame => this.message(p, frame, 'visual.clear', { category })));
          if (results.some(result => result.status === 'fulfilled' && result.value?.protected)) this.activity({ category, kind: 'focus' });
        });
        this.queue = work.catch(() => undefined);
      }, Math.max(0, preference.seconds * 1000 - (Date.now() - last)));
    }
  }
  private activity(activity?: VisualActivity) {
    if (!activity || this.configuration.mode !== 'visual') return;
    this.lastActivity[activity.category] = Date.now(); this.scheduleExpiry();
    const p = this.presentation, root = p && this.frames.get(p.documentId);
    if (p && root && this.configuration.preferences.notices) void this.message(p, root, 'visual.notice', { kind: activity.kind }).catch(() => undefined);
  }

  constructor(private usable: (presentation: Presentation) => boolean) {
    chrome.webNavigation.onBeforeNavigate.addListener(event => {
      if (event.tabId !== this.presentation?.tabId || event.frameId === 0) return;
      this.blocked.add(event.frameId); this.retire(event.frameId);
    });
    const committed = (event: { tabId: number; frameId: number }) => {
      if (event.tabId !== this.presentation?.tabId || event.frameId === 0) return;
      this.blocked.delete(event.frameId);
      void this.sync().catch(() => undefined);
    };
    chrome.webNavigation.onCommitted.addListener(committed);
    chrome.webNavigation.onErrorOccurred.addListener(committed);
    chrome.webNavigation.onCompleted.addListener(committed);
  }

  async bind(presentation: Presentation) {
    const previous = this.presentation;
    this.presentation = presentation; this.blocked.clear(); this.failures.clear();
    this.frames.set(presentation.documentId, { frameId: 0, documentId: presentation.documentId, parentFrameId: -1 });
    if (previous && previous.generation !== presentation.generation) {
      await Promise.all([...this.frames.values()].filter(frame => frame.frameId !== 0).map(async frame => {
        try { await chrome.scripting.executeScript({ target: { tabId: presentation.tabId, documentIds: [frame.documentId] }, world: 'ISOLATED', func: installDomControl, args: [presentation.captureId, presentation.generation, false, this.configuration] }); }
        catch { this.frames.delete(frame.documentId); }
      }));
    }
    await this.sync();
  }

  release() {
    ++this.revision;
    this.drag = undefined;
    this.pointer = undefined; this.canceledPointer = true;
    for (const code of this.keys.keys()) this.canceledKeys.add(code);
    this.keys.clear();
    const p = this.presentation;
    return p ? Promise.allSettled([...this.frames.values()].map(frame => this.message(p, frame, 'release'))).then(() => undefined) : Promise.resolve();
  }

  clear() {
    this.resetExpiry();
    const p = this.presentation, frames = [...this.frames.values()];
    void this.release(); this.presentation = undefined; this.frames.clear(); this.failures.clear(); this.blocked.clear();
    // Generation-scoped disposal cannot remove a newer installation in the same document.
    return p ? Promise.allSettled(frames.map(frame => this.message(p, frame, 'dispose'))).then(() => undefined) : Promise.resolve();
  }

  async localVisual(message: Record<string, any>, sender: chrome.runtime.MessageSender) {
    const p = this.presentation, revision = this.revision;
    const frame = sender.documentId && this.frames.get(sender.documentId);
    if (!p || !frame || sender.tab?.id !== p.tabId || sender.frameId !== frame.frameId || message.captureId !== p.captureId || message.generation !== p.generation || message.controlRevision !== this.configuration.revision || this.configuration.mode !== 'visual') throw changed();
    this.check(p, revision);
    if (message.operation === 'activity') {
      const activity = message.activity;
      if (activity?.category !== 'text' || !['focus', 'typing'].includes(activity.kind)) throw new Error('Invalid local activity.');
      this.activity(activity); return;
    }
    if (typeof message.token !== 'string' || !/^[a-f0-9-]{36}$/.test(message.token)) throw new Error('Invalid drag token.');
    if (message.operation === 'drag.start') {
      if (this.drag) void this.message(p, this.drag.frame, 'visual.drag.finish', { token: this.drag.token }).catch(() => undefined);
      this.drag = { token: message.token, frame, started: Date.now() }; return;
    }
    if (message.operation !== 'drag.drop' || typeof message.targetId !== 'string' || !Number.isSafeInteger(message.revision) || !Number.isSafeInteger(message.offset) || typeof message.copy !== 'boolean') throw new Error('Invalid drag destination.');
    const drag = this.drag;
    if (!drag || drag.token !== message.token || Date.now() - drag.started > 30000 || !this.frames.has(drag.frame.documentId)) throw changed();
    this.drag = undefined; // Single-use transfer, including failed drops.
    const work = this.queue.then(async () => {
      try {
        const source = await this.request(p, revision, drag.frame, 'visual.drag.read', { token: drag.token });
        if (typeof source.text !== 'string' || new TextEncoder().encode(source.text).length > 256 * 1024) throw new Error('Invalid dragged text.');
        const sameField = frame.documentId === drag.frame.documentId && source.sourceId === message.targetId;
        await this.request(p, revision, frame, sameField && !message.copy ? 'visual.drag.move' : 'visual.drag.insert', {
          token: drag.token, targetId: message.targetId, revision: message.revision, offset: message.offset, text: source.text,
        });
        if (!message.copy && !sameField) await this.request(p, revision, drag.frame, 'visual.drag.delete', { token: drag.token });
        this.activity({ category: 'text', kind: 'typing' });
      } finally {
        if (this.presentation === p) await this.message(p, drag.frame, 'visual.drag.finish', { token: drag.token }).catch(() => undefined);
      }
    });
    this.queue = work.catch(() => undefined); await work;
  }

  private retire(frameId: number) {
    ++this.revision;
    const removed = new Set([frameId]);
    for (let previous = -1; previous !== removed.size;) {
      previous = removed.size;
      for (const frame of this.frames.values()) if (removed.has(frame.parentFrameId)) removed.add(frame.frameId);
    }
    const p = this.presentation;
    for (const [id, frame] of this.frames) if (removed.has(frame.frameId)) {
      this.frames.delete(id); this.failures.delete(id);
      if (p) void this.message(p, frame, 'dispose').catch(() => undefined);
    }
    if (this.pointer && removed.has(this.pointer.frame.frameId)) { this.pointer = undefined; this.canceledPointer = true; }
    for (const [code, owner] of this.keys) if (removed.has(owner.frame.frameId)) { this.keys.delete(code); this.canceledKeys.add(code); }
  }

  private message(p: Presentation, frame: Frame, operation: string, fields: object = {}): Promise<any> {
    return chrome.tabs.sendMessage(p.tabId, { target: 'ghostpair.dom', captureId: p.captureId, generation: p.generation, controlRevision: this.configuration.revision, operation, ...fields }, { documentId: frame.documentId });
  }
  private check(p: Presentation, revision: number) {
    if (this.presentation !== p || this.revision !== revision || !this.usable(p)) throw changed();
  }
  private async request(p: Presentation, revision: number, frame: Frame, operation: string, fields: object = {}) {
    this.check(p, revision);
    const reply = await this.message(p, frame, operation, fields).catch(() => { throw changed(); });
    this.check(p, revision);
    if (!reply?.ok) throw new Error(reply?.error ?? 'The embedded page is not ready for control.');
    return reply;
  }

  private sync(): Promise<void> {
    if (this.syncing) return this.syncing.then(() => this.sync());
    const work = this.syncNow();
    this.syncing = work;
    return work.finally(() => { if (this.syncing === work) this.syncing = undefined; });
  }
  private async syncNow() {
    const p = this.presentation, revision = this.revision;
    if (!p) return;
    const all = await chrome.webNavigation.getAllFrames({ tabId: p.tabId });
    if (this.presentation !== p || !all?.some(frame => frame.frameId === 0 && frame.documentId === p.documentId)) return;
    const live = new Map(all.filter(frame => frame.documentLifecycle === 'active').map(frame => [frame.documentId, frame]));
    for (const frame of this.frames.values()) if (!live.has(frame.documentId)) this.retire(frame.frameId);
    const belongs = (frame: chrome.webNavigation.GetAllFrameResultDetails): boolean => {
      const seen = new Set<number>();
      let current = frame;
      while (current.frameId !== 0) {
        if (seen.has(current.frameId) || this.blocked.has(current.frameId)) return false;
        seen.add(current.frameId);
        const parent = all.find(candidate => candidate.frameId === current.parentFrameId && (!current.parentDocumentId || candidate.documentId === current.parentDocumentId));
        if (!parent || parent.documentLifecycle !== 'active') return false;
        current = parent;
      }
      return current.documentId === p.documentId;
    };
    await Promise.all([...live.values()].filter(frame => frame.frameId !== 0 && belongs(frame) && !this.frames.has(frame.documentId) && !this.failures.has(frame.documentId)).map(async frame => {
      // Related blank/srcdoc/blob documents are attempted only inside this authorized tree.
      const related = /^(about:(blank|srcdoc)|blob:)/.test(frame.url);
      if (!isSupportedUrl(frame.url) && !related) { this.failures.set(frame.documentId, 'Chrome does not allow control of this embedded surface.'); return; }
      try {
        const result = (await chrome.scripting.executeScript({ target: { tabId: p.tabId, documentIds: [frame.documentId] }, world: 'ISOLATED', injectImmediately: true, func: installDomControl, args: [p.captureId, p.generation, false, this.configuration] }))[0];
        if (this.presentation !== p || this.revision !== revision || this.blocked.has(frame.frameId)) {
          await this.message(p, frame, 'dispose').catch(() => undefined); return;
        }
        if (result?.documentId !== frame.documentId) return;
        this.frames.set(frame.documentId, frame); this.failures.delete(frame.documentId);
      } catch {
        if (this.presentation === p) this.failures.set(frame.documentId, 'Site access is unavailable for this embedded page. Check its permissions in the extension menu.');
      }
    }));
  }

  execute(command: Input): Promise<void> {
    const p = this.presentation, revision = this.revision;
    const work = this.queue.then(async () => {
      if (!p) throw changed();
      this.check(p, revision);
      if (command.controlRevision !== this.configuration.revision) throw new Error('The interaction mode changed.');
      try { await this.executeNow(p, revision, command); }
      catch (error) {
        // A late failure belongs to its original operation, never a replacement view.
        if (this.presentation === p && this.revision === revision) await this.release();
        throw error;
      }
    });
    this.queue = work.catch(() => undefined); return work;
  }

  private async executeNow(p: Presentation, revision: number, command: Input) {
    if (command.type === 'key' && command.event === 'up') {
      const owner = this.keys.get(command.code); this.keys.delete(command.code); this.canceledKeys.delete(command.code);
      if (owner && this.frames.has(owner.frame.documentId)) this.activity((await this.request(p, revision, owner.frame, 'command', { command })).visualActivity);
      return;
    }
    if (command.type === 'key' && this.canceledKeys.has(command.code)) {
      if (command.repeat) throw changed();
      this.canceledKeys.delete(command.code);
    }
    if (command.type === 'pointer') {
      if (command.event === 'down') this.canceledPointer = false;
      else if (this.canceledPointer && (command.buttons || command.event === 'up')) {
        if (command.event === 'up') this.canceledPointer = false;
        throw changed();
      }
    }
    let frame = this.frames.get(p.documentId);
    if (!frame) throw changed();
    let local = command;
    const steps: Step[] = [];
    for (let depth = 0; depth < 32; depth++) {
      const probe = await this.request(p, revision, frame, 'prepare', { command: local });
      steps.push({ frame, token: probe.token, index: probe.child?.index });
      if (!probe.child) break;
      await this.sync(); this.check(p, revision);
      const candidates = [...this.frames.values()].filter(child => child.parentFrameId === frame!.frameId && (!child.parentDocumentId || child.parentDocumentId === frame!.documentId));
      const matches: { frame: Frame; info: any }[] = [];
      for (const child of candidates) {
        let info;
        try { info = await this.request(p, revision, child, 'describe'); } catch { this.check(p, revision); continue; }
        if (info.index === probe.child.index) matches.push({ frame: child, info });
      }
      if (matches.length !== 1) {
        const all = await chrome.webNavigation.getAllFrames({ tabId: p.tabId }); this.check(p, revision);
        const denied = all?.some(child => child.parentFrameId === frame!.frameId && this.failures.has(child.documentId));
        throw new Error(denied ? 'Site access is unavailable for this embedded page. Check its permissions in the extension menu.' : 'The embedded page is loading or changed. Try the action again.');
      }
      const child = matches[0]!;
      await this.request(p, revision, frame, 'verify', { token: probe.token });
      frame = child.frame;
      if ('x' in local) local = { ...local, x: probe.child.x * child.info.viewportWidth, y: probe.child.y * child.info.viewportHeight };
      if (depth === 31) throw new Error('This page has too many nested embedded documents.');
    }
    const path = steps.map(step => `${step.frame.documentId}:${step.index ?? ''}`).join('/');
    const owner = command.type === 'pointer' && command.event !== 'down' ? this.pointer : command.type === 'key' ? this.keys.get(command.code) : undefined;
    if (owner && (owner.frame.documentId !== frame.documentId || owner.path !== path)) throw changed();
    // Validate the same connected iframe elements and hit/focus chain again before committing.
    for (const step of steps) await this.request(p, revision, step.frame, 'verify', { token: step.token });
    const last = steps.at(-1)!;
    const result = await this.request(p, revision, frame, 'commit', { token: last.token, indices: steps.slice(0, -1).map(step => step.index) });
    if (this.configuration.mode === 'visual' && command.type === 'pointer' && command.event === 'down') {
      for (const step of steps.slice(0, -1)) await this.request(p, revision, step.frame, 'virtual.focus', { token: step.token });
    }
    this.activity(result.visualActivity);
    if (command.type === 'pointer') {
      if (command.event === 'down') this.pointer = { frame, path };
      if (command.event === 'up') this.pointer = undefined;
    }
    if (command.type === 'key' && !this.keys.has(command.code)) this.keys.set(command.code, { frame, path });
  }
}
