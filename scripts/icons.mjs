import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { resolve } from 'node:path';

const output = resolve('apps/extension/public/icons');
mkdirSync(output, { recursive: true });
function chunk(type, data) { const kind = Buffer.from(type); const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); kind.copy(result, 4); data.copy(result, 8); result.writeUInt32BE(crc32(Buffer.concat([kind, data])), data.length + 8); return result; }
function color(x, y) {
  const border = Math.hypot(Math.max(0, Math.abs(x - .5) - .26), Math.max(0, Math.abs(y - .5) - .26)) < .23;
  if (!border) return [0, 0, 0, 0];
  const ring = (cx, cy) => Math.abs(Math.hypot(x - cx, y - cy) - .185) < .033;
  const mint = ring(.4, .455) || ring(.6, .545);
  return mint ? [181, 240, 205, 255] : [18, 43, 31, 255];
}
for (const size of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc((1 + size * 4) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) { const c = color((x + (sx + .5) / 4) / size, (y + (sy + .5) / 4) / size); for (let k = 0; k < 4; k++) sum[k] += c[k]; }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    for (let k = 0; k < 4; k++) pixels[offset + k] = Math.round(sum[k] / 16);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  writeFileSync(resolve(output, `${size}.png`), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
}
