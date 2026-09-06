import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { artifactRoot, closeBrowser, launchExtension, poll } from './helpers.mjs';

const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html><head><title>GhostPair synthetic fixture</title>
    <style>body{font:20px sans-serif;margin:40px}button,input{font:inherit;padding:20px;display:block;margin-bottom:20px}</style></head>
    <body><button id="target" onclick="this.textContent='Clicked'">Click target</button><input id="text" aria-label="Test text"><output id="counter">0</output>
    <script>setInterval(()=>document.querySelector('#counter').textContent=String(Date.now()),200);document.addEventListener('mousedown',event=>window.lastPointer={x:event.clientX,y:event.clientY})</script></body></html>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const results = [];

try {
  for (const name of (process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'edge'])) {
    const launched = await launchExtension(name, 'tests/browser/fixtures/api-probe');
    const { context, worker, id, version, cdp } = launched;
    try {
      const page = await context.newPage();
      await page.goto(url);
      const tab = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url), url);
      assert.ok(tab?.id, 'fixture tab found');
      await worker.evaluate(async (tabId) => {
        await chrome.debugger.attach({ tabId }, '1.3');
        await chrome.debugger.sendCommand({ tabId }, 'Page.startScreencast', {
          format: 'jpeg', quality: 80, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1,
        });
      }, tab.id);
      const frame = await poll(() => worker.evaluate(() => globalThis.probeFrames.at(-1)), `${name} screencast`);
      assert.equal(frame.jpeg, true);
      assert.ok(frame.bytes > 100);
      const click = async (selector) => {
        const box = await page.locator(selector).boundingBox();
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await worker.evaluate(async ({ tabId, point }) => {
          for (const type of ['mousePressed', 'mouseReleased']) {
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
              type, ...point, button: 'left', clickCount: 1,
            });
          }
        }, { tabId: tab.id, point });
      };
      await click('#target');
      assert.equal(await page.locator('#target').textContent(), 'Clicked');
      await click('#text');
      await worker.evaluate(async (tabId) => chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: 'GhostPair á漢🙂' }), tab.id);
      assert.equal(await page.locator('#text').inputValue(), 'GhostPair á漢🙂');
      await page.setViewportSize({ width: 820, height: 600 });
      const resized = await poll(async () => {
        const value = await worker.evaluate(() => globalThis.probeFrames.at(-1));
        return value?.metadata.deviceWidth === 820 ? value : null;
      }, `${name} resized screencast`);
      await worker.evaluate(async (tabId) => {
        await chrome.tabs.setZoom(tabId, 1.25);
        await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: ' zoom' });
      }, tab.id);
      assert.equal(await page.locator('#text').inputValue(), 'GhostPair á漢🙂 zoom');
      await page.locator('#target').evaluate((element) => { element.textContent = 'Zoom click target'; });
      await click('#target');
      assert.equal(await page.locator('#target').textContent(), 'Clicked');
      const zoomGeometry = await worker.evaluate(async (tabId) => ({
        metrics: await chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics'),
        frame: globalThis.probeFrames.at(-1)?.metadata,
      }), tab.id);
      const pointer = await page.evaluate(() => window.lastPointer);
      const zoomRect = await page.locator('#target').boundingBox();
      const created = await worker.evaluate(async ({ windowId, url }) => chrome.tabs.create({ windowId, url: `${url}new`, active: true }), { windowId: tab.windowId, url });
      assert.equal(created.windowId, tab.windowId);
      await worker.evaluate(async (tabId) => chrome.tabs.remove(tabId), created.id);
      await worker.evaluate(async () => chrome.offscreen.createDocument({
        url: 'offscreen.html', reasons: ['CLIPBOARD'], justification: 'Non-invasive API presence probe; does not read or write clipboard.',
      }));
      const contexts = await worker.evaluate(async () => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }));
      assert.equal(contexts.length, 1);
      const targets = await cdp.send('Target.getTargets');
      const offscreen = targets.targetInfos.find((target) => target.url === `chrome-extension://${id}/offscreen.html`);
      assert.ok(offscreen, 'offscreen document created');
      // Do not issue copy/paste: headless Chrome on Windows can still access the user's system clipboard.
      const status = { browser: name, version, capture: true, click: true, unicode: true, resize: true, zoom: true,
        frame: { bytes: frame.bytes, metadata: frame.metadata }, resized: resized.metadata,
        zoomGeometry, pointer, zoomRect, createCloseTab: true,
        offscreenCreated: true, clipboardReadWrite: 'not executed: system clipboard isolation not established' };
      results.push(status);
      await worker.evaluate(async (tabId) => {
        await chrome.debugger.sendCommand({ tabId }, 'Page.stopScreencast');
        await chrome.debugger.detach({ tabId });
        await chrome.offscreen.closeDocument();
      }, tab.id);
      console.log(JSON.stringify(status));
    } finally {
      await closeBrowser(launched);
    }
  }
  await writeFile(resolve(artifactRoot, 'api-probe-results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
