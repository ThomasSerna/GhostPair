import type { ControlCommand } from '@ghostpair/protocol';

/** Self-contained: Chrome serializes this function into the page's ISOLATED world. */
export function installDomControl(captureId: string, generation: number) {
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
  const keys = new Map<string, KeyboardEventInit>();
  const context: Context = { captureId, generation, ready: true, geometry: JSON.stringify(geometry()), dispose, release };
  scope.__ghostpairControl = context;

  function targetAt(x: number, y: number): Element | null {
    let element = document.elementFromPoint(x, y);
    while (element?.shadowRoot) {
      const inner = element.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === element) break;
      element = inner;
    }
    if (element?.tagName === 'IFRAME' || element?.tagName === 'CANVAS') throw new Error('This embedded surface does not support DOM control.');
    return element;
  }
  function focused(): Element | null {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
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
    if (down) {
      down.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse' }));
      down.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }
    down = null;
    for (const fields of keys.values()) focused()?.dispatchEvent(new KeyboardEvent('keyup', fields));
    keys.clear();
  }
  function execute(command: ControlCommand) {
    if (command.type === 'pointer') {
      const element = targetAt(command.x, command.y);
      if (!element) return;
      const fields = { bubbles: true, cancelable: true, composed: true, clientX: command.x, clientY: command.y, button: command.button === 'left' ? 0 : command.button === 'middle' ? 1 : 2, buttons: command.buttons, ctrlKey: Boolean(command.modifiers & 2), shiftKey: Boolean(command.modifiers & 8), altKey: Boolean(command.modifiers & 1), metaKey: Boolean(command.modifiers & 4) };
      const name = command.event === 'down' ? 'down' : command.event === 'up' ? 'up' : 'move';
      const allowed = element.dispatchEvent(new PointerEvent(`pointer${name}`, { ...fields, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      const mouseAllowed = element.dispatchEvent(new MouseEvent(`mouse${name}`, fields));
      if (command.event === 'down') {
        down = allowed && mouseAllowed ? element : null;
        if (down instanceof HTMLElement) (down.closest('input,textarea,button,select,a,[tabindex],[contenteditable]') as HTMLElement | null)?.focus({ preventScroll: true });
      }
      if (command.event === 'up') {
        const clicked = down; down = null;
        if (clicked === element && allowed && mouseAllowed) {
          if (command.button === 'left' && element instanceof HTMLElement) {
            element.click();
            if (command.clickCount === 2) element.dispatchEvent(new MouseEvent('dblclick', { ...fields, detail: 2 }));
          } else if (command.button === 'right') element.dispatchEvent(new MouseEvent('contextmenu', fields));
          else throw new Error('Middle-click browser actions require the host.');
        }
      }
      return;
    }
    if (command.type === 'wheel') {
      let element = targetAt(command.x, command.y);
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
    if (command.event === 'up') { keys.delete(command.code); element?.dispatchEvent(new KeyboardEvent('keyup', fields)); return; }
    keys.set(command.code, fields);
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
      if (message.operation === 'dispose') { dispose(); respond({ ok: true }); return; }
      if (message.operation === 'release') { release(); respond({ ok: true }); return; }
      if (!context.ready || message.generation !== context.generation) throw new Error('The shared page changed. Wait for the current view.');
      execute(message.command); respond({ ok: true });
    } catch (error) { respond({ ok: false, error: (error as Error).message }); }
  };
  function changed() {
    const current = geometry(); if (JSON.stringify(current) === context.geometry) return;
    context.ready = false; release();
    void chrome.runtime.sendMessage({ target: 'background', type: 'dom.geometry', captureId: context.captureId, generation: context.generation, geometry: current }).catch(() => undefined);
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
