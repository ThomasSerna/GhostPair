import type { ControlCommand, ControlConfiguration } from '@ghostpair/protocol';

/** Self-contained: Chrome serializes this function into the page's ISOLATED world. */
export function installDomControl(captureId: string, generation: number, root = true, configuration: ControlConfiguration = { mode: 'visual', revision: 0, preferences: { notices: false, duration: 'persistent', seconds: 3, accentColor: '#7871e8' } }) {
  type Context = { captureId: string; generation: number; ready: boolean; geometry: string; dispose: () => void; release: () => void; configure: (value: ControlConfiguration) => void };
  const scope = globalThis as typeof globalThis & { __ghostpairControl?: Context };
  const geometry = () => ({ viewportWidth: innerWidth, viewportHeight: innerHeight, offsetLeft: visualViewport?.offsetLeft ?? 0, offsetTop: visualViewport?.offsetTop ?? 0, scale: visualViewport?.scale ?? 1 });
  if (scope.__ghostpairControl) {
    if (scope.__ghostpairControl.captureId !== captureId) scope.__ghostpairControl.dispose();
  }
  if (scope.__ghostpairControl) {
    if (scope.__ghostpairControl.captureId === captureId && scope.__ghostpairControl.generation > generation) throw new Error('The shared page changed. Wait for the current view.');
    scope.__ghostpairControl.release();
    scope.__ghostpairControl.configure(configuration);
    scope.__ghostpairControl.captureId = captureId;
    scope.__ghostpairControl.generation = generation;
    scope.__ghostpairControl.ready = true;
    scope.__ghostpairControl.geometry = JSON.stringify(geometry());
    return geometry();
  }
  let down: Element | null = null;
  let downFields: MouseEventInit = {};
  let suppressMouse = false;
  const keys = new Map<string, { element: Element | null; fields: KeyboardEventInit; space?: boolean }>();
  type Prepared = { token: string; command: ControlCommand; element: Element | null; child?: { index: number; x?: number; y?: number }; childWindow?: Window | null };
  let prepared: Prepared | undefined;
  const context: Context = { captureId, generation, ready: true, geometry: JSON.stringify(geometry()), dispose, release, configure };
  scope.__ghostpairControl = context;

  // All preview data and nodes belong to the extension, never to a page control.
  type Preview = { node: HTMLDivElement; cursor?: HTMLSpanElement; value?: string; anchor: number; caret: number; checked?: boolean; until?: number };
  const previews = new Map<HTMLElement, Preview>();
  let virtualFocus: Element | null = null;
  let visualDown: Element | null = null;
  let visualButton = 'left';
  const visualKeys = new Map<string, Element | null>();
  let layer: HTMLDivElement | undefined, shadow: ShadowRoot | undefined, focusMark: HTMLDivElement | undefined, notice: HTMLDivElement | undefined;
  let drawing: number | undefined, drawnAt = 0, noticeUntil = 0, lastNotice = -Infinity;
  const halos: { node: HTMLDivElement; x: number; y: number; until: number }[] = [];

  function configure(value: ControlConfiguration) {
    if (value.revision < configuration.revision) throw new Error('The interaction mode changed.');
    if (value.revision !== configuration.revision || value.mode !== configuration.mode) { release(); clearVisual(); }
    configuration = value;
    updateAccent();
    if (!value.preferences.notices) { notice?.remove(); notice = undefined; noticeUntil = 0; }
  }
  function updateAccent() {
    layer?.style.setProperty('--gp-accent', configuration.preferences.accentColor ?? '#7871e8');
  }
  function ensureLayer() {
    if (layer) { if (!layer.isConnected) document.documentElement.append(layer); return; }
    layer = document.createElement('div');
    layer.dataset.ghostpairVisual = '';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;pointer-events:none!important;overflow:hidden!important;contain:strict!important;';
    updateAccent();
    shadow = layer.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{pointer-events:none!important}*{box-sizing:border-box;pointer-events:none!important;user-select:none}div{position:absolute;margin:0}';
    shadow.append(style);
    document.documentElement.append(layer);
  }
  function node() { ensureLayer(); const result = document.createElement('div'); shadow!.append(result); return result; }
  function scheduleDraw() { if (drawing === undefined) drawing = requestAnimationFrame(draw); }
  function clearVisual() {
    if (drawing !== undefined) cancelAnimationFrame(drawing);
    drawing = undefined; layer?.remove(); layer = undefined; shadow = undefined; focusMark = undefined; notice = undefined;
    previews.clear(); halos.length = 0; virtualFocus = null; visualDown = null; visualKeys.clear(); noticeUntil = 0; lastNotice = -Infinity;
  }
  function rectStyle(element: HTMLElement, overlay: HTMLDivElement) {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    let left = Math.max(0, box.left), top = Math.max(0, box.top), right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom);
    let visible = element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
    for (let ancestor = parent(element); ancestor; ancestor = parent(ancestor)) {
      const css = getComputedStyle(ancestor), clip = ancestor.getBoundingClientRect();
      if (css.visibility === 'hidden' || Number(css.opacity) === 0) visible = false;
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
    }
    Object.assign(overlay.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, display: visible && right > left && bottom > top ? 'block' : 'none', clipPath: `inset(${Math.max(0, top - box.top)}px ${Math.max(0, box.right - right)}px ${Math.max(0, box.bottom - bottom)}px ${Math.max(0, left - box.left)}px)` });
    return { box, style };
  }
  function draw(time: number) {
    drawing = undefined;
    if (!layer) return;
    if (time - drawnAt < 32) { scheduleDraw(); return; }
    drawnAt = time; ensureLayer();
    if (virtualFocus && !virtualFocus.isConnected) virtualFocus = null;
    for (const [element, preview] of previews) {
      if (!element.isConnected || preview.until !== undefined && time >= preview.until) { preview.node.remove(); previews.delete(element); continue; }
      const { box, style } = rectStyle(element, preview.node);
      if (preview.value !== undefined) {
        const scale = element.offsetWidth ? box.width / element.offsetWidth : 1;
        Object.assign(preview.node.style, { background: style.backgroundColor === 'rgba(0, 0, 0, 0)' ? '#fff' : style.backgroundColor, color: style.color, border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`, borderRadius: style.borderRadius, padding: style.padding, font: style.font, fontSize: `${parseFloat(style.fontSize) * scale}px`, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, textAlign: style.textAlign, direction: style.direction, whiteSpace: element instanceof HTMLInputElement ? 'pre' : 'pre-wrap', overflowWrap: 'anywhere', overflow: 'hidden' });
        // Scroll only the extension's text surface, never the real field/page.
        if (preview.cursor && virtualFocus === element) {
          const cursor = preview.cursor.getBoundingClientRect(), inset = 4;
          if (cursor.right > box.right - inset) preview.node.scrollLeft += cursor.right - box.right + inset;
          else if (cursor.left < box.left + inset) preview.node.scrollLeft -= box.left + inset - cursor.left;
          if (cursor.bottom > box.bottom - inset) preview.node.scrollTop += cursor.bottom - box.bottom + inset;
          else if (cursor.top < box.top + inset) preview.node.scrollTop -= box.top + inset - cursor.top;
        }
      }
    }
    const paintFocus = virtualFocus instanceof HTMLElement && !(virtualFocus instanceof HTMLIFrameElement || virtualFocus instanceof HTMLFrameElement) && !disabled(virtualFocus);
    if (paintFocus && virtualFocus instanceof HTMLElement) {
      focusMark ??= node(); rectStyle(virtualFocus, focusMark);
      Object.assign(focusMark.style, { border: '2px solid var(--gp-accent)', borderRadius: '3px', background: 'transparent' });
    } else { focusMark?.remove(); focusMark = undefined; }
    for (let i = halos.length - 1; i >= 0; i--) {
      const halo = halos[i]!;
      if (time >= halo.until) { halo.node.remove(); halos.splice(i, 1); }
      else { const progress = 1 - (halo.until - time) / 500; halo.node.style.transform = `scale(${0.6 + progress * 0.7})`; halo.node.style.opacity = String(1 - progress); }
    }
    if (notice && time >= noticeUntil) { notice.remove(); notice = undefined; }
    if (previews.size || paintFocus || halos.length || notice) scheduleDraw();
    else { layer.remove(); layer = undefined; shadow = undefined; }
  }
  function showNotice(kind: string) {
    const now = performance.now();
    if (!root || !configuration.preferences.notices || now - lastNotice < 3000 || !['click', 'typing'].includes(kind)) return;
    notice ??= node(); notice.textContent = kind === 'typing' ? 'Simulated typing' : 'Simulated click';
    notice.style.cssText = 'position:fixed;right:12px;bottom:12px;max-width:220px;padding:5px 8px;border-radius:5px;background:rgba(30,30,38,.82);color:#fff;font:11px/14px system-ui;white-space:nowrap;';
    noticeUntil = now + 1500; lastNotice = now; scheduleDraw();
  }
  function halo(x: number, y: number) {
    const dot = node(); dot.style.cssText = `left:${x - 15}px;top:${y - 15}px;width:30px;height:30px;border:2px solid var(--gp-accent);border-radius:50%;background:color-mix(in srgb,var(--gp-accent) 12%,transparent);`;
    halos.push({ node: dot, x, y, until: performance.now() + 500 }); scheduleDraw();
  }
  function previewFor(element: HTMLElement) {
    let preview = previews.get(element);
    if (!preview) {
      if (previews.size >= 256) throw new Error('Clear the simulation before adding more fields.');
      preview = { node: node(), anchor: 0, caret: 0 }; previews.set(element, preview);
    }
    scheduleDraw(); return preview;
  }
  function textPreview(element: HTMLElement) {
    const preview = previewFor(element);
    if (preview.value === undefined) { preview.value = editable(element) ? element.value : element.innerText; preview.anchor = preview.caret = preview.value.length; }
    return preview;
  }
  function paintText(element: HTMLElement, preview: Preview) {
    const value = preview.value ?? '', start = Math.min(preview.anchor, preview.caret), end = Math.max(preview.anchor, preview.caret);
    const masked = element instanceof HTMLInputElement && element.type === 'password';
    const display = (text: string) => masked ? '•'.repeat(Array.from(text).length) : text;
    const selection = document.createElement('span'); selection.textContent = display(value.slice(start, end)); selection.style.cssText = 'background:color-mix(in srgb,var(--gp-accent) 30%,transparent);color:inherit';
    const caret = document.createElement('span'); caret.style.cssText = 'border-left:1px solid currentColor;height:1em';
    preview.cursor = element === virtualFocus ? caret : undefined;
    preview.node.replaceChildren(document.createTextNode(display(value.slice(0, start))),
      ...(preview.cursor && preview.caret === start ? [caret] : []), ...(start !== end ? [selection] : []),
      ...(preview.cursor && preview.caret !== start ? [caret] : []), document.createTextNode(display(value.slice(end))));
  }
  function semantic(element: Element | null): HTMLElement | null {
    for (let current = element; current; current = parent(current)) {
      if (current instanceof HTMLLabelElement && current.control) return current.control;
      if (current instanceof HTMLElement && (current.matches('input,textarea,button,select,a[href],[tabindex],[role="button"],[role="checkbox"],[role="radio"]') || current.hasAttribute('contenteditable') && current.isContentEditable)) return current;
    }
    return null;
  }
  function setVirtualFocus(element: Element | null) {
    const previous = virtualFocus;
    virtualFocus = element && !disabled(element) ? element : null;
    if (previous instanceof HTMLElement && previous !== virtualFocus) { const preview = previews.get(previous); if (preview?.value !== undefined) paintText(previous, preview); }
    if (virtualFocus instanceof HTMLElement && (editable(virtualFocus) || virtualFocus.isContentEditable)) paintText(virtualFocus, textPreview(virtualFocus));
    if (virtualFocus && !(virtualFocus instanceof HTMLIFrameElement || virtualFocus instanceof HTMLFrameElement)) { ensureLayer(); scheduleDraw(); }
  }
  function markChecked(element: HTMLElement, checked: boolean, radio: boolean) {
    const preview = previewFor(element); preview.checked = checked;
    preview.node.textContent = checked ? radio ? '●' : '✓' : '';
    preview.node.style.cssText = `border:1px solid var(--gp-accent);border-radius:${radio ? '50%' : '3px'};background:#fff;color:var(--gp-accent);font:bold 14px/1 system-ui;text-align:center;overflow:hidden;`;
  }
  function activateVisual(element: HTMLElement) {
    if (disabled(element)) return;
    const radio = element instanceof HTMLInputElement && element.type === 'radio';
    const checkbox = element instanceof HTMLInputElement && element.type === 'checkbox';
    if (radio || checkbox) {
      if (radio && element.name) for (const other of (element.getRootNode() as Document | ShadowRoot).querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
        if (other !== element && other.name === element.name && other.form === element.form) markChecked(other, false, true);
      }
      markChecked(element, radio || !(previews.get(element)?.checked ?? element.checked), radio);
    } else if (element.matches('[role="checkbox"],[role="radio"]')) {
      const isRadio = element.getAttribute('role') === 'radio';
      markChecked(element, isRadio || !(previews.get(element)?.checked ?? element.getAttribute('aria-checked') === 'true'), isRadio);
    } else if (element.matches('button,a[href],input[type="button"],input[type="submit"],input[type="reset"],[role="button"]')) {
      const preview = previewFor(element); preview.until = performance.now() + 180;
      preview.node.style.cssText = 'background:color-mix(in srgb,var(--gp-accent) 22%,transparent);border:2px solid var(--gp-accent);border-radius:4px;';
    }
  }
  function insertVisual(text: string) {
    const element = virtualFocus;
    if (!(element instanceof HTMLElement) || !(editable(element) || element.isContentEditable)) return;
    if (disabled(element) || editable(element) && element.readOnly) return;
    const preview = textPreview(element), value = preview.value!;
    const start = Math.min(preview.anchor, preview.caret), end = Math.max(preview.anchor, preview.caret);
    const next = value.slice(0, start) + text + value.slice(end);
    if (new TextEncoder().encode(next).length > 256 * 1024) throw new Error('Simulated text exceeds the limit.');
    preview.value = next; preview.anchor = preview.caret = start + text.length; paintText(element, preview); return 'typing';
  }
  function executeVisual(command: ControlCommand): string | undefined {
    if (command.type === 'pointer') {
      if (command.event === 'move') return;
      const hit = targetAt(command.x, command.y);
      if (command.event === 'down') { visualDown = hit; visualButton = command.button; setVirtualFocus(semantic(hit)); return 'focus'; }
      const clicked = hit && visualButton === command.button ? commonAncestor(visualDown, hit) : null; visualDown = null;
      if (!hit || !clicked) return;
      halo(command.x, command.y);
      const element = semantic(clicked);
      if (element && command.button === 'left') activateVisual(element);
      return 'click';
    }
    if (command.type === 'text') { if (command.text === ' ' && spaceActivates(virtualFocus)) return; return insertVisual(command.text); }
    if (command.type !== 'key') return;
    const element = virtualFocus;
    if (command.event === 'up') {
      const held = visualKeys.get(command.code); visualKeys.delete(command.code);
      if (command.key === ' ' && held === element && spaceActivates(element) && !disabled(element)) { activateVisual(element); return 'click'; }
      return;
    }
    if (!visualKeys.has(command.code)) visualKeys.set(command.code, element);
    if (command.key === 'Tab') {
      const tree = (element?.getRootNode() ?? document) as Document | ShadowRoot;
      const elements = Array.from(tree.querySelectorAll<HTMLElement>('a[href],button,input,textarea,select,[tabindex],[contenteditable]:not([contenteditable="false"])')).filter(e => e.tabIndex >= 0 && !disabled(e) && e.getClientRects().length > 0);
      const index = elements.indexOf(element as HTMLElement); setVirtualFocus(elements[(index + (command.modifiers & 8 ? -1 : 1) + elements.length) % elements.length] ?? null); return 'focus';
    }
    if (!(element instanceof HTMLElement) || disabled(element)) return;
    if (element instanceof HTMLInputElement && element.type === 'radio' && command.key.startsWith('Arrow')) {
      const radios = Array.from((element.getRootNode() as Document | ShadowRoot).querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(e => (e === element || Boolean(element.name) && e.name === element.name && e.form === element.form) && !disabled(e) && e.getClientRects().length > 0);
      const next = radios[(radios.indexOf(element) + (['ArrowLeft', 'ArrowUp'].includes(command.key) ? -1 : 1) + radios.length) % radios.length];
      if (next) { setVirtualFocus(next); activateVisual(next); return 'click'; } return;
    }
    if (!(editable(element) || element.isContentEditable)) { if (command.key === 'Enter') { activateVisual(element); return 'click'; } return; }
    const preview = textPreview(element), value = preview.value!;
    if (command.modifiers & 6 && command.key.toLowerCase() === 'a') { preview.anchor = 0; preview.caret = value.length; paintText(element, preview); return 'focus'; }
    if (command.modifiers & 7) return;
    if (command.key === 'Backspace' || command.key === 'Delete') {
      if (preview.anchor === preview.caret) {
        if (command.key === 'Backspace') preview.anchor -= Array.from(value.slice(0, preview.caret)).at(-1)?.length ?? 0;
        else preview.caret += Array.from(value.slice(preview.caret))[0]?.length ?? 0;
      }
      return insertVisual('');
    }
    if (command.key === 'Enter') return element instanceof HTMLInputElement ? undefined : insertVisual('\n');
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(command.key)) {
      const start = Math.min(preview.anchor, preview.caret), end = Math.max(preview.anchor, preview.caret), shift = Boolean(command.modifiers & 8);
      const left = command.key === 'ArrowLeft', right = command.key === 'ArrowRight';
      const position = left ? !shift && start !== end ? start : Math.max(0, preview.caret - (Array.from(value.slice(0, preview.caret)).at(-1)?.length ?? 0)) : right ? !shift && start !== end ? end : preview.caret + (Array.from(value.slice(preview.caret))[0]?.length ?? 0) : ['Home', 'ArrowUp'].includes(command.key) ? 0 : value.length;
      preview.caret = position; if (!shift) preview.anchor = position; paintText(element, preview); return 'focus';
    }
  }

  function targetAt(x: number, y: number): Element | null {
    let element = document.elementFromPoint(x, y);
    while (element?.shadowRoot) {
      const inner = element.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === element) break;
      element = inner;
    }
    return element;
  }
  function focused(): Element | null {
    if (configuration.mode === 'visual') return virtualFocus?.isConnected ? virtualFocus : null;
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  }
  function frameIndex(container: Window, child: Window | null) {
    for (let index = 0; index < container.length; index++) if (container.frames[index] === child) return index;
    return -1;
  }
  function childTarget(element: Element | null, command: ControlCommand) {
    if (!(element instanceof HTMLIFrameElement || element instanceof HTMLFrameElement)) return;
    const index = frameIndex(window, element.contentWindow);
    if (index < 0) throw new Error('The embedded page changed. Try the action again.');
    if (!('x' in command)) return { index };
    // A bounding rectangle alone cannot invert rotation, skew or perspective.
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement ?? (ancestor.getRootNode() instanceof ShadowRoot ? (ancestor.getRootNode() as ShadowRoot).host : null)) {
      const style = getComputedStyle(ancestor);
      const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
      const scales = style.scale === 'none' ? [1] : style.scale.split(/\s+/).map(Number);
      if (!matrix.is2D || matrix.b !== 0 || matrix.c !== 0 || matrix.a <= 0 || matrix.d <= 0 || style.perspective !== 'none' || !['none', '0deg', '0'].includes(style.rotate) || scales.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('This embedded page uses unsupported rotation, skew or perspective.');
    }
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    const sx = rect.width / element.offsetWidth, sy = rect.height / element.offsetHeight;
    const pl = parseFloat(style.paddingLeft) || 0, pr = parseFloat(style.paddingRight) || 0;
    const pt = parseFloat(style.paddingTop) || 0, pb = parseFloat(style.paddingBottom) || 0;
    const width = (element.clientWidth - pl - pr) * sx, height = (element.clientHeight - pt - pb) * sy;
    if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw new Error('The embedded page has no usable content area.');
    const x = (command.x - rect.left - (element.clientLeft + pl) * sx) / width;
    const y = (command.y - rect.top - (element.clientTop + pt) * sy) / height;
    // The border belongs to the embedding document, not its child viewport.
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { index, x, y } : undefined;
  }
  function prepare(command: ControlCommand) {
    const element = 'x' in command ? targetAt(command.x, command.y) : focused();
    const child = childTarget(element, command);
    prepared = { token: crypto.randomUUID(), command, element, child, childWindow: child ? (element as HTMLIFrameElement).contentWindow : undefined };
    return { token: prepared.token, child };
  }
  function verify(token: string) {
    const pending = prepared;
    if (!pending || pending.token !== token || pending.element && !pending.element.isConnected) throw new Error('The embedded page changed. Try the action again.');
    const element = 'x' in pending.command ? targetAt(pending.command.x, pending.command.y) : focused();
    if (element !== pending.element || JSON.stringify(childTarget(element, pending.command)) !== JSON.stringify(pending.child) || pending.child && (element as HTMLIFrameElement).contentWindow !== pending.childWindow) throw new Error('The embedded page changed. Try the action again.');
    return pending;
  }
  const editable = (element: Element | null): element is HTMLInputElement | HTMLTextAreaElement => element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'password', 'email', 'number'].includes(element.type);
  const parent = (element: Element): Element | null => element.parentElement ?? (element.getRootNode() instanceof ShadowRoot ? (element.getRootNode() as ShadowRoot).host : null);
  function disabled(element: Element | null): boolean {
    // :disabled on the control includes fieldset inheritance and the first-legend exception.
    for (let current = element; current; current = parent(current)) {
      if (current.hasAttribute('inert') || current.matches('button:disabled,input:disabled,select:disabled,textarea:disabled,option:disabled,optgroup:disabled')) return true;
    }
    return false;
  }
  function commonAncestor(first: Element | null, second: Element): Element | null {
    if (!first?.isConnected) return null;
    const ancestors = new Set<Element>();
    for (let current: Element | null = first; current; current = parent(current)) ancestors.add(current);
    for (let current: Element | null = second; current; current = parent(current)) if (ancestors.has(current)) return current;
    return null;
  }
  const spaceActivates = (element: Element | null): element is HTMLElement => element instanceof HTMLButtonElement || element instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(element.type);
  function implicitSubmit(element: HTMLInputElement) {
    const form = element.form;
    if (!form) return;
    const submitter = Array.from((form.getRootNode() as Document | ShadowRoot).querySelectorAll('button,input')).find(candidate =>
      (candidate instanceof HTMLButtonElement && candidate.type === 'submit' || candidate instanceof HTMLInputElement && ['submit', 'image'].includes(candidate.type)) && candidate.form === form
    ) as HTMLElement | undefined;
    // A disabled default button blocks implicit submission; do not skip to another button.
    if (submitter) { if (!disabled(submitter)) submitter.click(); return; }
    const blockers = Array.from(form.elements).filter(candidate => candidate instanceof HTMLInputElement && ['text', 'search', 'url', 'tel', 'email', 'password', 'date', 'month', 'week', 'time', 'datetime-local', 'number'].includes(candidate.type));
    if (blockers.length <= 1) form.requestSubmit();
  }
  function selectionKey(element: Element | null, key: string): boolean {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return false;
    const backwards = key === 'ArrowLeft' || key === 'ArrowUp';
    if (element instanceof HTMLInputElement && element.type === 'radio' && key.startsWith('Arrow')) {
      const radios = Array.from((element.getRootNode() as Document | ShadowRoot).querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(radio =>
        (radio === element || Boolean(element.name) && radio.name === element.name && radio.form === element.form) && !disabled(radio) && radio.getClientRects().length > 0
      );
      const index = radios.indexOf(element);
      const next = radios[(index + (backwards ? -1 : 1) + radios.length) % radios.length];
      if (next) { next.focus({ preventScroll: true }); next.click(); }
      return true;
    }
    if (element instanceof HTMLSelectElement && !element.multiple) {
      const options = Array.from(element.options).filter(option => !option.matches(':disabled') && !option.hidden && !option.parentElement?.hidden);
      const selected = element.selectedOptions[0], index = options.indexOf(selected!);
      const next = options[key === 'Home' ? 0 : key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (backwards ? -1 : 1)))];
      if (next && next !== selected) {
        element.selectedIndex = next.index;
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }
    return false;
  }
  function insert(text: string, inputType = 'insertText', start?: number, end?: number) {
    const element = focused();
    if (!(element instanceof HTMLElement)) throw new Error('Focus a text field before typing.');
    if (editable(element)) {
      if (disabled(element) || element.readOnly) throw new Error('This text field cannot be edited.');
      const from = start ?? element.selectionStart ?? element.value.length;
      const to = end ?? element.selectionEnd ?? from;
      if (!element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true, data: text, inputType }))) return;
      const value = element.value.slice(0, from) + text + element.value.slice(to);
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      try { element.setSelectionRange(from + text.length, from + text.length); } catch { /* number/email inputs have no selection API */ }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text, inputType }));
      return;
    }
    if (element.isContentEditable) {
      if (!document.execCommand('insertText', false, text)) throw new Error('This editor does not support basic text insertion.');
      return;
    }
    throw new Error('Focus an editable text field before typing.');
  }
  function release() {
    prepared = undefined;
    visualDown = null; visualKeys.clear();
    if (down) {
      down.dispatchEvent(new PointerEvent('pointercancel', { ...downFields, cancelable: false, buttons: 0, pointerId: 1, pointerType: 'mouse' }));
    }
    down = null;
    suppressMouse = false;
    for (const { element, fields } of keys.values()) element?.dispatchEvent(new KeyboardEvent('keyup', fields));
    keys.clear();
  }
  function execute(command: ControlCommand) {
    if (command.controlRevision !== configuration.revision) throw new Error('The interaction mode changed.');
    if (configuration.mode === 'visual' && command.type !== 'wheel') return executeVisual(command);
    if (command.type === 'pointer') {
      const element = targetAt(command.x, command.y);
      if (!element) { if (command.event === 'up') release(); return; }
      const fields = { bubbles: true, cancelable: true, composed: true, clientX: command.x, clientY: command.y, detail: command.clickCount, button: command.button === 'left' ? 0 : command.button === 'middle' ? 1 : 2, buttons: command.buttons, ctrlKey: Boolean(command.modifiers & 2), shiftKey: Boolean(command.modifiers & 8), altKey: Boolean(command.modifiers & 1), metaKey: Boolean(command.modifiers & 4) };
      const name = command.event === 'down' ? 'down' : command.event === 'up' ? 'up' : 'move';
      const allowed = element.dispatchEvent(new PointerEvent(`pointer${name}`, { ...fields, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      if (command.event === 'down') suppressMouse = !allowed;
      const mouseAllowed = !suppressMouse && !disabled(element) && element.dispatchEvent(new MouseEvent(`mouse${name}`, fields));
      if (command.event === 'down') {
        down = element;
        downFields = fields;
        if (mouseAllowed) (element.closest('input,textarea,button,select,a,[tabindex],[contenteditable]') as HTMLElement | null)?.focus({ preventScroll: true });
      }
      if (command.event === 'up') {
        const clicked = downFields.button === fields.button ? commonAncestor(down, element) : null;
        down = null; suppressMouse = false;
        if (clicked && !disabled(clicked) && !disabled(element)) {
          if (command.button === 'left') {
            clicked.dispatchEvent(new MouseEvent('click', fields));
            if (command.clickCount === 2) clicked.dispatchEvent(new MouseEvent('dblclick', { ...fields, detail: 2 }));
          } else if (command.button === 'right') clicked.dispatchEvent(new MouseEvent('contextmenu', fields));
          else throw new Error('Middle-click browser actions require the host.');
        }
      }
      return;
    }
    if (command.type === 'wheel') {
      let element = targetAt(command.x, command.y);
      if (element && !element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, composed: true, cancelable: true, clientX: command.x, clientY: command.y, deltaX: command.deltaX, deltaY: command.deltaY, deltaMode: 0, ctrlKey: Boolean(command.modifiers & 2), shiftKey: Boolean(command.modifiers & 8), altKey: Boolean(command.modifiers & 1), metaKey: Boolean(command.modifiers & 4) }))) return;
      while (element) {
        const style = getComputedStyle(element);
        const scrollY = command.deltaY !== 0 && /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
        const scrollX = command.deltaX !== 0 && /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
        if (scrollY || scrollX) {
          const left = element.scrollLeft, top = element.scrollTop;
          element.scrollBy({ left: command.deltaX, top: command.deltaY, behavior: 'instant' });
          if (element.scrollLeft !== left || element.scrollTop !== top) return;
        }
        element = element.parentElement ?? (element.getRootNode() instanceof ShadowRoot ? (element.getRootNode() as ShadowRoot).host : null);
      }
      window.scrollBy({ left: command.deltaX, top: command.deltaY, behavior: 'instant' }); return;
    }
    if (command.type === 'text') { if (command.text !== ' ' || !spaceActivates(focused())) insert(command.text); return; }
    if (command.type !== 'key') throw new Error('This operation is handled by the extension.');
    const element = focused();
    const fields = { key: command.key, code: command.code, repeat: command.repeat, bubbles: true, cancelable: true, composed: true, ctrlKey: Boolean(command.modifiers & 2), shiftKey: Boolean(command.modifiers & 8), altKey: Boolean(command.modifiers & 1), metaKey: Boolean(command.modifiers & 4) };
    if (command.event === 'up') {
      const held = keys.get(command.code); keys.delete(command.code);
      const allowed = held?.element?.dispatchEvent(new KeyboardEvent('keyup', fields));
      if (allowed && held?.space && held.element === element && element?.isConnected && !disabled(element) && spaceActivates(element)) element.click();
      return;
    }
    if (!keys.has(command.code)) keys.set(command.code, { element, fields });
    if (element && !element.dispatchEvent(new KeyboardEvent('keydown', fields))) return;
    if (disabled(element)) return;
    const plain = !fields.ctrlKey && !fields.metaKey && !fields.altKey;
    if (plain && command.key === ' ' && spaceActivates(element)) { keys.get(command.code)!.space = true; return; }
    if (plain && !fields.shiftKey && selectionKey(element, command.key)) return;
    if (command.key === 'Tab') {
      const elements = Array.from(document.querySelectorAll<HTMLElement>('a[href],button,input,textarea,select,[tabindex],[contenteditable="true"]')).filter(e => e.tabIndex >= 0 && !e.matches(':disabled,[hidden]') && e.getClientRects().length);
      const index = elements.indexOf(element as HTMLElement);
      elements[(index + (fields.shiftKey ? -1 : 1) + elements.length) % elements.length]?.focus(); return;
    }
    if (editable(element)) {
      const start = element.selectionStart ?? element.value.length, end = element.selectionEnd ?? start;
      if ((fields.ctrlKey || fields.metaKey) && command.key.toLowerCase() === 'a') { element.select(); return; }
      if (command.key === 'Backspace' || command.key === 'Delete') {
        const before = Array.from(element.value.slice(0, start)).at(-1)?.length ?? 0;
        const after = Array.from(element.value.slice(end))[0]?.length ?? 0;
        insert('', command.key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward', start === end && command.key === 'Backspace' ? start - before : start, start === end && command.key === 'Delete' ? end + after : end); return;
      }
      if (command.key === 'Enter') {
        if (element instanceof HTMLTextAreaElement) insert('\n', 'insertLineBreak');
        else implicitSubmit(element);
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(command.key)) {
        const position = command.key === 'Home' ? 0 : command.key === 'End' ? element.value.length : command.key === 'ArrowLeft' ? Math.max(0, start - (Array.from(element.value.slice(0, start)).at(-1)?.length ?? 0)) : Math.min(element.value.length, end + (Array.from(element.value.slice(end))[0]?.length ?? 0));
        try { element.setSelectionRange(fields.shiftKey ? Math.min(start, position) : position, fields.shiftKey ? Math.max(end, position) : position); } catch { /* unsupported field */ }
      }
    } else if (element instanceof HTMLElement && element.isContentEditable) {
      if (command.key === 'Enter') document.execCommand('insertLineBreak');
      if (command.key === 'Backspace') document.execCommand('delete');
      if (command.key === 'Delete') document.execCommand('forwardDelete');
      if ((fields.ctrlKey || fields.metaKey) && command.key.toLowerCase() === 'a') document.execCommand('selectAll');
    } else if (plain && command.key === 'Enter') {
      if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) implicitSubmit(element);
      else if (element instanceof HTMLElement && element.matches('button,input[type="button"],input[type="submit"],input[type="reset"],a[href],summary')) element.click();
    }
  }
  const listener = (message: Record<string, any>, sender: chrome.runtime.MessageSender, respond: (result: unknown) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.target !== 'ghostpair.dom' || message.captureId !== context.captureId) return;
    try {
      if (message.generation !== undefined && message.generation !== context.generation) throw new Error('The shared page changed. Wait for the current view.');
      if (message.operation === 'configure') { configure(message.configuration); respond({ ok: true }); return; }
      if (message.controlRevision !== undefined && message.controlRevision !== configuration.revision) throw new Error('The interaction mode changed.');
      if (message.operation === 'dispose') { dispose(); respond({ ok: true }); return; }
      if (message.operation === 'release') { release(); respond({ ok: true }); return; }
      if (message.operation === 'visual.clear') { release(); clearVisual(); respond({ ok: true }); return; }
      if (!context.ready || message.generation !== context.generation) throw new Error('The shared page changed. Wait for the current view.');
      if (message.operation === 'visual.notice') { showNotice(message.kind); respond({ ok: true }); return; }
      if (message.operation === 'virtual.focus') { const pending = verify(message.token); setVirtualFocus(pending.element); respond({ ok: true }); return; }
      if (message.operation === 'describe') { respond({ ok: true, index: root ? -1 : frameIndex(window.parent, window), ...geometry() }); return; }
      if (message.operation === 'prepare') { respond({ ok: true, ...prepare(message.command) }); return; }
      if (message.operation === 'verify') { verify(message.token); respond({ ok: true }); return; }
      if (message.operation === 'commit') {
        if (message.indices) {
          const indices: number[] = [];
          for (let current: Window = window; current !== current.top; current = current.parent) {
            if (indices.length >= 32) throw new Error('The embedded page changed. Try the action again.');
            indices.unshift(frameIndex(current.parent, current));
          }
          if (JSON.stringify(indices) !== JSON.stringify(message.indices)) throw new Error('The embedded page changed. Try the action again.');
        }
        const pending = verify(message.token); prepared = undefined;
        if (pending.child) throw new Error('The embedded page is not ready for control.');
        const visualActivity = execute(pending.command); respond({ ok: true, visualActivity }); return;
      }
      if (message.operation !== 'command') throw new Error('Unknown page control operation.');
      const visualActivity = execute(message.command); respond({ ok: true, visualActivity });
    } catch (error) { respond({ ok: false, error: (error as Error).message }); }
  };
  function changed() {
    const current = geometry(); if (JSON.stringify(current) === context.geometry) return;
    context.geometry = JSON.stringify(current); release();
    if (root) {
      context.ready = false;
      void chrome.runtime.sendMessage({ target: 'background', type: 'dom.geometry', captureId: context.captureId, generation: context.generation, geometry: current }).catch(() => undefined);
    }
  }
  function dispose() {
    release(); clearVisual(); chrome.runtime.onMessage.removeListener(listener);
    window.removeEventListener('resize', changed); visualViewport?.removeEventListener('resize', changed); visualViewport?.removeEventListener('scroll', changed);
    delete scope.__ghostpairControl;
  }
  chrome.runtime.onMessage.addListener(listener);
  window.addEventListener('resize', changed); visualViewport?.addEventListener('resize', changed); visualViewport?.addEventListener('scroll', changed);
  return geometry();
}
