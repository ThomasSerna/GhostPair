import { afterEach, expect, it, vi } from 'vitest';
import type { ControlCommand } from '@ghostpair/protocol';
import { InputBuffer } from './input-buffer';

const target = { tabId: 1, captureId: 'capture', documentId: 'document', generation: 3 };
const move = (x: number): ControlCommand => ({ type: 'pointer', controlRevision: 0, ...target, event: 'move', x, y: 20, button: 'left', buttons: 1, modifiers: 0, clickCount: 0 });
function harness() {
  const callbacks = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  const emit = vi.fn(), buffer = new InputBuffer(emit);
  return { buffer, emit, callbacks, tick: () => { const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach(callback => callback(0)); } };
}
afterEach(() => vi.unstubAllGlobals());

it('bounds move bursts to the final point once per frame', () => {
  const h = harness(); for (let x = 0; x < 1000; x++) h.buffer.send(move(x));
  expect(h.callbacks.size).toBe(1); expect(h.emit).not.toHaveBeenCalled(); h.tick();
  expect(h.emit).toHaveBeenCalledExactlyOnceWith(move(999));
});
it('flushes the final move before discrete input without dropping repeated text', () => {
  const h = harness(), text: ControlCommand = { type: 'text', controlRevision: 0, ...target, text: 'a' };
  h.buffer.send(move(1)); h.buffer.send(move(2)); h.buffer.send(text); h.buffer.send(text); h.tick();
  expect(h.emit.mock.calls.map(([command]) => command)).toEqual([move(2), text, text]);
});
it('discards pending movement on cancellation and presentation replacement', () => {
  const h = harness(), release: ControlCommand = { type: 'input.release', controlRevision: 0, ...target };
  h.buffer.send(move(10)); h.buffer.send(release); h.tick();
  expect(h.emit).toHaveBeenCalledExactlyOnceWith(release);
  h.buffer.send(move(20)); h.buffer.discard(); h.tick(); expect(h.emit).toHaveBeenCalledTimes(1);
});
