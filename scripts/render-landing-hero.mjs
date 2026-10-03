import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = resolve(root, 'apps/landing/src/assets/hero');
const ffmpeg = process.env.GHOSTPAIR_FFMPEG || 'ffmpeg';
const probe = spawnSync(ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8', windowsHide: true });
if (probe.error || probe.status !== 0) throw new Error('FFmpeg is required. Install it on PATH or set GHOSTPAIR_FFMPEG to its executable.');
const frames = 42 * 30;
const variants = [
  { name: 'desktop', width: 640, height: 540, compact: false },
  { name: 'mobile', width: 360, height: 304, compact: true },
];
const staging = await mkdtemp(resolve(tmpdir(), 'ghostpair-hero-'));
const server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'offline-signal-artwork',
  configureServer(vite) {
    vite.middlewares.use((request, response, next) => {
      if (request.url !== '/__signal-render__') return next();
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><title>Offline GhostPair artwork</title></head><body></body></html>');
    });
  },
}] });
let browser;

function encoder(args) {
  const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let diagnostic = '';
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-8000); });
  // Keep the promise handled while frames are still being produced.
  const done = new Promise((accept, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? accept() : reject(new Error(`FFmpeg exited ${code}: ${diagnostic}`)));
  });
  void done.catch(() => {});
  child.stdin.on('error', () => {});
  return { child, done };
}

try {
  await server.listen();
  const failures = [];
  for (const options of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try { browser = await chromium.launch({ ...options, headless: true }); break; }
    catch (error) { failures.push(error.message.split('\n')[0]); }
  }
  if (!browser) throw new Error(`A Playwright browser, Chrome or Edge is required: ${failures.join('; ')}`);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__signal-render__`);
  for (const variant of variants) {
    await page.evaluate(async ({ width, height, compact }) => {
      const { createSignalRenderer } = await import('/scripts/landing-signal-renderer.ts');
      const canvas = document.createElement('canvas');
      const renderer = createSignalRenderer(canvas, compact);
      if (!renderer) throw new Error('Canvas2D is unavailable for offline generation');
      renderer.resize(width, height, 2);
      window.signalArtwork = { canvas, renderer };
    }, variant);
    const firstFrame = await page.evaluate(() => {
      const { canvas, renderer } = window.signalArtwork;
      renderer.render(0);
      return canvas.toDataURL('image/png');
    });
    const loopFrame = await page.evaluate(() => {
      const { canvas, renderer } = window.signalArtwork;
      renderer.render(42000);
      return canvas.toDataURL('image/png');
    });
    assert.equal(loopFrame, firstFrame, `${variant.name}: geometry and traveling filaments must share a seamless period`);
    const png = resolve(staging, `signal-${variant.name}.png`);
    await writeFile(png, Buffer.from(firstFrame.split(',')[1], 'base64'));
    const webp = encoder(['-i', png, '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '1', resolve(staging, `signal-${variant.name}.webp`)]);
    webp.child.stdin.end();
    await webp.done;
    await writeFile(resolve(staging, `signal-${variant.name}.webp.json`), JSON.stringify({
      prompt: `Source: GhostPair original linked-loop procedural artwork in scripts/landing-signal-renderer.ts. Generated deterministically at time 0 by npm run render:landing-hero, ${variant.name} ${variant.width * 2}x${variant.height * 2}, original forest and mint geometry. No AI image generation.`,
      createdAt: new Date().toISOString(),
    }, null, 2) + '\n');

    const video = encoder([
      '-f', 'image2pipe', '-framerate', '30', '-vcodec', 'png', '-i', 'pipe:0',
      '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-threads', '2',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', resolve(staging, `signal-${variant.name}.mp4`),
    ]);
    try {
      for (let frame = 0; frame < frames; frame++) {
        const data = frame === 0 ? firstFrame : await page.evaluate(time => {
          const { canvas, renderer } = window.signalArtwork;
          renderer.render(time);
          return canvas.toDataURL('image/png');
        }, frame * 1000 / 30);
        if (!video.child.stdin.write(Buffer.from(data.split(',')[1], 'base64'))) {
          await Promise.race([once(video.child.stdin, 'drain'), video.done.then(() => { throw new Error('Encoder closed before all frames were written'); })]);
        }
        if (frame % 300 === 0) process.stdout.write(`${variant.name}: ${frame}/${frames} frames\n`);
      }
      video.child.stdin.end();
      await video.done;
    } finally {
      if (video.child.exitCode === null) video.child.kill();
    }
    await page.evaluate(() => window.signalArtwork.renderer.dispose());
  }
  await mkdir(assets, { recursive: true });
  for (const variant of variants) for (const extension of ['mp4', 'webp', 'webp.json']) {
    const file = `signal-${variant.name}.${extension}`;
    await copyFile(resolve(staging, file), resolve(assets, file));
  }
  process.stdout.write('Generated desktop/mobile H.264 loops: 42 seconds, 30 fps, no audio; matching WebP posters.\n');
} finally {
  await browser?.close();
  await server.close();
  // Only named files in this generator-owned temporary folder are removed.
  assert.equal(dirname(staging), resolve(tmpdir()));
  assert.ok(basename(staging).startsWith('ghostpair-hero-'));
  for (const file of await readdir(staging)) await unlink(resolve(staging, file));
  await rmdir(staging);
}
