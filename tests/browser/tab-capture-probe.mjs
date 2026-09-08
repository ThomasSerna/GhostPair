import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchExtension, closeBrowser, poll, artifactRoot } from './helpers.mjs';

const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<h1>Authorized capture fixture</h1>'); });
await new Promise(done => server.listen(0, done));
const port = server.address().port;
const results = [];
try {
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'edge']) {
    const browser = await launchExtension(name, 'tests/browser/fixtures/tab-capture');
    try {
      const one = await browser.context.newPage(); await one.goto(`http://127.0.0.1:${port}/one`);
      const two = await browser.context.newPage(); await two.goto(`http://127.0.0.1:${port}/two`);
      const tabs = await browser.worker.evaluate(() => chrome.tabs.query({}));
      const first = tabs.find(t => t.url.endsWith('/one')); const second = tabs.find(t => t.url.endsWith('/two'));
      const denied = await browser.worker.evaluate(async tabId => { try { await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }); return false; } catch { return true; } }, first.id);
      assert.equal(denied, true, 'capture is rejected before extension invocation');
      for (const [page, tab] of [[one, first], [two, second]]) {
        await page.bringToFront();
        const { targetInfos } = await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
        const targetId = targetInfos.find(t => t.url === page.url()).targetId;
        await browser.cdp.send('Extensions.triggerAction', { id: browser.id, targetId });
        const result = await poll(() => browser.worker.evaluate(id => globalThis.results[id], tab.id), 'authorized capture consumed');
        assert.equal(result.error, undefined, JSON.stringify(result)); assert.equal(result.state, 'live'); assert.ok(result.width > 0);
      }
      await one.goto(`http://localhost:${port}/navigated`);
      const captures = await browser.worker.evaluate(() => chrome.tabCapture.getCapturedTabs());
      assert.equal(captures.filter(t => t.status === 'active').length, 2);
      results.push({ browser: browser.version, captureRequiresInvocation: true, twoLiveTabs: true, crossOriginNavigation: true });
      console.log(JSON.stringify(results.at(-1)));
    } finally { await closeBrowser(browser); }
  }
  await writeFile(resolve(artifactRoot, 'tab-capture-probe.json'), JSON.stringify(results, null, 2));
} finally { await new Promise(done => server.close(done)); }
