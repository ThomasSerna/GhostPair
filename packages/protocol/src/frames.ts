import { z } from 'zod';
import { FrameMetaSchema, MAX_FRAME_BYTES, type FrameMeta } from './index';

const CHUNK_BYTES = 15 * 1024;
const MAX_HEADER_BYTES = 1024;
const HeaderSchema = z.object({
  meta: FrameMetaSchema,
  index: z.number().int().nonnegative(),
  count: z.number().int().min(1).max(Math.ceil(MAX_FRAME_BYTES / CHUNK_BYTES)),
  size: z.number().int().min(1).max(MAX_FRAME_BYTES),
}).strict();

export function encodeFrame(meta: FrameMeta, jpeg: Uint8Array): ArrayBuffer[] {
  FrameMetaSchema.parse(meta);
  if (!jpeg.byteLength || jpeg.byteLength > MAX_FRAME_BYTES) throw new Error('Invalid frame size');
  const count = Math.ceil(jpeg.byteLength / CHUNK_BYTES);
  return Array.from({ length: count }, (_, index) => {
    const header = new TextEncoder().encode(JSON.stringify({ meta, index, count, size: jpeg.byteLength }));
    if (header.length > MAX_HEADER_BYTES) throw new Error('Invalid frame header');
    const data = jpeg.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
    const packet = new Uint8Array(2 + header.length + data.length);
    new DataView(packet.buffer).setUint16(0, header.length);
    packet.set(header, 2);
    packet.set(data, 2 + header.length);
    return packet.buffer;
  });
}

interface PendingFrame { meta: FrameMeta; signature: string; size: number; count: number; chunks: Map<number, Uint8Array>; received: number; expires: number }

/** Two bounded in-flight frames; losses expire without blocking input or newer frames. */
export class FrameAssembler {
  private pending = new Map<string, PendingFrame>();
  private generation = -1;
  private lastFrameId = -1;
  constructor(private readonly now = () => Date.now(), private readonly ttlMs = 1000) {}

  clear(): void { this.pending.clear(); this.generation = -1; this.lastFrameId = -1; }

  push(packet: ArrayBuffer): { meta: FrameMeta; jpeg: Uint8Array } | undefined {
    if (packet.byteLength < 3 || packet.byteLength > CHUNK_BYTES + MAX_HEADER_BYTES + 2) return;
    const headerLength = new DataView(packet).getUint16(0);
    if (!headerLength || headerLength > MAX_HEADER_BYTES || packet.byteLength <= headerLength + 2) return;
    let parsed: z.infer<typeof HeaderSchema>;
    try { parsed = HeaderSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(packet, 2, headerLength)))); } catch { return; }
    const { meta, index, count, size } = parsed;
    if (index >= count || count !== Math.ceil(size / CHUNK_BYTES)) return;
    const expected = index === count - 1 ? size - index * CHUNK_BYTES : CHUNK_BYTES;
    if (packet.byteLength - headerLength - 2 !== expected) return;
    if (meta.generation < this.generation || (meta.generation === this.generation && meta.frameId <= this.lastFrameId)) return;
    if (meta.generation > this.generation) { this.pending.clear(); this.generation = meta.generation; this.lastFrameId = -1; }
    const now = this.now();
    for (const [key, value] of this.pending) if (value.expires <= now) this.pending.delete(key);
    const key = `${meta.generation}:${meta.frameId}`;
    const signature = JSON.stringify({ meta, count, size });
    let frame = this.pending.get(key);
    if (frame && frame.signature !== signature) { this.pending.delete(key); return; }
    if (!frame) {
      if (this.pending.size >= 2) {
        const oldest = [...this.pending.entries()].sort((a, b) => a[1].meta.frameId - b[1].meta.frameId)[0]!;
        if (oldest[1].meta.frameId > meta.frameId) return;
        this.pending.delete(oldest[0]);
      }
      frame = { meta, signature, count, size, chunks: new Map(), received: 0, expires: now + this.ttlMs };
      this.pending.set(key, frame);
    }
    if (frame.chunks.has(index)) return;
    const chunk = new Uint8Array(packet.slice(headerLength + 2));
    frame.chunks.set(index, chunk);
    frame.received += chunk.length;
    if (frame.chunks.size !== count || frame.received !== size) return;
    const jpeg = new Uint8Array(size);
    for (let i = 0; i < count; i++) jpeg.set(frame.chunks.get(i)!, i * CHUNK_BYTES);
    this.lastFrameId = meta.frameId;
    for (const [oldKey, old] of this.pending) if (old.meta.frameId <= meta.frameId) this.pending.delete(oldKey);
    return { meta, jpeg };
  }
}
