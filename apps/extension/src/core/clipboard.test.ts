import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipboardSync, MAX_CLIPBOARD_BYTES, createDomClipboard, type ClipboardAdapter, type ClipboardUpdate } from './clipboard';

function memoryClipboard(value = '') {
  return {
    value,
    read: vi.fn(async function(this: { value: string }) { return this.value; }),
    write: vi.fn(async function(this: { value: string }, text: string) { this.value = text; }),
  };
}

describe('ClipboardSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the pre-session clipboard private and sends each new value once', async () => {
    const adapter = memoryClipboard('before consent'); const send = vi.fn();
    const sync = new ClipboardSync('host', adapter, send, vi.fn());
    await sync.start(); await sync.poll();
    expect(send).not.toHaveBeenCalled();
    adapter.value = 'Después de activar: 你好 🐈';
    await sync.poll(); await sync.poll();
    expect(send).toHaveBeenCalledExactlyOnceWith({ counter: 1, origin: 'host', text: adapter.value });
    sync.stop();
  });

  it('serializes slow reads and cancels polling as soon as the session stops', async () => {
    const read = Promise.withResolvers<string>(); const adapter = memoryClipboard('initial');
    const send = vi.fn(); const sync = new ClipboardSync('host', adapter, send, vi.fn());
    await sync.start();
    adapter.read.mockImplementationOnce(() => read.promise);
    const first = sync.poll(); const queued = sync.poll();
    await Promise.resolve();
    expect(adapter.read).toHaveBeenCalledTimes(2);
    sync.stop(); read.resolve('private value while closing');
    await Promise.all([first, queued]); await vi.advanceTimersByTimeAsync(5000);
    expect(send).not.toHaveBeenCalled(); expect(adapter.read).toHaveBeenCalledTimes(2);
  });

  it('does not leak changes made during a pause when re-enabled', async () => {
    const adapter = memoryClipboard('one'); const send = vi.fn();
    const sync = new ClipboardSync('guest', adapter, send, vi.fn());
    await sync.start(); sync.stop(); adapter.value = 'during pause';
    await sync.start(); await sync.poll(); expect(send).not.toHaveBeenCalled();
    adapter.value = 'new'; await vi.advanceTimersByTimeAsync(500);
    expect(send).toHaveBeenCalledExactlyOnceWith({ counter: 1, origin: 'guest', text: 'new' }); sync.stop();
  });

  it('applies incoming updates without echoing and ignores older versions', async () => {
    const adapter = memoryClipboard('a'); const send = vi.fn();
    const sync = new ClipboardSync('guest', adapter, send, vi.fn());
    await sync.start();
    await sync.receive({ counter: 5, origin: 'host', text: 'remote' }); await sync.poll();
    await sync.receive({ counter: 4, origin: 'host', text: 'old' });
    expect(adapter.value).toBe('remote'); expect(adapter.write).toHaveBeenCalledTimes(1); expect(send).not.toHaveBeenCalled();
    adapter.value = 'local'; await sync.poll();
    expect(send).toHaveBeenCalledWith({ counter: 6, origin: 'guest', text: 'local' }); sync.stop();
  });

  it('resolves simultaneous copies identically on both peers', async () => {
    const host = memoryClipboard(); const guest = memoryClipboard();
    const hostUpdates: ClipboardUpdate[] = []; const guestUpdates: ClipboardUpdate[] = [];
    const a = new ClipboardSync('host', host, u => hostUpdates.push(u), vi.fn());
    const b = new ClipboardSync('guest', guest, u => guestUpdates.push(u), vi.fn());
    await Promise.all([a.start(), b.start()]); host.value = 'host copy'; guest.value = 'guest copy';
    await Promise.all([a.poll(), b.poll()]);
    await Promise.all([a.receive(guestUpdates[0]!), b.receive(hostUpdates[0]!)]);
    await Promise.all([a.poll(), b.poll()]);
    expect(host.value).toBe('host copy'); expect(guest.value).toBe('host copy');
    expect(hostUpdates).toHaveLength(1); expect(guestUpdates).toHaveLength(1); a.stop(); b.stop();
  });

  it('enforces the UTF-8 limit and never writes oversized remote data', async () => {
    const adapter = memoryClipboard(); const send = vi.fn(); const error = vi.fn();
    const sync = new ClipboardSync('host', adapter, send, error); await sync.start();
    adapter.value = '🙂'.repeat(MAX_CLIPBOARD_BYTES / 4); await sync.poll();
    expect(send).toHaveBeenCalledTimes(1);
    adapter.value += 'é'; await sync.poll(); await sync.poll();
    expect(send).toHaveBeenCalledTimes(1); expect(error).toHaveBeenCalledTimes(1);
    await sync.receive({ counter: 2, origin: 'guest', text: adapter.value });
    expect(adapter.write).not.toHaveBeenCalled(); sync.stop();
  });

  it('rejects malformed versions and incoming writes after disable', async () => {
    const adapter = memoryClipboard(); const sync = new ClipboardSync('host', adapter, vi.fn(), vi.fn()); await sync.start();
    for (const counter of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER]) await sync.receive({ counter, origin: 'guest', text: 'bad' });
    sync.stop(); await sync.receive({ counter: 1, origin: 'guest', text: 'not authorized' });
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it('disables after permission failure and stops reading', async () => {
    const adapter: ClipboardAdapter = { read: vi.fn(async () => { throw new Error('Permission denied'); }), write: vi.fn() };
    const error = vi.fn(); const sync = new ClipboardSync('host', adapter, vi.fn(), error);
    await sync.start(); await vi.advanceTimersByTimeAsync(10000); await sync.poll();
    expect(error).toHaveBeenCalledTimes(1); expect(adapter.read).toHaveBeenCalledTimes(1);
  });
});

describe('offscreen clipboard adapter', () => {
  it('clears the transient DOM field on successful reads and failed writes', async () => {
    const field = { value: '', setAttribute: vi.fn(), focus: vi.fn(), select: vi.fn() };
    const doc = { createElement: () => field, body: { append: vi.fn() }, execCommand: vi.fn((name: string) => { if (name === 'paste') { field.value = 'clipboard text'; return true; } return false; }) };
    const adapter = createDomClipboard(doc as unknown as Document);
    expect(await adapter.read()).toBe('clipboard text'); expect(field.value).toBe('');
    await expect(adapter.write('transient')).rejects.toThrow(); expect(field.value).toBe('');
  });
});
