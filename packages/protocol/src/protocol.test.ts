import { describe, expect, it } from 'vitest';
import { ControlCommandSchema, ClipboardUpdateSchema, isRelaySignal, isSupportedUrl, validateSignalingUrl, type FrameMeta } from './index';
import { encodeFrame, FrameAssembler } from './frames';

const meta: FrameMeta = { frameId: 1, tabId: 8, generation: 1, width: 1280, height: 720, viewportWidth: 1280, viewportHeight: 720, offsetTop: 0, pageScaleFactor: 1, timestamp: 123 };

describe('frame transport', () => {
  it('reassembles out-of-order binary chunks without corrupting bytes', () => {
    const bytes = Uint8Array.from({ length: 40000 }, (_, i) => i % 256);
    const assembler = new FrameAssembler();
    const chunks = encodeFrame(meta, bytes).reverse();
    expect(assembler.push(chunks[0]!)).toBeUndefined();
    expect(assembler.push(chunks[0]!)).toBeUndefined();
    expect(assembler.push(chunks[1]!)).toBeUndefined();
    expect(assembler.push(chunks[2]!)).toEqual({ meta, jpeg: bytes });
    expect(assembler.push(chunks[2]!)).toBeUndefined();
  });
  it('discards old targets and late frames', () => {
    const assembler = new FrameAssembler();
    const data = new Uint8Array([1, 2, 3]);
    expect(assembler.push(encodeFrame({ ...meta, generation: 2 }, data)[0]!)).toBeDefined();
    expect(assembler.push(encodeFrame(meta, data)[0]!)).toBeUndefined();
    expect(assembler.push(encodeFrame({ ...meta, generation: 2, frameId: 0 }, data)[0]!)).toBeUndefined();
  });
  it('expires incomplete frames without blocking a newer one', () => {
    let now = 0;
    const assembler = new FrameAssembler(() => now);
    const chunks = encodeFrame(meta, new Uint8Array(40000));
    assembler.push(chunks[0]!);
    now = 1001;
    assembler.push(chunks[1]!);
    expect(assembler.push(chunks[2]!)).toBeUndefined();
    expect(assembler.push(encodeFrame({ ...meta, frameId: 2 }, new Uint8Array([1]))[0]!)).toBeDefined();
  });
  it('rejects malformed and oversized packets', () => {
    const assembler = new FrameAssembler();
    expect(assembler.push(new ArrayBuffer(1))).toBeUndefined();
    expect(assembler.push(new ArrayBuffer(100000))).toBeUndefined();
    expect(() => encodeFrame(meta, new Uint8Array(3 * 1024 * 1024))).toThrow();
  });
});

describe('network boundaries', () => {
  it('accepts only specific control operations and finite coordinates', () => {
    expect(ControlCommandSchema.safeParse({ type: 'Runtime.evaluate', expression: 'alert(1)' }).success).toBe(false);
    expect(ControlCommandSchema.safeParse({ type: 'pointer', event: 'down', x: Infinity, y: 0, tabId: 1, generation: 1 }).success).toBe(false);
    expect(ControlCommandSchema.safeParse({ type: 'tab.create', url: 'https://example.com', extra: true }).success).toBe(false);
  });
  it('enforces UTF-8 clipboard size, not just code unit count', () => {
    expect(ClipboardUpdateSchema.safeParse({ type: 'clipboard.update', origin: 'host', version: 1, text: '🙂'.repeat(100000) }).success).toBe(false);
  });
  it('rejects relay candidates in SDP and trickle ICE', () => {
    expect(isRelaySignal({ type: 'ice', candidate: { candidate: 'candidate:1 1 UDP 1 1.2.3.4 88 typ relay raddr 0.0.0.0' } })).toBe(true);
    expect(isRelaySignal({ type: 'offer', sdp: 'v=0\r\na=candidate:1 1 udp 2 1.2.3.4 33 typ relay\r\n' })).toBe(true);
    expect(isRelaySignal({ type: 'ice', candidate: { candidate: 'candidate:1 1 udp 1 192.168.1.2 33 typ host' } })).toBe(false);
  });
  it('allows only web targets and encrypted production signaling', () => {
    for (const url of ['chrome://settings', 'edge://extensions', 'file:///c:/x', 'javascript:alert(1)', 'https://chromewebstore.google.com/detail/a', 'https://u:p@example.com']) expect(isSupportedUrl(url)).toBe(false);
    expect(isSupportedUrl('https://example.com')).toBe(true);
    expect(validateSignalingUrl('http://192.168.1.2:8787')).toBe(false);
    expect(validateSignalingUrl('http://localhost:8787')).toBe(true);
    expect(validateSignalingUrl('https://example.com?token=secret')).toBe(false);
    expect(validateSignalingUrl('https://example.com')).toBe(true);
  });
});
