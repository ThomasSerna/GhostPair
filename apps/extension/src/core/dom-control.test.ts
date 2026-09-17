import { afterEach, expect, it, vi } from 'vitest';
import { installDomControl } from './dom-control';

afterEach(() => { (globalThis as any).__ghostpairControl?.dispose(); vi.unstubAllGlobals(); });
it('rejects stale generations and untrusted senders before touching the document', () => {
  let listener: any;
  const hit = vi.fn();
  vi.stubGlobal('document', { elementFromPoint: hit, activeElement: null });
  vi.stubGlobal('innerWidth', 800); vi.stubGlobal('innerHeight', 600); vi.stubGlobal('visualViewport', null);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('chrome', { runtime: { id: 'extension', onMessage: { addListener: (value: any) => { listener = value; }, removeListener: vi.fn() } } });
  expect(installDomControl('capture', 3).viewportWidth).toBe(800);
  const respond = vi.fn();
  const message = { target: 'ghostpair.dom', captureId: 'capture', generation: 2, command: { type: 'pointer', controlRevision: 0, event: 'down', x: 1, y: 1 } };
  listener(message, { id: 'extension' }, respond);
  expect(respond).toHaveBeenCalledWith({ ok: false, error: expect.stringContaining('changed') });
  respond.mockClear(); listener({ ...message, generation: 3 }, { id: 'another-extension' }, respond);
  expect(respond).not.toHaveBeenCalled(); expect(hit).not.toHaveBeenCalled();
  installDomControl('replacement', 4);
  listener(message, { id: 'extension' }, respond);
  expect(respond).not.toHaveBeenCalled();
});
