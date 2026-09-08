import { afterEach, expect, it, vi } from 'vitest';
import type { ControlCommand, Presentation } from '@ghostpair/protocol';
import { FrameControl } from './frame-control';

function event() {
  const listeners: ((value: any) => void)[] = [];
  return { addListener: (fn: (value: any) => void) => listeners.push(fn), emit: (value: any) => listeners.forEach(fn => fn(value)) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const p: Presentation = { captureId: 'capture', tabId: 12, documentId: 'root', generation: 3, viewportWidth: 900, viewportHeight: 700, offsetLeft: 0, offsetTop: 0, scale: 1 };
function harness() {
  const frame = (frameId: number, documentId: string, parentFrameId = 0, parentDocumentId = 'root') => ({ frameId, documentId, parentFrameId, parentDocumentId, documentLifecycle: 'active', url: 'https://identical.example/child' });
  const topology = [frame(0, 'root', -1, ''), frame(1, 'a'), frame(2, 'b'), frame(3, 'nested', 2, 'b')];
  const indices = new Map([['a', 0], ['b', 1], ['nested', 0]]);
  const routes = new Map<string, { index: number; x?: number; y?: number }>([['root', { index: 1, x: 0.5, y: 0.25 }], ['b', { index: 0, x: 0.25, y: 0.5 }]]);
  const operations: { id: string; message: any }[] = [];
  const prepared = new Map<string, any>();
  const committed: { id: string; command: any }[] = [];
  const navigation = { onBeforeNavigate: event(), onCommitted: event(), onErrorOccurred: event(), onCompleted: event(), getAllFrames: vi.fn(async () => topology.map(f => ({ ...f }))) };
  const sendMessage = vi.fn(async (_tab: number, message: any, target: { documentId: string }): Promise<any> => {
    const id = target.documentId; operations.push({ id, message });
    if (message.operation === 'describe') return { ok: true, index: indices.get(id), viewportWidth: 200, viewportHeight: 100 };
    if (message.operation === 'prepare') { prepared.set(id, message.command); return { ok: true, token: `token-${id}`, child: routes.get(id) }; }
    if (message.operation === 'commit') committed.push({ id, command: prepared.get(id) });
    if (message.operation === 'command') committed.push({ id, command: message.command });
    return { ok: true };
  });
  const scripting = { executeScript: vi.fn(async (args: any) => [{ documentId: args.target.documentIds[0], result: {} }]) };
  vi.stubGlobal('chrome', { webNavigation: navigation, tabs: { sendMessage }, scripting });
  let usable = true;
  const control = new FrameControl(() => usable);
  const input = (type = 'pointer', extras: object = {}): any => type === 'pointer' ? { ...p, type, event: 'down', x: 450, y: 175, button: 'left', buttons: 1, modifiers: 0, clickCount: 1, ...extras } : { ...p, type, text: 'hello', ...extras };
  const key = (event: 'down' | 'up', extras: object = {}): Extract<ControlCommand, { type: 'key' }> => ({ ...p, type: 'key', event, key: 'Shift', code: 'ShiftLeft', keyCode: 16, modifiers: 8, repeat: false, ...extras });
  return { control, topology, frame, routes, indices, operations, committed, sendMessage, scripting, navigation, input, key, disable: () => { usable = false; } };
}
afterEach(() => vi.unstubAllGlobals());

it('routes identical-URL siblings and nested documents by browser identities and window indices', async () => {
  const h = harness(); await h.control.bind(p); await h.control.execute(h.input());
  expect(h.committed).toEqual([{ id: 'nested', command: expect.objectContaining({ x: 50, y: 50 }) }]);
  expect(h.operations.at(-1)).toMatchObject({ id: 'nested', message: { operation: 'commit', indices: [1, 0] } });
  expect(h.scripting.executeScript.mock.calls.every(([args]) => args.world === 'ISOLATED' && args.args[2] === false)).toBe(true);
});

it('isolates denied injection and keeps the root and other siblings usable', async () => {
  const h = harness(); h.scripting.executeScript.mockImplementation(async args => {
    if (args.target.documentIds[0] === 'a') throw new Error('permission denied');
    return [{ documentId: args.target.documentIds[0], result: {} }];
  });
  await h.control.bind(p); await h.control.execute(h.input()); expect(h.committed[0]?.id).toBe('nested');
  h.routes.set('root', { index: 0, x: 0.5, y: 0.5 });
  await expect(h.control.execute(h.input())).rejects.toThrow('Site access');
  h.routes.delete('root'); await h.control.execute(h.input()); expect(h.committed.at(-1)?.id).toBe('root');
});

it('discovers inserted frames and rejects reordered mappings during a gesture', async () => {
  const h = harness(); await h.control.bind(p); await h.control.execute(h.input());
  h.indices.set('b', 0); h.indices.set('a', 1); h.routes.set('root', { index: 0, x: 0.5, y: 0.5 });
  await expect(h.control.execute(h.input('pointer', { event: 'up', buttons: 0 }))).rejects.toThrow('changed');
  expect(h.committed).toHaveLength(1);
  h.topology.push(h.frame(4, 'dynamic')); h.indices.set('dynamic', 2); h.routes.set('root', { index: 2, x: 0.5, y: 0.5 });
  await h.control.execute(h.input()); expect(h.committed.at(-1)?.id).toBe('dynamic');
});

it('follows child focus for text and returns keyup to the original document', async () => {
  const h = harness(); await h.control.bind(p); await h.control.execute(h.input('text')); await h.control.execute(h.key('down'));
  h.routes.clear(); await h.control.execute(h.key('up'));
  expect(h.committed.map(c => c.id)).toEqual(['nested', 'nested', 'nested']);
});

it('retires a navigating subtree without redirecting pointerup or keyup to its replacement', async () => {
  const h = harness(); await h.control.bind(p); await h.control.execute(h.input()); await h.control.execute(h.key('down'));
  h.navigation.onBeforeNavigate.emit({ tabId: 12, frameId: 2 });
  h.topology.splice(2, 2, h.frame(2, 'replacement')); h.indices.set('replacement', 1);
  h.navigation.onCommitted.emit({ tabId: 12, frameId: 2 });
  await expect(h.control.execute(h.input('pointer', { event: 'up', buttons: 0 }))).rejects.toThrow('changed');
  await h.control.execute(h.key('up')); expect(h.committed).toHaveLength(2);
  expect(h.operations.some(o => o.id === 'nested' && o.message.operation === 'dispose')).toBe(true);
  await h.control.execute(h.input()); expect(h.committed.at(-1)?.id).toBe('replacement');
});

it('cancels an in-flight preparation and queued text when control is released', async () => {
  const h = harness(); await h.control.bind(p); const gate = deferred<any>(), entered = deferred<void>();
  const original = h.sendMessage.getMockImplementation()!;
  h.sendMessage.mockImplementation(async (...args) => {
    if (args[1].operation === 'prepare' && args[2].documentId === 'root') { entered.resolve(); return gate.promise; }
    return original(...args);
  });
  const first = h.control.execute(h.input()).catch(error => error);
  const second = h.control.execute(h.input('text')).catch(error => error);
  await entered.promise; h.disable(); await h.control.release(); gate.resolve({ ok: true, token: 'late' });
  expect(await first).toBeInstanceOf(Error); expect(await second).toBeInstanceOf(Error); expect(h.committed).toEqual([]);
  expect(new Set(h.operations.filter(o => o.message.operation === 'release').map(o => o.id))).toEqual(new Set(['root', 'a', 'b', 'nested']));
});

it('never commits after a parent verification reports replacement', async () => {
  const h = harness(); await h.control.bind(p); const original = h.sendMessage.getMockImplementation()!;
  h.sendMessage.mockImplementation(async (...args) => args[1].operation === 'verify' && args[2].documentId === 'root' ? { ok: false, error: 'The embedded page changed.' } : original(...args));
  await expect(h.control.execute(h.input())).rejects.toThrow('changed'); expect(h.committed).toEqual([]);
});

it('disposes every document on clear with the original presentation generation', async () => {
  const h = harness(); await h.control.bind(p); await h.control.clear();
  expect(new Set(h.operations.filter(o => o.message.operation === 'dispose' && o.message.generation === 3).map(o => o.id))).toEqual(new Set(['root', 'a', 'b', 'nested']));
  await expect(h.control.execute(h.input())).rejects.toThrow('changed');
});

it('disposes an installation that finishes after its capture was cleared', async () => {
  const h = harness(), gate = deferred<any>(), entered = deferred<void>();
  h.scripting.executeScript.mockImplementation(async args => {
    if (args.target.documentIds[0] === 'a') { entered.resolve(); return gate.promise; }
    return [{ documentId: args.target.documentIds[0], result: {} }];
  });
  const binding = h.control.bind(p); await entered.promise; await h.control.clear();
  gate.resolve([{ documentId: 'a', result: {} }]); await binding;
  expect(h.operations.some(o => o.id === 'a' && o.message.operation === 'dispose' && o.message.generation === p.generation)).toBe(true);
  await expect(h.control.execute(h.input())).rejects.toThrow('changed'); expect(h.committed).toEqual([]);
});
