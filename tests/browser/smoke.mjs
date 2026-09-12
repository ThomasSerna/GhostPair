import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from '../../apps/signaling/dist/server.js';
import { launchExtension, closeBrowser, removeTestArtifact, poll, resizePage, artifactRoot } from './helpers.mjs';
import { startStun } from './stun.mjs';
import { questionnaireHtml } from './questionnaire-fixture.mjs';
import { questionnaireWorkflow } from './questionnaire-workflow.mjs';

const fixture = httpServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.url === '/questionnaire') { response.end(questionnaireHtml); return; }
  if (request.url === '/questionnaire-frame') { response.end(`<!doctype html><title>Embedded questionnaire</title><style>body{margin:0}iframe{width:100%;height:720px;border:0}</style><iframe id="questionnaire" src="http://localhost:${fixture.address().port}/questionnaire"></iframe>`); return; }
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Fixture ${request.url}</title><style>body{font:20px sans-serif;margin:30px;background:#f6f0df;color:#123638}input,textarea,button{display:block;font:inherit;padding:10px;margin:10px 0}#nested{height:90px;width:250px;overflow:auto}#nested>div{height:700px}#space{height:1800px}</style></head><body><h1>GhostPair video fixture</h1><button id="target" onclick="count.textContent=String(++window.clicks)">Click target</button><output id="count">0</output><input id="text"><textarea id="multiline"></textarea><div id="nested"><div>Scroll area</div></div><p id="clock"></p><div id="space"></div><script>window.clicks=0;setInterval(()=>clock.textContent=String(Date.now()),100)</script></body></html>`);
});
await new Promise(done => fixture.listen(0, done));
const base = `http://127.0.0.1:${fixture.address().port}`;
await mkdir(artifactRoot, { recursive: true });
const extensionPath = await mkdtemp(resolve(artifactRoot, 'smoke-extension-'));
await cp(resolve('dist/extension'), extensionPath, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(extensionPath, 'manifest.json'), 'utf8'));
assert.ok(!manifest.permissions.includes('debugger'));
// Test-only grants bypass permission dialogs, but do not bypass tab capture invocation.
manifest.host_permissions = ['http://*/*', 'https://*/*'];
await writeFile(resolve(extensionPath, 'manifest.json'), JSON.stringify(manifest));
const results = [], stun = await startStun();
async function call(page, type, fields = {}) {
  const reply = await page.evaluate(({ type, fields }) => chrome.runtime.sendMessage({ target: 'background', type, ...fields }), { type, fields });
  if (!reply?.ok) throw new Error(`${type}: ${reply?.error}`);
  return reply.state;
}
const state = page => call(page, 'ui.status');
async function waitState(page, check, label) { return poll(async () => { const current = await state(page); return check(current) ? current : false; }, label, 30000); }
async function authorize(browser, page) {
  await page.bringToFront();
  const { targetInfos } = await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  await browser.cdp.send('Extensions.triggerAction', { id: browser.id, targetId: targetInfos.find(target => target.url === page.url()).targetId });
}
async function videoReady(viewer, expectedUrl) {
  try { return await poll(() => viewer.evaluate(async expectedUrl => { const reply = await chrome.runtime.sendMessage({ target: 'background', type: 'ui.status' }); const state = reply.state; const video = document.querySelector('video'); return state.presentation && (!expectedUrl || state.tabs.find(t => t.id === state.activeTabId)?.url === expectedUrl) && video?.dataset.generation === String(state.generation) && video.readyState >= 2 && video.videoWidth > 0; }, expectedUrl), 'current native video', 30000); }
  catch (error) { throw new Error(`${error.message}; state=${JSON.stringify(await state(viewer))}; page=${await viewer.locator('body').innerText()}`); }
}
async function point(host, viewer, selector) {
  const xy = await host.locator(selector).evaluate(element => { const box = element.getBoundingClientRect(); return { x: (box.left + box.width / 2) / innerWidth, y: (box.top + box.height / 2) / innerHeight }; });
  const box = await viewer.locator('video').boundingBox(); assert.ok(box); return { x: box.x + xy.x * box.width, y: box.y + xy.y * box.height };
}
async function click(host, viewer, selector) { await videoReady(viewer, host.url()); const xy = await point(host, viewer, selector); await viewer.mouse.click(xy.x, xy.y); }
async function join(viewer, deviceId, password) {
  await viewer.bringToFront();
  await poll(() => viewer.evaluate(() => !document.hidden), 'connection page visible');
  await viewer.getByLabel('Host address', { exact: true }).fill(deviceId);
  await viewer.getByLabel('Session password', { exact: true }).fill(password);
  await viewer.getByRole('button', { name: 'Connect →', exact: true }).click();
}
try {
  for (const pair of process.argv.slice(2).length ? process.argv.slice(2) : ['chrome:chrome', 'edge:edge', 'chrome:edge']) {
    let host, guest, signal;
    try {
      const [hostName, guestName] = pair.split(':');
      host = await launchExtension(hostName, extensionPath); guest = await launchExtension(guestName, extensionPath, { nativeVisibility: true });
      const errors = [];
      for (const browser of [host, guest]) browser.context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
      signal = createServer({ databasePath: ':memory:', port: 0, allowedOrigins: [`chrome-extension://${host.id}`, `chrome-extension://${guest.id}`] });
      const address = await signal.listen(0);
      const settings = { signalingUrl: `http://127.0.0.1:${address.port}`, stunUrls: [stun.url] };
      const hostUi = await host.context.newPage(); await hostUi.goto(`chrome-extension://${host.id}/popup.html`);
      const viewer = await guest.context.newPage(); await viewer.goto(`chrome-extension://${guest.id}/viewer.html`);
      await call(hostUi, 'ui.settings.save', { settings }); await call(viewer, 'ui.settings.save', { settings });
      const page = await host.context.newPage(); await page.goto(`${base}/one`); await authorize(host, page);
      const starting = await call(hostUi, 'ui.host.start', { password: 'Eight-42', clipboard: false });
      assert.notEqual(starting.status, 'error', JSON.stringify(starting));
      const waiting = await waitState(hostUi, s => s.status === 'waiting', 'host waiting');
      assert.ok(waiting.presentation, JSON.stringify(waiting));
      await join(viewer, waiting.deviceId, 'Wrong-42');
      await waitState(viewer, s => s.status === 'error', 'wrong password rejected');
      await viewer.getByRole('button', { name: 'Dismiss notification' }).click();
      assert.equal((await state(viewer)).notification, undefined);
      await join(viewer, waiting.deviceId, 'Eight-42');
      await waitState(viewer, s => s.status === 'connected', 'direct session connected'); await videoReady(viewer);
      for (const embedded of [false, true]) {
        await page.goto(`${base}/${embedded ? 'questionnaire-frame' : 'questionnaire'}`);
        await questionnaireWorkflow(page, viewer, () => videoReady(viewer, page.url()), { embedded });
      }
      const appearance = await host.worker.evaluate(async () => ({ badge: await chrome.action.getBadgeText({}), title: await chrome.action.getTitle({}) }));
      assert.deepEqual(appearance, { badge: '', title: 'GhostPair' });
      await page.goto(`${base}/one`); await videoReady(viewer, page.url());
      await click(page, viewer, '#target'); await poll(() => page.evaluate(() => window.clicks === 1), 'remote click');
      await click(page, viewer, '#text'); await viewer.keyboard.insertText('GhostPair á漢🙂'); await viewer.keyboard.press('Backspace');
      await poll(() => page.locator('#text').inputValue().then(v => v === 'GhostPair á漢'), 'Unicode text and codepoint deletion');
      await click(page, viewer, '#multiline'); await viewer.keyboard.insertText('First'); await viewer.keyboard.press('Enter'); await viewer.keyboard.insertText('Second');
      await poll(() => page.locator('#multiline').inputValue().then(v => v === 'First\nSecond'), 'multiline editing');
      const xy = await point(page, viewer, '#nested'); await viewer.mouse.move(xy.x, xy.y); await viewer.mouse.wheel(0, 180);
      await poll(() => page.locator('#nested').evaluate(e => e.scrollTop > 0), 'nested scroll');
      const original = (await state(hostUi)).presentation;
      await host.worker.evaluate(tabId => chrome.tabs.setZoom(tabId, 1.25), original.tabId);
      await waitState(viewer, s => s.generation > original.generation && s.presentation, 'zoom generation'); await videoReady(viewer);
      await click(page, viewer, '#target'); await poll(() => page.evaluate(() => window.clicks === 2), 'zoom mapped click');
      await call(hostUi, 'ui.pause', { paused: true }); await waitState(viewer, s => s.paused, 'pause');
      await call(hostUi, 'ui.pause', { paused: false }); await videoReady(viewer);
      await call(hostUi, 'ui.control', { enabled: false }); await waitState(viewer, s => !s.controlEnabled, 'control withdrawn');
      assert.equal(await viewer.getByLabel('Remote keyboard input').isDisabled(), true);
      await videoReady(viewer); // Withdrawing input must retain view-only video.
      await call(hostUi, 'ui.control', { enabled: true }); await videoReady(viewer);
      await viewer.getByRole('button', { name: 'Open tab', exact: true }).click();
      await viewer.getByRole('dialog').getByLabel('Page address').waitFor();
      assert.equal(await viewer.getByRole('dialog').getByLabel('Page address').evaluate(e => e === document.activeElement), true);
      await viewer.keyboard.press('Escape');
      assert.equal(await viewer.getByRole('dialog').count(), 0);
      await poll(() => viewer.getByRole('button', { name: 'Open tab', exact: true }).evaluate(e => e === document.activeElement), 'dialog returns focus');
      await viewer.getByRole('button', { name: 'Open tab', exact: true }).click();
      const dialog = viewer.getByRole('dialog'); await dialog.getByLabel('Page address').fill('javascript:alert(1)'); await dialog.getByRole('button', { name: 'Open', exact: true }).click();
      assert.equal(await dialog.getByRole('alert').count(), 1);
      await dialog.getByLabel('Page address').fill(`${base}/two`); await dialog.getByRole('button', { name: 'Open', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      const pending = await waitState(viewer, s => s.tabs.some(t => t.url === `${base}/two` && !t.authorized), 'new tab waits for approval');
      assert.equal(pending.presentation, undefined);
      const second = await poll(() => host.context.pages().find(p => p.url() === `${base}/two`), 'new host page');
      await authorize(host, second); await call(hostUi, 'ui.host.authorize'); await videoReady(viewer);
      await click(second, viewer, '#target'); await poll(() => second.evaluate(() => window.clicks === 1), 'second authorized tab');
      await call(viewer, 'ui.command', { command: { type: 'tab.activate', tabId: original.tabId } }); await videoReady(viewer, page.url());
      await click(page, viewer, '#target'); await poll(() => page.evaluate(() => window.clicks === 3), 'return to first authorized tab');
      const secondId = pending.tabs.find(t => t.url === `${base}/two`).id;
      await call(viewer, 'ui.command', { command: { type: 'tab.activate', tabId: secondId } }); await videoReady(viewer, second.url());
      await call(hostUi, 'ui.host.release', { tabId: original.tabId });
      await poll(async () => !(await host.worker.evaluate(() => chrome.tabCapture.getCapturedTabs())).some(t => t.tabId === original.tabId && ['active', 'pending'].includes(t.status)), 'released inactive source');
      await second.goto(`http://localhost:${fixture.address().port}/cross-origin`); await videoReady(viewer);
      await click(second, viewer, '#target'); await poll(() => second.evaluate(() => window.clicks === 1), 'cross-origin control');
      await resizePage(host, second, 850, 650); await videoReady(viewer);
      await click(second, viewer, '#target'); await poll(() => second.evaluate(() => window.clicks === 2), 'resized video mapping');
      const reconnect = async () => {
        await viewer.getByLabel('Host address', { exact: true }).waitFor();
        assert.equal(await viewer.getByLabel('Session password', { exact: true }).inputValue(), '');
        await waitState(hostUi, s => s.status === 'idle', 'previous host ended');
        await authorize(host, second);
        await call(hostUi, 'ui.host.start', { password: 'Eight-42', clipboard: false });
        const next = await waitState(hostUi, s => s.status === 'waiting', 'host restarted');
        assert.equal(next.deviceId, waiting.deviceId, 'host identity survives new sessions');
        assert.equal(await viewer.getByLabel('Host address', { exact: true }).inputValue(), waiting.deviceId);
        await join(viewer, next.deviceId, 'Eight-42');
        await waitState(viewer, s => s.status === 'connected', 'guest reconnected');
        await videoReady(viewer, second.url());
      };
      await call(hostUi, 'ui.stop'); await reconnect();
      await viewer.getByRole('button', { name: 'Disconnect', exact: true }).click(); await reconnect();
      await viewer.reload(); await reconnect();
      const duplicate = await guest.context.newPage(); await duplicate.goto(viewer.url());
      await duplicate.getByText('Your connection page is already open.').waitFor();
      await duplicate.close(); await call(viewer, 'ui.viewer.open');
      assert.equal((await state(viewer)).status, 'connected');
      assert.equal(guest.context.pages().filter(p => p.url() === viewer.url()).length, 1);
      if (process.env.GHOSTPAIR_INSPECT === '1') {
        await second.evaluate(() => { document.title = 'GhostPair capture verification HOST'; });
        await second.bringToFront();
        console.log(`VISIBLE INSPECTION READY: ${pair}`);
        await new Promise(done => setTimeout(done, 60000));
      }
      const before = await viewer.locator('video').evaluate(v => v.getVideoPlaybackQuality().totalVideoFrames);
      await new Promise(done => setTimeout(done, 3000));
      const renderedFrames = await viewer.locator('video').evaluate(v => v.getVideoPlaybackQuality().totalVideoFrames) - before;
      await signal.close(); signal = undefined;
      await waitState(viewer, s => Boolean(s.notification), 'signaling disconnect notice');
      await viewer.getByRole('button', { name: 'Dismiss notification' }).click();
      await click(second, viewer, '#target'); await poll(() => second.evaluate(() => window.clicks === 3), 'P2P survives signaling loss');
      await viewer.screenshot({ path: resolve(artifactRoot, `native-${pair.replace(':', '-')}.png`) });
      await viewer.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await viewer.getByLabel('Host address', { exact: true }).waitFor(); await waitState(hostUi, s => s.status === 'idle', 'host ended');
      await poll(async () => !(await host.worker.evaluate(() => chrome.tabCapture.getCapturedTabs())).some(t => ['active', 'pending'].includes(t.status)), 'capture tracks released');
      assert.equal(guest.context.pages().filter(p => p.url() === `chrome-extension://${guest.id}/viewer.html`).length, 1);
      assert.deepEqual(errors, []);
      results.push({ pair, host: host.version, guest: guest.version, nativeVideo: true, questionnaire: true, embeddedQuestionnaire: true, cancellation: true, toolbar: appearance, renderedFramesInThreeSeconds: renderedFrames, passed: true }); console.log(JSON.stringify(results.at(-1)));
    } finally { await signal?.close(); await closeBrowser(guest); await closeBrowser(host); }
  }
  await writeFile(resolve(artifactRoot, 'native-smoke-results.json'), JSON.stringify(results, null, 2));
} finally { await stun.close(); await new Promise(done => fixture.close(done)); await removeTestArtifact(extensionPath); }
