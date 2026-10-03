import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Compare the existing docs build before and after a change:
// node scripts/benchmark-landing.mjs --label baseline
// npm run build:landing
// node scripts/benchmark-landing.mjs --label optimized --require-video
// Run both on the same machine, with other browser work stopped. These are
// headless Chromium main-thread measurements, not whole-PC CPU or GPU usage.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = resolve(root, 'docs');
const output = resolve(root, '.impeccable/review');
const base = '/GhostPair/';
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const label = argument('--label', 'current');
assert.match(label, /^[a-z0-9-]+$/, 'Use a filename-safe benchmark label');
const sampleMs = 8000;
const settleMs = 3000;
const trials = 3;
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];
const requireVideo = process.argv.includes('--require-video');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
let browser;

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json'],
  ['.woff2', 'font/woff2'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.svg', 'image/svg+xml'], ['.mp4', 'video/mp4'],
]);
const server = await createServer({ configFile: false, root: docs, base, plugins: [{
  name: 'benchmark-production-files',
  configureServer(vite) {
    vite.middlewares.use(async (request, response, next) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (!pathname.startsWith(base)) return next();
      const file = resolve(docs, decodeURIComponent(pathname.slice(base.length)) || 'index.html');
      if (!file.startsWith(docs + sep)) return next();
      try {
        const body = await readFile(file);
        response.setHeader('Content-Type', contentTypes.get(extname(file)) ?? 'application/octet-stream');
        response.setHeader('Accept-Ranges', 'bytes');
        // Bypass Vite's JS/CSS transforms and inline sourcemaps. Range support
        // keeps the MP4 download behavior faithful to a static production host.
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
        if (range) {
          const start = Number(range[1]);
          const end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
          if (start > end || start >= body.length) {
            response.statusCode = 416;
            response.setHeader('Content-Range', `bytes */${body.length}`);
            response.end();
            return;
          }
          response.statusCode = 206;
          response.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`);
          response.setHeader('Content-Length', end - start + 1);
          response.end(body.subarray(start, end + 1));
          return;
        }
        response.setHeader('Content-Length', body.length);
        response.end(body);
      } catch (error) { next(error); }
    });
  },
}], server: { host: '127.0.0.1', port: 0 } });

async function launchBrowser() {
  const failures = [];
  for (const options of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try { return await chromium.launch({ ...options, headless: true }); }
    catch (error) { failures.push(`${options.channel ?? 'Playwright Chromium'}: ${error.message.split('\n')[0]}`); }
  }
  throw new Error(`No browser available. Install Playwright Chromium, Chrome or Edge.\n${failures.join('\n')}`);
}

async function bundleDetails() {
  const directory = resolve(docs, 'assets/landing');
  const scripts = (await readdir(directory)).filter(file => file.endsWith('.js'));
  assert.ok(scripts.length, 'Run npm run build:landing before benchmarking');
  const contents = await Promise.all(scripts.map(file => readFile(resolve(directory, file))));
  // Public method names survive minification. Together with the renderer's
  // filament color they identify the procedural renderer in the baseline.
  const bundle = contents.map(content => content.toString('utf8')).join('\n');
  const proceduralRendererPresent = ['setPointer', 'setProgress', '#c8f7d4'].every(marker => bundle.includes(marker));
  if (requireVideo) assert.equal(proceduralRendererPresent, false, 'Procedural renderer must be absent from the production bundle');
  return {
    files: scripts,
    rawBytes: contents.reduce((sum, content) => sum + content.length, 0),
    gzipBytes: contents.reduce((sum, content) => sum + gzipSync(content).length, 0),
    proceduralRendererPresent,
  };
}

async function measure(viewport, origin) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const resources = new Map();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
  cdp.on('Network.responseReceived', ({ requestId, type, response }) => {
    resources.set(requestId, { type, url: new URL(response.url).pathname, bytes: 0 });
  });
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const resource = resources.get(requestId);
    if (resource) resource.bytes = encodedDataLength;
  });
  cdp.on('Network.dataReceived', ({ requestId, encodedDataLength }) => {
    const resource = resources.get(requestId);
    if (resource) resource.bytes += encodedDataLength;
  });
  try {
    await page.goto(origin + base, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const scene = page.locator('.hero-scene');
    await scene.scrollIntoViewIfNeeded();
    const renderer = await scene.evaluate(element => element.querySelector('video') ? 'video' : element.querySelector('canvas') ? 'canvas' : 'image');
    if (requireVideo) assert.equal(renderer, 'video', 'The optimized hero uses a video');
    if (renderer === 'video') {
      await page.waitForFunction(() => {
        const video = document.querySelector('.hero-scene video');
        return video.readyState >= 2 && !video.paused && video.currentTime > 0;
      });
    }
    await page.waitForTimeout(settleMs);
    const before = (await cdp.send('Performance.getMetrics')).metrics;
    const videoBefore = await scene.evaluate(element => {
      const video = element.querySelector('video');
      return video?.getVideoPlaybackQuality ? { currentTime: video.currentTime, ...Object.fromEntries(['totalVideoFrames', 'droppedVideoFrames'].map(key => [key, video.getVideoPlaybackQuality()[key]])) } : null;
    });
    const animationFrames = await page.evaluate(duration => new Promise(resolveFrames => {
      const times = [];
      const longTasks = [];
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({ type: 'longtask', buffered: false });
      const started = performance.now();
      let previous = started;
      function frame(time) {
        times.push(time - previous);
        previous = time;
        if (time - started < duration) return requestAnimationFrame(frame);
        observer.disconnect();
        const sorted = [...times].sort((a, b) => a - b);
        resolveFrames({
          elapsedMs: time - started,
          frames: times.length,
          fps: times.length / ((time - started) / 1000),
          medianFrameMs: sorted[Math.floor(sorted.length * 0.5)],
          p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
          framesOver33Ms: times.filter(value => value > 33.4).length,
          longTasks: longTasks.length,
          longTaskMs: longTasks.reduce((sum, value) => sum + value, 0),
        });
      }
      requestAnimationFrame(frame);
    }), sampleMs);
    const after = (await cdp.send('Performance.getMetrics')).metrics;
    const initial = Object.fromEntries(before.map(({ name, value }) => [name, value]));
    const final = Object.fromEntries(after.map(({ name, value }) => [name, value]));
    const durationMs = {};
    for (const metric of ['ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration']) durationMs[metric] = (final[metric] - initial[metric]) * 1000;
    const videoAfter = await scene.evaluate(element => {
      const video = element.querySelector('video');
      return video?.getVideoPlaybackQuality ? { currentTime: video.currentTime, ...Object.fromEntries(['totalVideoFrames', 'droppedVideoFrames'].map(key => [key, video.getVideoPlaybackQuality()[key]])) } : null;
    });
    const transferred = {};
    for (const resource of resources.values()) transferred[resource.type] = (transferred[resource.type] ?? 0) + resource.bytes;
    const mediaResourceEntries = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\.(?:mp4|webm)(?:\?|$)/.test(entry.name)).map(entry => ({ url: new URL(entry.name).pathname, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize })));
    assert.deepEqual(errors, [], 'No runtime errors in the benchmark');
    return {
      renderer,
      durationMs,
      mainThreadPercent: durationMs.TaskDuration / animationFrames.elapsedMs * 100,
      animationFrames,
      videoPlayback: videoBefore && videoAfter ? {
        timeAdvanced: videoAfter.currentTime - videoBefore.currentTime,
        totalFrames: videoAfter.totalVideoFrames - videoBefore.totalVideoFrames,
        droppedFrames: videoAfter.droppedVideoFrames - videoBefore.droppedVideoFrames,
      } : null,
      transferredBytes: transferred,
      mediaResourceEntries,
      resources: [...resources.values()].sort((a, b) => a.url.localeCompare(b.url)),
    };
  } finally { await context.close(); }
}

try {
  const bundle = await bundleDetails();
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await launchBrowser();
  const results = [];
  for (const viewport of viewports) {
    const samples = [];
    for (let trial = 0; trial < trials; trial++) samples.push(await measure(viewport, origin));
    results.push({
      viewport,
      median: {
        scriptMs: median(samples.map(sample => sample.durationMs.ScriptDuration)),
        mainThreadMs: median(samples.map(sample => sample.durationMs.TaskDuration)),
        mainThreadPercent: median(samples.map(sample => sample.mainThreadPercent)),
        fps: median(samples.map(sample => sample.animationFrames.fps)),
        p95FrameMs: median(samples.map(sample => sample.animationFrames.p95FrameMs)),
        transferredBytes: Object.fromEntries(['Script', 'Media', 'Image', 'Font', 'Document', 'Stylesheet'].map(type => [type, median(samples.map(sample => sample.transferredBytes[type] ?? 0))])),
      },
      samples,
    });
  }
  await mkdir(output, { recursive: true });
  const report = {
    label,
    capturedAt: new Date().toISOString(),
    browser: browser.version(),
    conditions: { sampleMs, settleMs, trials, deviceScaleFactor: 1, headless: true, reducedMotion: 'no-preference', cacheDisabled: true, scroll: 'hero-scene visible, no input during sample', cpuThrottle: 1, note: 'CDP ScriptDuration and TaskDuration cover the page main thread; media decoding and GPU/whole-process CPU are not measured. RAF counts indicate page presentation opportunities, not video render quality.' },
    bundle,
    results,
  };
  const path = resolve(output, `landing-${label}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ report: path, bundle, results: results.map(({ viewport, median }) => ({ viewport, median })) }, null, 2) + '\n');
} finally {
  await browser?.close();
  await server.close();
}
