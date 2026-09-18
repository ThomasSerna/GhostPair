import type { ControlCommand, ControlConfiguration, VisualActivity, VisualCategory } from '@ghostpair/protocol';

/** Self-contained: Chrome serializes this function into the page's ISOLATED world. */
export function installDomControl(captureId: string, generation: number, root = true, configuration: ControlConfiguration = { mode: 'visual', revision: 0, preferences: { notices: false, text: { duration: 'persistent', seconds: 10 }, other: { duration: 'persistent', seconds: 3 }, accentColor: '#7871e8' } }) {
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
  type Preview = { id: string; revision: number; editor?: HTMLInputElement | HTMLTextAreaElement; composing?: boolean; selecting?: boolean; node: HTMLDivElement; marker?: HTMLDivElement; cursor?: HTMLSpanElement; value?: string; anchor: number; caret: number; checked?: boolean; radio?: boolean; until?: number };
  const previews = new Map<HTMLElement, Preview>();
  const editors = new WeakMap<Element, HTMLElement>();
  const deferredInput: { command: ControlCommand; respond: (result: unknown) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  let dragging: { token: string; element: HTMLElement; start: number; end: number; revision: number; timer: ReturnType<typeof setTimeout> } | undefined;
  let dropping = false;
  const randomToken = () => {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  };
  const dragMime = 'application/x-ghostpair-text';
  function local(operation: string, fields: object = {}): Promise<any> {
    return chrome.runtime.sendMessage({ target: 'background', type: 'dom.visual', captureId: context.captureId, generation: context.generation, controlRevision: configuration.revision, operation, ...fields });
  }
  function localActivity(kind: VisualActivity['kind'] = 'focus') {
    void local('activity', { activity: { category: 'text', kind } }).catch(() => undefined);
  }
  function endDrag() {
    if (dragging) { clearTimeout(dragging.timer); const preview = previews.get(dragging.element); if (preview) preview.selecting = false; }
    dragging = undefined;
  }
  function cancelDeferred() {
    for (const pending of deferredInput.splice(0)) { clearTimeout(pending.timer); pending.respond({ ok: false, error: 'The simulated editor changed. Try again.' }); }
  }
  function flushDeferred() {
    for (const pending of deferredInput.splice(0)) {
      clearTimeout(pending.timer);
      try { pending.respond({ ok: true, visualActivity: execute(pending.command) }); }
      catch (error) { pending.respond({ ok: false, error: (error as Error).message }); }
    }
  }
  function runCommand(command: ControlCommand, respond: (result: unknown) => void) {
    if (configuration.mode === 'visual' && virtualFocus instanceof HTMLElement && previews.get(virtualFocus)?.composing) {
      if (deferredInput.length >= 64) throw new Error('Finish composing before more remote input.');
      const pending = { command, respond, timer: setTimeout(() => {
        const index = deferredInput.indexOf(pending);
        if (index >= 0) { deferredInput.splice(index, 1); respond({ ok: false, error: 'Finish composing before more remote input.' }); }
      }, 5000) };
      deferredInput.push(pending); return true;
    }
    respond({ ok: true, visualActivity: execute(command) }); return false;
  }
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
    layer.setAttribute('aria-label', 'GhostPair simulated fields');
    layer.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;pointer-events:none!important;overflow:hidden!important;contain:strict!important;';
    updateAccent();
    shadow = layer.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{pointer-events:none!important}*{box-sizing:border-box;pointer-events:none!important;user-select:none}div{position:absolute;margin:0}input[data-gp-editor],textarea[data-gp-editor]{box-sizing:border-box;pointer-events:auto!important;user-select:text!important;position:absolute;margin:0;resize:none;outline:none}input[data-gp-editor]::selection,textarea[data-gp-editor]::selection{background:var(--gp-accent);color:white}';
    shadow.append(style);
    document.documentElement.append(layer);
  }
  function node() { ensureLayer(); const result = document.createElement('div'); shadow!.append(result); return result; }
  function scheduleDraw() { if (drawing === undefined) drawing = requestAnimationFrame(draw); }
  function categoryFor(element: Element | null): VisualCategory {
    return element instanceof HTMLElement && (editable(element) || element.isContentEditable) ? 'text' : 'other';
  }
  function clearCategory(category: VisualCategory) {
    if (category === 'text' && (dragging || dropping || [...previews.values()].some(p => p.composing || p.selecting))) return true;
    for (const [element, preview] of previews) if ((preview.value !== undefined ? 'text' : 'other') === category) {
      preview.node.remove(); preview.marker?.remove(); preview.editor?.remove(); previews.delete(element);
    }
    if (virtualFocus && categoryFor(virtualFocus) === category) { virtualFocus = null; visualDown = null; visualKeys.clear(); focusMark?.remove(); focusMark = undefined; }
    scheduleDraw();
  }
  function clearVisual() {
    cancelDeferred(); endDrag(); dropping = false;
    if (drawing !== undefined) cancelAnimationFrame(drawing);
    drawing = undefined; layer?.remove(); layer = undefined; shadow = undefined; focusMark = undefined; notice = undefined;
    previews.clear(); halos.length = 0; virtualFocus = null; visualDown = null; visualKeys.clear(); noticeUntil = 0; lastNotice = -Infinity;
  }
  function rectStyle(element: Element, overlay: HTMLElement) {
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
  function scaled(value: string, scale: number) {
    return value.replace(/(-?[\d.]+)px/g, (_, number) => `${Number(number) * scale}px`);
  }
  function surfaceStyle(element: Element, box: DOMRect, style: CSSStyleDeclaration) {
    const width = parseFloat(style.width) + (style.boxSizing === 'border-box' ? 0 : parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth));
    const height = parseFloat(style.height) + (style.boxSizing === 'border-box' ? 0 : parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth));
    const sx = box.width / (width || (element instanceof HTMLElement ? element.offsetWidth : 0) || box.width || 1);
    const sy = box.height / (height || (element instanceof HTMLElement ? element.offsetHeight : 0) || box.height || 1);
    const radius = (value: string) => {
      const [x, y = x] = value.split(' ');
      return `${scaled(x!, sx)} ${scaled(y!, sy)}`;
    };
    return {
      borderTop: `${scaled(style.borderTopWidth, sy)} ${style.borderTopStyle} ${style.borderTopColor}`,
      borderRight: `${scaled(style.borderRightWidth, sx)} ${style.borderRightStyle} ${style.borderRightColor}`,
      borderBottom: `${scaled(style.borderBottomWidth, sy)} ${style.borderBottomStyle} ${style.borderBottomColor}`,
      borderLeft: `${scaled(style.borderLeftWidth, sx)} ${style.borderLeftStyle} ${style.borderLeftColor}`,
      borderTopLeftRadius: radius(style.borderTopLeftRadius), borderTopRightRadius: radius(style.borderTopRightRadius),
      borderBottomLeftRadius: radius(style.borderBottomLeftRadius), borderBottomRightRadius: radius(style.borderBottomRightRadius),
      paddingTop: scaled(style.paddingTop, sy), paddingRight: scaled(style.paddingRight, sx),
      paddingBottom: scaled(style.paddingBottom, sy), paddingLeft: scaled(style.paddingLeft, sx),
      fontFamily: style.fontFamily, fontSize: scaled(style.fontSize, sy), fontWeight: style.fontWeight,
      fontStyle: style.fontStyle, fontVariant: style.fontVariant, lineHeight: scaled(style.lineHeight, sy),
      letterSpacing: scaled(style.letterSpacing, sx), wordSpacing: scaled(style.wordSpacing, sx),
      textAlign: style.textAlign, textTransform: style.textTransform, textIndent: scaled(style.textIndent, sx),
      direction: style.direction, color: style.color,
    };
  }
  // Composite translucent solid backgrounds without copying page DOM or fetching images.
  function effectiveBackground(element: Element) {
    const layers: string[] = [];
    for (let current: Element | null = element; current; current = parent(current)) {
      const color = getComputedStyle(current).backgroundColor;
      const alpha = color === 'transparent' ? 0 : color.startsWith('rgba(') ? parseFloat(color.split(',')[3]!) : color.includes('/') ? parseFloat(color.split('/')[1]!) : 1;
      if (alpha >= 1) return { backgroundColor: color, backgroundImage: layers.join(',') || 'none' };
      if (alpha > 0) layers.push(`linear-gradient(${color},${color})`);
    }
    const scheme = getComputedStyle(element).colorScheme;
    const dark = scheme.includes('dark') && (!scheme.includes('light') || matchMedia('(prefers-color-scheme: dark)').matches);
    return { backgroundColor: dark ? '#121212' : '#fff', backgroundImage: layers.join(',') || 'none' };
  }
  function visibleSurface(element: Element) {
    const box = element.getBoundingClientRect();
    if (box.width < 3 || box.height < 3 || !element.getClientRects().length) return false;
    for (let current: Element | null = element; current; current = parent(current)) {
      const css = getComputedStyle(current);
      if (css.visibility === 'hidden' || css.display === 'none' || Number(css.opacity) === 0 || css.clipPath === 'inset(50%)') return false;
    }
    return true;
  }
  const choices = 'input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="radio"]';
  function choiceSurface(element: HTMLElement): HTMLElement {
    if (element instanceof HTMLInputElement) {
      const label = Array.from(element.labels ?? []).find(label => visibleSurface(label) && label.querySelectorAll(choices).length <= 1);
      if (label) return label;
    }
    // Only adopt a nearby option with one control, never a form or a group.
    if (element.matches('[role="checkbox"],[role="radio"]') && element.textContent?.trim()) return element;
    let candidate = parent(element);
    for (let depth = 0; candidate instanceof HTMLElement && depth < 3; depth++, candidate = parent(candidate)) {
      if (candidate.matches('form,fieldset,body,html,[role="group"],[role="radiogroup"]')) break;
      if (candidate.querySelectorAll('input,textarea,select,button,a[href],[role="checkbox"],[role="radio"]').length !== 1) break;
      if (candidate.textContent?.trim() && visibleSurface(candidate)) return candidate;
    }
    return element;
  }
  function choiceIndicator(element: HTMLElement, surface: HTMLElement) {
    const small = (target: Element) => {
      const box = target.getBoundingClientRect();
      return box.width <= 48 && box.height <= 48 && box.width / box.height >= 0.6 && box.width / box.height <= 1.6 && visibleSurface(target);
    };
    if ((element instanceof HTMLInputElement || !element.textContent?.trim()) && small(element)) return element;
    const candidates = Array.from(surface.querySelectorAll<Element>('span[aria-hidden="true"],i[aria-hidden="true"],div[aria-hidden="true"],span:empty,i:empty,div:empty,svg[aria-hidden="true"]')).filter(target => {
      if (!small(target) || target.textContent?.trim()) return false;
      const css = getComputedStyle(target), box = target.getBoundingClientRect(), bounds = surface.getBoundingClientRect();
      return box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom && (target instanceof SVGElement || parseFloat(css.borderTopWidth) > 0 || css.backgroundColor !== 'rgba(0, 0, 0, 0)');
    });
    const leaves = candidates.filter(candidate => !candidates.some(other => other !== candidate && candidate.contains(other)));
    return leaves.length === 1 ? leaves[0] : undefined;
  }
  function paintOutline(element: Element, overlay: HTMLDivElement, selected: boolean, tint: number) {
    const { box, style } = rectStyle(element, overlay);
    const profile = surfaceStyle(element, box, style);
    Object.assign(overlay.style, {
      borderTopLeftRadius: profile.borderTopLeftRadius, borderTopRightRadius: profile.borderTopRightRadius,
      borderBottomLeftRadius: profile.borderBottomLeftRadius, borderBottomRightRadius: profile.borderBottomRightRadius,
      border: selected ? '2px solid var(--gp-accent)' : '0',
      background: selected ? `color-mix(in srgb,var(--gp-accent) ${tint}%,transparent)` : 'transparent',
      boxShadow: selected ? `inset 0 0 0 1px color-mix(in srgb,${style.color} 20%,transparent)` : 'none',
    });
  }
  function paintChoice(element: HTMLElement, preview: Preview) {
    const surface = choiceSurface(element), indicator = choiceIndicator(element, surface);
    preview.node.style.display = 'none';
    if (!indicator) { preview.marker?.remove(); preview.marker = undefined; return; }
    preview.marker ??= node();
    const { box, style } = rectStyle(indicator, preview.marker);
    const profile = surfaceStyle(indicator, box, style);
    Object.assign(preview.marker.style, profile, effectiveBackground(indicator), {
      padding: '0', border: '2px solid var(--gp-accent)',
      boxShadow: `inset 0 0 0 1px color-mix(in srgb,${style.color} 20%,transparent)`,
    });
    if (preview.radio) preview.marker.style.borderRadius = '50%';
    else if (![style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].some(value => parseFloat(value))) preview.marker.style.borderRadius = '3px';
    let mark = preview.marker.firstElementChild as HTMLSpanElement | null;
    if (!mark) { mark = document.createElement('span'); preview.marker.append(mark); }
    mark.style.cssText = preview.radio
      ? 'position:absolute;inset:22%;border-radius:50%;background:var(--gp-accent)'
      : 'position:absolute;left:30%;top:10%;width:32%;height:60%;border:solid var(--gp-accent);border-width:0 2px 2px 0;transform:rotate(45deg)';
    mark.style.display = preview.checked ? 'block' : 'none';
  }
  function draw(time: number) {
    drawing = undefined;
    if (!layer) return;
    if (time - drawnAt < 32) { scheduleDraw(); return; }
    drawnAt = time; ensureLayer();
    if (virtualFocus && !virtualFocus.isConnected) virtualFocus = null;
    for (const [element, preview] of previews) {
      if (!element.isConnected || preview.until !== undefined && time >= preview.until) { preview.node.remove(); preview.marker?.remove(); preview.editor?.remove(); previews.delete(element); continue; }
      if (preview.checked !== undefined) { paintChoice(element, preview); continue; }
      if (preview.value !== undefined) {
        const { box, style } = rectStyle(element, preview.node);
        Object.assign(preview.node.style, surfaceStyle(element, box, style), effectiveBackground(element), { whiteSpace: element instanceof HTMLInputElement ? 'pre' : 'pre-wrap', overflowWrap: 'anywhere', overflow: 'hidden' });
        if (preview.editor) {
          rectStyle(element, preview.editor);
          Object.assign(preview.editor.style, surfaceStyle(element, box, style), effectiveBackground(element));
          preview.editor.style.opacity = shadow?.activeElement === preview.editor ? '1' : '0';
          preview.editor.readOnly = disabled(element) || editable(element) && element.readOnly;
        }
        // Scroll only the extension's text surface, never the real field/page.
        if (preview.cursor && virtualFocus === element) {
          const cursor = preview.cursor.getBoundingClientRect(), inset = 4;
          if (cursor.right > box.right - inset) preview.node.scrollLeft += cursor.right - box.right + inset;
          else if (cursor.left < box.left + inset) preview.node.scrollLeft -= box.left + inset - cursor.left;
          if (cursor.bottom > box.bottom - inset) preview.node.scrollTop += cursor.bottom - box.bottom + inset;
          else if (cursor.top < box.top + inset) preview.node.scrollTop -= box.top + inset - cursor.top;
        }
      } else paintOutline(element, preview.node, true, 18);
    }
    const paintFocus = virtualFocus instanceof HTMLElement && !(virtualFocus instanceof HTMLIFrameElement || virtualFocus instanceof HTMLFrameElement) && !disabled(virtualFocus);
    if (paintFocus && virtualFocus instanceof HTMLElement) {
      const indicator = virtualFocus.matches(choices) ? choiceIndicator(virtualFocus, choiceSurface(virtualFocus)) : virtualFocus;
      if (indicator) { focusMark ??= node(); paintOutline(indicator, focusMark, true, 0); }
      else { focusMark?.remove(); focusMark = undefined; }
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
      preview = { id: randomToken(), revision: 0, node: node(), anchor: 0, caret: 0 }; previews.set(element, preview);
    }
    scheduleDraw(); return preview;
  }
  function textPreview(element: HTMLElement) {
    const preview = previewFor(element);
    if (preview.value === undefined) { preview.value = editable(element) ? element.value : element.innerText; preview.anchor = preview.caret = preview.value.length; }
    if (!preview.editor) makeEditor(element, preview);
    return preview;
  }
  function selectionFromEditor(preview: Preview) {
    const editor = preview.editor!;
    const start = editor.selectionStart ?? 0, end = editor.selectionEnd ?? start;
    preview.anchor = editor.selectionDirection === 'backward' ? end : start;
    preview.caret = editor.selectionDirection === 'backward' ? start : end;
  }
  function commitEditor(element: HTMLElement, preview: Preview) {
    const editor = preview.editor!;
    if (editor.readOnly || new TextEncoder().encode(editor.value).length > 256 * 1024) {
      editor.value = preview.value ?? ''; selectionFromEditor(preview); paintText(element, preview); return;
    }
    if (preview.value !== editor.value) { preview.value = editor.value; preview.revision++; }
    selectionFromEditor(preview); paintText(element, preview); localActivity('typing');
  }
  function makeEditor(element: HTMLElement, preview: Preview) {
    const editor = element instanceof HTMLInputElement ? document.createElement('input') : document.createElement('textarea');
    if (editor instanceof HTMLInputElement) editor.type = element instanceof HTMLInputElement && element.type === 'password' ? 'password' : 'text';
    editor.dataset.gpEditor = preview.id;
    editor.setAttribute('aria-label', `Simulated ${element.getAttribute('aria-label') || element.getAttribute('placeholder') || 'text'}`);
    editor.autocomplete = 'off'; editor.spellcheck = false; editor.tabIndex = -1;
    editor.style.cssText = 'all:initial;position:absolute;box-sizing:border-box;margin:0;opacity:0;';
    editor.value = preview.value ?? '';
    editor.readOnly = disabled(element) || editable(element) && element.readOnly;
    preview.editor = editor; editors.set(editor, element); shadow!.append(editor);
    editor.addEventListener('focus', () => { selectionFromEditor(preview); paintText(element, preview); localActivity(); scheduleDraw(); });
    editor.addEventListener('blur', () => { preview.composing = false; preview.selecting = false; commitEditor(element, preview); flushDeferred(); scheduleDraw(); });
    editor.addEventListener('pointerdown', () => { preview.selecting = true; localActivity(); });
    editor.addEventListener('pointerup', () => { preview.selecting = false; selectionFromEditor(preview); paintText(element, preview); localActivity(); });
    editor.addEventListener('pointercancel', () => { preview.selecting = false; });
    editor.addEventListener('select', () => { selectionFromEditor(preview); localActivity(); });
    editor.addEventListener('keyup', () => { selectionFromEditor(preview); if (!preview.composing) paintText(element, preview); localActivity(); });
    editor.addEventListener('keydown', raw => {
      const event = raw as KeyboardEvent;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); editor.blur(); }
      if (event.key === 'Tab') {
        event.preventDefault();
        const fields = [...document.querySelectorAll<HTMLElement>('input,textarea,[contenteditable="true"]')].filter(e => (editable(e) || e.isContentEditable) && !disabled(e) && !(editable(e) && e.readOnly) && visibleSurface(e));
        const next = fields[(fields.indexOf(element) + (event.shiftKey ? -1 : 1) + fields.length) % fields.length];
        if (next) { const target = textPreview(next); paintText(next, target); draw(performance.now() + 40); target.editor!.focus({ preventScroll: true }); }
      }
      localActivity();
    });
    editor.addEventListener('input', () => commitEditor(element, preview));
    editor.addEventListener('compositionstart', () => { preview.composing = true; localActivity(); });
    editor.addEventListener('compositionend', () => { preview.composing = false; commitEditor(element, preview); flushDeferred(); });
    editor.addEventListener('scroll', () => { preview.node.scrollLeft = editor.scrollLeft; preview.node.scrollTop = editor.scrollTop; });
    for (const type of ['copy', 'cut', 'paste']) editor.addEventListener(type, raw => {
      const event = raw as ClipboardEvent;
      event.stopPropagation(); event.preventDefault(); localActivity();
      if (!event.clipboardData || preview.composing) return;
      if (type === 'paste') {
        if (editor.readOnly) return;
        let text = event.clipboardData.getData('text/plain');
        if (editor instanceof HTMLInputElement) text = text.replace(/[\r\n]/g, '');
        const start = editor.selectionStart ?? 0, end = editor.selectionEnd ?? start;
        if (new TextEncoder().encode(editor.value.slice(0, start) + text + editor.value.slice(end)).length > 256 * 1024) return;
        editor.setRangeText(text, start, end, 'end'); commitEditor(element, preview);
      } else {
        if (editor instanceof HTMLInputElement && editor.type === 'password') return;
        const start = editor.selectionStart ?? 0, end = editor.selectionEnd ?? start;
        event.clipboardData.setData('text/plain', editor.value.slice(start, end));
        if (type === 'cut' && !editor.readOnly) { editor.setRangeText('', start, end, 'end'); commitEditor(element, preview); }
      }
    });
    editor.addEventListener('dragstart', raw => {
      const event = raw as DragEvent;
      if (!event.isTrusted || !event.dataTransfer || editor.readOnly || editor instanceof HTMLInputElement && editor.type === 'password') { event.preventDefault(); return; }
      selectionFromEditor(preview);
      const start = Math.min(preview.anchor, preview.caret), end = Math.max(preview.anchor, preview.caret);
      if (start === end) { event.preventDefault(); return; }
      endDrag(); const token = randomToken();
      dragging = { token, element, start, end, revision: preview.revision, timer: setTimeout(endDrag, 30000) };
      event.dataTransfer.setData(dragMime, token);
      event.dataTransfer.setData('text/plain', preview.value!.slice(start, end));
      // The extension commits the move after the destination acknowledges insertion.
      // Native source deletion must never race that transaction.
      event.dataTransfer.effectAllowed = 'copy';
      void local('drag.start', { token }).catch(endDrag); localActivity();
    });
  }
  function dropOffset(preview: Preview, x: number, y: number) {
    const walker = document.createTreeWalker(preview.node, NodeFilter.SHOW_TEXT), range = document.createRange();
    let offset = 0, best = 0, distance = Infinity;
    const rtl = getComputedStyle(preview.node).direction === 'rtl';
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      const position = (index: number) => { range.setStart(text, index); range.setEnd(text, index); return range.getBoundingClientRect(); };
      let low = 0, high = text.length;
      while (low < high) {
        const middle = (low + high) >> 1, box = position(middle);
        if (box.bottom < y || box.top <= y && (rtl ? box.left > x : box.left < x)) low = middle + 1; else high = middle;
      }
      for (const index of [Math.max(0, low - 1), low]) {
        const box = position(index), dy = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
        const score = dy * 10000 + Math.abs(box.left - x);
        if (score < distance) { distance = score; best = offset + index; }
      }
      offset += text.length;
    }
    const value = preview.value ?? '';
    if (best > 0 && best < value.length && /[\uDC00-\uDFFF]/.test(value[best]!)) best--;
    return Math.min(value.length, best);
  }
  function endSelection() { for (const preview of previews.values()) preview.selecting = false; }
  function dragTarget(event: DragEvent) {
    if (configuration.mode !== 'visual' || !context.ready || !event.isTrusted || !event.dataTransfer?.types.includes(dragMime)) return;
    // A GhostPair drop must never fall through into an original page field.
    event.preventDefault(); event.stopImmediatePropagation();
    const element = semantic(targetAt(event.clientX, event.clientY));
    if (!element || !(editable(element) || element.isContentEditable) || disabled(element) || editable(element) && element.readOnly) return;
    const preview = textPreview(element); paintText(element, preview);
    event.dataTransfer.dropEffect = 'copy';
    if (event.type !== 'drop') return;
    const offset = dropOffset(preview, event.clientX, event.clientY);
    dropping = true;
    void local('drag.drop', { token: event.dataTransfer.getData(dragMime), targetId: preview.id, revision: preview.revision, offset, copy: event.ctrlKey || event.metaKey }).then(reply => {
      if (reply?.ok && preview.editor?.isConnected) preview.editor.focus({ preventScroll: true });
    }).catch(() => undefined).finally(() => { dropping = false; localActivity('typing'); });
  }
  function dragOperation(message: Record<string, any>) {
    if (configuration.mode !== 'visual') throw new Error('Simulation is unavailable.');
    const source = dragging && previews.get(dragging.element);
    if (message.operation === 'visual.drag.read') {
      if (!dragging || dragging.token !== message.token || !source || source.revision !== dragging.revision) throw new Error('The dragged text changed.');
      return { text: source.value!.slice(dragging.start, dragging.end), sourceId: source.id };
    }
    if (message.operation === 'visual.drag.delete') {
      if (!dragging || dragging.token !== message.token || !source || source.revision !== dragging.revision) return {};
      source.value = source.value!.slice(0, dragging.start) + source.value!.slice(dragging.end);
      source.anchor = source.caret = dragging.start; source.revision++; paintText(dragging.element, source); endDrag(); return {};
    }
    if (message.operation === 'visual.drag.finish') { if (dragging?.token === message.token) endDrag(); return {}; }
    const entry = [...previews].find(([, p]) => p.id === message.targetId);
    if (!entry) throw new Error('The destination changed.');
    const [element, preview] = entry;
    if (!element.isConnected || disabled(element) || editable(element) && element.readOnly || preview.composing || preview.revision !== message.revision || !Number.isInteger(message.offset) || message.offset < 0 || message.offset > preview.value!.length) throw new Error('The destination changed.');
    let value = preview.value!, offset = message.offset;
    if (message.operation === 'visual.drag.move') {
      if (!dragging || dragging.token !== message.token || source !== preview || source.revision !== dragging.revision) throw new Error('The dragged text changed.');
      if (offset >= dragging.start && offset <= dragging.end) { endDrag(); return {}; }
      value = value.slice(0, dragging.start) + value.slice(dragging.end);
      if (offset > dragging.end) offset -= dragging.end - dragging.start;
    }
    const text = typeof message.text === 'string' && element instanceof HTMLInputElement ? message.text.replace(/[\r\n]/g, '') : message.text;
    const next = value.slice(0, offset) + text + value.slice(offset);
    if (typeof message.text !== 'string' || new TextEncoder().encode(next).length > 256 * 1024) throw new Error('Simulated text exceeds the limit.');
    preview.value = next; preview.revision++; preview.anchor = preview.caret = offset + text.length;
    paintText(element, preview); if (message.operation === 'visual.drag.move') endDrag(); return {};
  }
  function paintText(element: HTMLElement, preview: Preview) {
    if (preview.editor && !preview.composing) {
      if (preview.editor.value !== preview.value) preview.editor.value = preview.value ?? '';
      const start = Math.min(preview.anchor, preview.caret), end = Math.max(preview.anchor, preview.caret), direction = preview.caret < preview.anchor ? 'backward' : 'forward';
      if (preview.editor.selectionStart !== start || preview.editor.selectionEnd !== end || preview.editor.selectionDirection !== direction) preview.editor.setSelectionRange(start, end, direction);
    }
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
    const preview = previewFor(element); preview.checked = checked; preview.radio = radio;
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
      const group = isRadio && element.closest('[role="radiogroup"]');
      if (group) for (const other of group.querySelectorAll<HTMLElement>('[role="radio"]')) {
        if (other !== element && other.closest('[role="radiogroup"]') === group) markChecked(other, false, true);
      }
      markChecked(element, isRadio || !(previews.get(element)?.checked ?? element.getAttribute('aria-checked') === 'true'), isRadio);
    } else if (element.matches('button,a[href],input[type="button"],input[type="submit"],input[type="reset"],[role="button"]')) {
      const preview = previewFor(element); preview.until = performance.now() + 180;
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
    preview.value = next; preview.revision++; preview.anchor = preview.caret = start + text.length; paintText(element, preview); return 'typing';
  }
  function executeVisual(command: ControlCommand): string | undefined {
    if (command.type === 'pointer') {
      if (command.event === 'move') return;
      const hit = targetAt(command.x, command.y);
      if (command.event === 'down') { visualDown = hit; visualButton = command.button; setVirtualFocus(semantic(hit)); return 'focus'; }
      const clicked = hit && visualButton === command.button ? commonAncestor(visualDown, hit) : null; visualDown = null;
      if (!hit || !clicked) return;
      const element = semantic(clicked);
      if (!element?.matches(choices)) halo(command.x, command.y);
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
    if (element === layer) { const inside = shadow?.elementFromPoint(x, y); return inside ? editors.get(inside) ?? null : null; }
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
    prepared = { token: randomToken(), command, element, child, childWindow: child ? (element as HTMLIFrameElement).contentWindow : undefined };
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
    cancelDeferred(); endDrag();
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
    if (configuration.mode === 'visual' && command.type !== 'wheel') {
      const kind = executeVisual(command) as VisualActivity['kind'] | undefined;
      return kind ? { category: categoryFor(virtualFocus), kind } satisfies VisualActivity : undefined;
    }
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
      if (message.operation === 'visual.clear') { const protectedPreview = message.category === 'text' || message.category === 'other' ? clearCategory(message.category) : (release(), clearVisual(), false); respond({ ok: true, protected: Boolean(protectedPreview) }); return; }
      if (!context.ready || message.generation !== context.generation) throw new Error('The shared page changed. Wait for the current view.');
      if (message.operation?.startsWith('visual.drag.')) { respond({ ok: true, ...dragOperation(message) }); return; }
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
        return runCommand(pending.command, respond);
      }
      if (message.operation !== 'command') throw new Error('Unknown page control operation.');
      return runCommand(message.command, respond);
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
    window.removeEventListener('pointerup', endSelection, true); window.removeEventListener('pointercancel', endSelection, true);
    for (const type of ['dragenter', 'dragover', 'drop']) window.removeEventListener(type, dragTarget as EventListener, true);
    window.removeEventListener('resize', changed); visualViewport?.removeEventListener('resize', changed); visualViewport?.removeEventListener('scroll', changed);
    delete scope.__ghostpairControl;
  }
  chrome.runtime.onMessage.addListener(listener);
  window.addEventListener('pointerup', endSelection, true); window.addEventListener('pointercancel', endSelection, true);
  for (const type of ['dragenter', 'dragover', 'drop']) window.addEventListener(type, dragTarget as EventListener, true);
  window.addEventListener('resize', changed); visualViewport?.addEventListener('resize', changed); visualViewport?.addEventListener('scroll', changed);
  return geometry();
}
