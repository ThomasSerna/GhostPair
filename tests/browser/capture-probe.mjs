import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { artifactRoot, closeBrowser, launchExtension, poll, resizePage, removeTestArtifact } from './helpers.mjs';

// Exercise the actual capture module with a local fixture service worker. No
// test-only commands or globals are added to the production extension.
await mkdir(artifactRoot, { recursive: true });
const extensionPath = await mkdtemp(resolve(artifactRoot, 'capture-fixture-'));
await writeFile(resolve(extensionPath, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'GhostPair capture integration fixture', version: '0.0.1',
  permissions: ['debugger', 'tabs'], background: { service_worker: 'worker.js' },
}));
await build({
  stdin: { contents: `import { BrowserCapture } from './apps/extension/src/core/capture.ts';
    globalThis.lastFrame = undefined; globalThis.currentState = undefined; globalThis.captureErrors = [];
    globalThis.capture = new BrowserCapture({
      frame: ({ meta }) => globalThis.lastFrame = meta,
      state: (tabs, activeTabId, generation) => globalThis.currentState = { tabs, activeTabId, generation },
      error: (error) => globalThis.captureErrors.push(error), detached: () => {},
    });`, resolveDir: resolve('.') },
  bundle: true, outfile: resolve(extensionPath, 'worker.js'), target: 'chrome125', format: 'iife',
});
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>Capture module test</title><style>body{margin:0}#target{position:absolute;left:580px;top:280px;width:20px;height:20px}</style>
    <button id="target" onclick="window.clicks++">x</button><input id="text"><span id="clock"></span>
    <script>window.clicks=0;setInterval(()=>document.querySelector('#clock').textContent=String(Date.now()),100)</script>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const results = [];
try {
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'edge']) {
    const browser = await launchExtension(name, extensionPath);
    const { context, worker } = browser;
    try {
      const page = await context.newPage();
      await page.goto(url);
      const tab = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url), url);
      await worker.evaluate(async (windowId) => globalThis.capture.start(windowId), tab.windowId);
      const first = await poll(() => worker.evaluate(() => globalThis.lastFrame), 'production capture first frame');
      assert.ok(first.viewportWidth > 700);
      await resizePage(browser, page, 820, 600);
      await poll(async () => (await worker.evaluate(() => globalThis.lastFrame))?.viewportWidth === 820, 'viewport after debugger attachment');
      await worker.evaluate(async (tabId) => chrome.tabs.setZoom(tabId, 1.25), tab.id);
      const zoomed = await poll(async () => {
        const frame = await worker.evaluate(() => globalThis.lastFrame);
        return frame?.viewportWidth === 656 ? frame : null;
      }, 'production capture CSS width at zoom125').catch(async (error) => {
        throw new Error(`${error.message}: ${JSON.stringify(await worker.evaluate(async (tabId) => ({
          frame: globalThis.lastFrame, state: globalThis.currentState, errors: globalThis.captureErrors,
          zoom: await chrome.tabs.getZoom(tabId),
        }), tab.id))}`);
      });
      const point = await page.locator('#target').boundingBox();
      await worker.evaluate(async ({ meta, x, y }) => {
        for (const event of ['down', 'up']) await globalThis.capture.execute({
          type: 'pointer', tabId: meta.tabId, generation: meta.generation,
          x, y, event, button: 'left', buttons: event === 'down' ? 1 : 0, clickCount: 1,
        });
      }, { meta: zoomed, x: point.x + point.width / 2, y: point.y + point.height / 2 });
      assert.equal(await page.evaluate(() => window.clicks), 1);
      await worker.evaluate(async () => { await globalThis.capture.setPaused(true); await globalThis.capture.setPaused(false); });
      await poll(async () => (await worker.evaluate(() => globalThis.lastFrame))?.generation > zoomed.generation, 'new generation after pause');
      const stale = await worker.evaluate(async (meta) => {
        try { await globalThis.capture.execute({ type: 'text', tabId: meta.tabId, generation: meta.generation, text: 'stale' }); return false; }
        catch { return true; }
      }, zoomed);
      assert.equal(stale, true);
      const outsideWindow = await worker.evaluate(async (url) => chrome.windows.create({ url, focused: false }), `${url}outside`);
      const outsideId = outsideWindow.tabs[0].id;
      const escaped = await worker.evaluate(async (tabId) => {
        try { await globalThis.capture.execute({ type: 'tab.close', tabId }); return false; }
        catch { return true; }
      }, outsideId);
      assert.equal(escaped, true);
      assert.ok(await worker.evaluate(async (tabId) => chrome.tabs.get(tabId), outsideId));
      await worker.evaluate(async () => globalThis.capture.stop());
      const attached = await worker.evaluate(async (tabId) => {
        try { await chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics'); return true; }
        catch { return false; }
      }, tab.id);
      assert.equal(attached, false);
      assert.deepEqual(await worker.evaluate(() => globalThis.captureErrors), []);
      const result = { browser: name, version: browser.version, productionCapture: true, viewportCssAt125: zoomed.viewportWidth,
        tinyTargetClick: true, pauseGeneration: true, staleInputRejected: true, outsideWindowRejected: true, stopped: true };
      results.push(result);
      console.log(JSON.stringify(result));
    } finally { await closeBrowser(browser); }
  }
  await writeFile(resolve(artifactRoot, 'capture-probe-results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
} finally { await new Promise((resolve) => server.close(resolve)); await removeTestArtifact(extensionPath); }
