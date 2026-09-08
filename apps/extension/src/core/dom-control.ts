import type { ControlCommand } from '@ghostpair/protocol';

/** Self-contained: Chrome serializes this function into the page's ISOLATED world. */
export function installDomControl(captureId: string, generation: number, root = true) {
  type Context = { captureId: string; generation: number; ready: boolean; geometry: string; dispose: () => void; release: () => void };
  const scope = globalThis as typeof globalThis & { __ghostpairControl?: Context };
  const geometry = () => ({ viewportWidth: innerWidth, viewportHeight: innerHeight, offsetLeft: visualViewport?.offsetLeft ?? 0, offsetTop: visualViewport?.offsetTop ?? 0, scale: visualViewport?.scale ?? 1 });
  if (scope.__ghostpairControl) {
    scope.__ghostpairControl.release();
    scope.__ghostpairControl.captureId = captureId;
    scope.__ghostpairControl.generation = generation;
    scope.__ghostpairControl.ready = true;
    scope.__ghostpairControl.geometry = JSON.stringify(geometry());
    return geometry();
  }
  let down: Element | null = null;
  let downFields: MouseEventInit = {};
  const keys = new Map<string, { element: Element | null; fields: KeyboardEventInit }>();
  type Prepared = { token: string; command: ControlCommand; element: Element | null; child?: { index: number; x?: number; y?: number }; childWindow?: Window | null };
  let prepared: Prepared | undefined;
  const context: Context = { captureId, generation, ready: true, geometry: JSON.stringify(geometry()), dispose, release };
  scope.__ghostpairControl = context;

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
  function insert(text: string, inputType = 'insertText', start?: number, end?: number) {
    const element = focused();
    if (!(element instanceof HTMLElement)) throw new Error('Focus a text field before typing.');
    if (editable(element)) {
      if (element.disabled || element.readOnly) throw new Error('This text field cannot be edited.');
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
    if (down) {
      down.dispatchEvent(new PointerEvent('pointerup', { ...downFields, buttons: 0, pointerId: 1, pointerType: 'mouse' }));
      down.dispatchEvent(new MouseEvent('mouseup', { ...downFields, buttons: 0 }));
    }
    down = null;
    for (const { element, fields } of keys.values()) element?.dispatchEvent(new KeyboardEvent('keyup', fields));
    keys.clear();
  }
  function execute(command: ControlCommand) {
    if (command.type === 'pointer') {
      const element = targetAt(command.x, command.y);
      if (!element) { if (command.event === 'up') release(); return; }
      const fields = { bubbles: true, cancelable: true, composed: true, clientX: command.x, clientY: command.y, detail: command.clickCount, button: command.button === 'left' ? 0 : command.button === 'middle' ? 1 : 2, buttons: command.buttons, ctrlKey: Boolean(command.modifiers & 2), shiftKey: Boolean(command.modifiers & 8), altKey: Boolean(command.modifiers & 1), metaKey: Boolean(command.modifiers & 4) };
      const name = command.event === 'down' ? 'down' : command.event === 'up' ? 'up' : 'move';
      const recipient = command.event === 'up' && down ? down : element;
      const allowed = recipient.dispatchEvent(new PointerEvent(`pointer${name}`, { ...fields, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      const mouseAllowed = recipient.dispatchEvent(new MouseEvent(`mouse${name}`, fields));
      if (command.event === 'down') {
        down = allowed && mouseAllowed ? element : null;
        downFields = fields;
        if (down) (down.closest('input,textarea,button,select,a,[tabindex],[contenteditable]') as HTMLElement | null)?.focus({ preventScroll: true });
      }
      if (command.event === 'up') {
        const clicked = down; down = null;
        if (clicked === element && allowed && mouseAllowed) {
          if (command.button === 'left' && !element.closest(':disabled')) {
            element.dispatchEvent(new MouseEvent('click', fields));
            if (command.clickCount === 2) element.dispatchEvent(new MouseEvent('dblclick', { ...fields, detail: 2 }));
          } else if (command.button === 'right') element.dispatchEvent(new MouseEvent('contextmenu', fields));
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
    if (command.type === 'text') { insert(command.text); return; }
    if (command.type !== 'key') throw new Error('This operation is handled by the extension.');
    const element = focused();
    const fields = { key: command.key, code: command.code, repeat: command.repeat, bubbles: true, cancelable: true, composed: true, ctrlKey: Boolean(command.modifiers & 2), shiftKey: Boolean(command.modifiers & 8), altKey: Boolean(command.modifiers & 1), metaKey: Boolean(command.modifiers & 4) };
    if (command.event === 'up') { const held = keys.get(command.code); keys.delete(command.code); held?.element?.dispatchEvent(new KeyboardEvent('keyup', fields)); return; }
    if (!keys.has(command.code)) keys.set(command.code, { element, fields });
    if (element && !element.dispatchEvent(new KeyboardEvent('keydown', fields))) return;
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
        else element.form?.requestSubmit();
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
    } else if (command.key === 'Enter' && element instanceof HTMLElement) element.click();
  }
  const listener = (message: Record<string, any>, sender: chrome.runtime.MessageSender, respond: (result: unknown) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.target !== 'ghostpair.dom' || message.captureId !== context.captureId) return;
    try {
      if (message.generation !== undefined && message.generation !== context.generation) throw new Error('The shared page changed. Wait for the current view.');
      if (message.operation === 'dispose') { dispose(); respond({ ok: true }); return; }
      if (message.operation === 'release') { release(); respond({ ok: true }); return; }
      if (!context.ready || message.generation !== context.generation) throw new Error('The shared page changed. Wait for the current view.');
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
        execute(pending.command); respond({ ok: true }); return;
      }
      if (message.operation !== 'command') throw new Error('Unknown page control operation.');
      execute(message.command); respond({ ok: true });
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
    release(); chrome.runtime.onMessage.removeListener(listener);
    window.removeEventListener('resize', changed); visualViewport?.removeEventListener('resize', changed); visualViewport?.removeEventListener('scroll', changed);
    delete scope.__ghostpairControl;
  }
  chrome.runtime.onMessage.addListener(listener);
  window.addEventListener('resize', changed); visualViewport?.addEventListener('resize', changed); visualViewport?.addEventListener('scroll', changed);
  return geometry();
}
