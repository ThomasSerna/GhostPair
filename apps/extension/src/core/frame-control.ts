import { isSupportedUrl, type ControlCommand, type Presentation } from '@ghostpair/protocol';
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
    this.presentation = presentation; this.blocked.clear(); this.failures.clear();
    this.frames.set(presentation.documentId, { frameId: 0, documentId: presentation.documentId, parentFrameId: -1 });
    await this.sync();
  }

  release() {
    ++this.revision;
    this.pointer = undefined; this.canceledPointer = true;
    for (const code of this.keys.keys()) this.canceledKeys.add(code);
    this.keys.clear();
    const p = this.presentation;
    return p ? Promise.allSettled([...this.frames.values()].map(frame => this.message(p, frame, 'release'))).then(() => undefined) : Promise.resolve();
  }

  clear() {
    const p = this.presentation, frames = [...this.frames.values()];
    void this.release(); this.presentation = undefined; this.frames.clear(); this.failures.clear(); this.blocked.clear();
    // Generation-scoped disposal cannot remove a newer installation in the same document.
    return p ? Promise.allSettled(frames.map(frame => this.message(p, frame, 'dispose'))).then(() => undefined) : Promise.resolve();
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
    return chrome.tabs.sendMessage(p.tabId, { target: 'ghostpair.dom', captureId: p.captureId, generation: p.generation, operation, ...fields }, { documentId: frame.documentId });
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
        const result = (await chrome.scripting.executeScript({ target: { tabId: p.tabId, documentIds: [frame.documentId] }, world: 'ISOLATED', injectImmediately: true, func: installDomControl, args: [p.captureId, p.generation, false] }))[0];
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
      try { await this.executeNow(p, revision, command); }
      catch (error) { await this.release(); throw error; }
    });
    this.queue = work.catch(() => undefined); return work;
  }

  private async executeNow(p: Presentation, revision: number, command: Input) {
    if (command.type === 'key' && command.event === 'up') {
      const owner = this.keys.get(command.code); this.keys.delete(command.code); this.canceledKeys.delete(command.code);
      if (owner && this.frames.has(owner.frame.documentId)) await this.request(p, revision, owner.frame, 'command', { command });
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
    await this.request(p, revision, frame, 'commit', { token: last.token, indices: steps.slice(0, -1).map(step => step.index) });
    if (command.type === 'pointer') {
      if (command.event === 'down') this.pointer = { frame, path };
      if (command.event === 'up') this.pointer = undefined;
    }
    if (command.type === 'key' && !this.keys.has(command.code)) this.keys.set(command.code, { frame, path });
  }
}
