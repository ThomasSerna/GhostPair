import assert from 'node:assert/strict';
import { createServer as createFixtureServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from '../../apps/signaling/dist/server.js';
import { artifactRoot, closeBrowser, launchExtension, poll, resizePage, removeTestArtifact } from './helpers.mjs';
import { startStun } from './stun.mjs';

const fixtureServer = createFixtureServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>GhostPair ${request.url === '/new' ? 'new tab' : 'fixture'}</title>
  <style>body{font:20px sans-serif;margin:40px;background:#f6f0df;color:#123638}input,button{display:block;font:inherit;padding:12px;margin-bottom:20px}#pixel{position:absolute;left:580px;top:280px;width:30px;height:30px;padding:0;background:#c44}#clock{color:#667}#scroll{height:1600px}</style></head>
  <body><h1>GhostPair browser test</h1><button id="target" onclick="document.querySelector('#count').textContent=String(++window.clicks)">Click target</button><output id="count">0</output>
  <input id="text" aria-label="Fixture text"><textarea id="multiline" aria-label="Fixture multiline"></textarea><button id="pixel" aria-label="Small target" onclick="document.querySelector('#count').textContent=String(++window.clicks)"></button><p id="clock"></p><div id="scroll"></div>
  <script>window.clicks=0;window.releases=0;document.addEventListener('mouseup',()=>window.releases++);setInterval(()=>document.querySelector('#clock').textContent=String(Date.now()),100)</script></body></html>`);
});

async function call(page, type, fields = {}) {
  const reply = await page.evaluate(async ({ type, fields }) => chrome.runtime.sendMessage({ target: 'background', type, ...fields }), { type, fields });
  if (!reply?.ok) throw new Error(`${type}: ${reply?.error ?? 'No response'}`);
  return reply.state;
}

async function state(page) { return call(page, 'ui.status'); }

async function waitState(page, predicate, label, timeout = 20000) {
  let latest;
  try { return await poll(async () => { latest = await state(page); return predicate(latest) ? latest : null; }, label, timeout); }
  catch (error) { throw new Error(`${error.message}; last state=${JSON.stringify(latest)}`); }
}

async function remoteClick(hostPage, viewer, selector) {
  const host = await hostPage.evaluate((selector) => {
    const box = document.querySelector(selector).getBoundingClientRect();
    return { x: (box.x + box.width / 2) / innerWidth, y: (box.y + box.height / 2) / innerHeight };
  }, selector);
  const canvas = await viewer.locator('canvas').boundingBox();
  assert.ok(canvas, 'remote image has a bounding box');
  await viewer.mouse.click(canvas.x + host.x * canvas.width, canvas.y + host.y * canvas.height);
}

await mkdir(artifactRoot, { recursive: true });
const extensionPath = await mkdtemp(resolve(artifactRoot, 'smoke-extension-'));
await cp(resolve('dist/extension'), extensionPath, { recursive: true });
const manifestPath = resolve(extensionPath, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
// Native optional-permission prompts cannot be approved headlessly. Production JS
// stays byte-for-byte identical; this test copy grants only its loopback fixture.
manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}`;
const matrix = process.argv.slice(2).length ? process.argv.slice(2) : ['chrome:chrome', 'edge:edge', 'chrome:edge'];
const results = [];
const stun = await startStun();

try {
  for (const pair of matrix) {
    const [hostName, guestName] = pair.split(':');
    const host = await launchExtension(hostName, extensionPath);
    let guest;
    let server;
    const errors = [];
    try {
      guest = await launchExtension(guestName, extensionPath);
      for (const browser of [host, guest]) {
        browser.context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
      }
      server = createServer({ databasePath: ':memory:', port: 0, allowedOrigins: [`chrome-extension://${host.id}`, `chrome-extension://${guest.id}`] });
      const address = await server.listen(0);
      const settings = { signalingUrl: `http://127.0.0.1:${address.port}`, stunUrls: [process.env.GHOSTPAIR_TEST_STUN ?? stun.url] };
      const hostPopup = await host.context.newPage();
      const guestPopup = await guest.context.newPage();
      await hostPopup.goto(`chrome-extension://${host.id}/popup.html`);
      await guestPopup.goto(`chrome-extension://${guest.id}/popup.html`);
      await call(hostPopup, 'ui.settings.save', { settings });
      await call(guestPopup, 'ui.settings.save', { settings });
      const hostPage = await host.context.newPage();
      await hostPage.goto(`${fixtureUrl}/`);
      const hostTab = await host.worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url), `${fixtureUrl}/`);
      assert.ok(hostTab?.id);
      await host.worker.evaluate(async (tabId) => chrome.tabs.update(tabId, { active: true }), hostTab.id);
      const password = 'Synthetic-session-42';
      await call(hostPopup, 'ui.host.start', { password, clipboard: false });
      const waiting = await waitState(hostPopup, (value) => value.status === 'waiting', 'host waiting');
      assert.ok(waiting.deviceId);
      let rejected = false;
      try { await call(guestPopup, 'ui.guest.start', { deviceId: waiting.deviceId, password: 'Incorrect-password', clipboard: false }); }
      catch { rejected = true; }
      if (!rejected) {
        await waitState(guestPopup, (value) => value.status === 'error', 'wrong password rejected');
      }
      assert.equal((await state(hostPopup)).status, 'waiting');
      await call(guestPopup, 'ui.stop');
      await call(guestPopup, 'ui.guest.start', { deviceId: waiting.deviceId, password, clipboard: false });
      await waitState(hostPopup, (value) => value.status === 'connected', 'host P2P connected', 30000);
      const connected = await waitState(guestPopup, (value) => value.status === 'connected', 'guest P2P connected', 30000);
      assert.equal(connected.connection?.direct, true);
      let viewer = guest.context.pages().find((page) => page.url() === `chrome-extension://${guest.id}/viewer.html`);
      if (!viewer) { viewer = await guest.context.newPage(); await viewer.goto(`chrome-extension://${guest.id}/viewer.html`); }
      await viewer.evaluate(() => {
        const observer = chrome.runtime.connect({ name: 'viewer' });
        globalThis.frameProbe = { generation: -1, count: 0 };
        observer.onMessage.addListener(message => {
          if (message.type === 'frame') {
            const generation = message.frame.meta.generation;
            const probe = globalThis.frameProbe;
            globalThis.frameProbe = { generation, count: generation === probe.generation ? probe.count + 1 : 1, meta: message.frame.meta };
          }
        });
        globalThis.frameObserver = observer;
      });
      await poll(() => viewer.locator('canvas').evaluate((canvas) => !canvas.classList.contains('invisible') && canvas.width > 300), 'decoded remote JPEG');
      await poll(() => viewer.evaluate(() => globalThis.frameProbe.count >= 3), 'stable initial capture');
      await remoteClick(hostPage, viewer, '#target');
      await poll(async () => (await hostPage.locator('#count').textContent()) === '1', 'remote click');
      const beforeDrag = await hostPage.evaluate(() => window.releases);
      const canvasBounds = await viewer.locator('canvas').boundingBox();
      await viewer.mouse.move(canvasBounds.x + canvasBounds.width / 2, canvasBounds.y + canvasBounds.height / 2);
      await viewer.mouse.down();
      await viewer.mouse.move(canvasBounds.x - 12, canvasBounds.y + canvasBounds.height / 2);
      await viewer.mouse.up();
      await poll(() => hostPage.evaluate(before => window.releases > before, beforeDrag), 'mouse released outside remote image');
      await remoteClick(hostPage, viewer, '#text');
      await viewer.keyboard.insertText('Remote á漢🙂');
      await poll(async () => (await hostPage.locator('#text').inputValue()) === 'Remote á漢🙂', 'remote Unicode');
      await remoteClick(hostPage, viewer, '#multiline');
      await viewer.keyboard.type('Line one');
      await viewer.keyboard.press('Enter');
      await viewer.keyboard.type('Line two');
      await poll(async () => (await hostPage.locator('#multiline').inputValue()) === 'Line one\nLine two', 'remote typing and Enter');

      await resizePage(host, hostPage, 820, 600);
      await host.worker.evaluate(async (tabId) => chrome.tabs.setZoom(tabId, 1.25), hostTab.id);
      await poll(() => viewer.locator('canvas').evaluate((canvas) => canvas.width === 820 && canvas.height === 600 && !canvas.classList.contains('invisible')), 'resized remote image');
      await remoteClick(hostPage, viewer, '#pixel');
      await poll(async () => (await hostPage.locator('#count').textContent()) === '2', 'remote small target at 125% zoom');

      await call(hostPopup, 'ui.pause', { paused: true });
      await waitState(guestPopup, (value) => value.paused, 'pause propagated');
      await call(hostPopup, 'ui.pause', { paused: false });
      await waitState(guestPopup, (value) => value.status === 'connected' && !value.paused, 'resume propagated');
      await poll(() => viewer.locator('canvas').evaluate((canvas) => !canvas.classList.contains('invisible')), 'image after resume');
      await call(hostPopup, 'ui.control', { enabled: false });
      await waitState(guestPopup, (value) => !value.controlEnabled, 'control withdrawn');
      await call(hostPopup, 'ui.control', { enabled: true });
      await waitState(guestPopup, (value) => value.controlEnabled, 'control restored');
      viewer.once('dialog', (dialog) => dialog.accept(`${fixtureUrl}/new`));
      await viewer.getByRole('button', { name: 'Abrir pestaña', exact: true }).click();
      const newState = await waitState(guestPopup, (value) => value.tabs.some((tab) => tab.url === `${fixtureUrl}/new` && tab.active), 'remote-created tab');
      const created = newState.tabs.find((tab) => tab.url === `${fixtureUrl}/new`);
      const actualTab = await host.worker.evaluate(async (tabId) => chrome.tabs.get(tabId), created.id);
      assert.equal(actualTab.windowId, hostTab.windowId, 'new tab stays inside authorized window');
      await poll(() => viewer.getByRole('button', { name: 'Cerrar GhostPair new tab', exact: true }).count(), 'new tab title');
      await viewer.getByRole('button', { name: 'Cerrar GhostPair new tab', exact: true }).click();
      await waitState(guestPopup, (value) => !value.tabs.some((tab) => tab.id === created.id), 'remote tab closed');
      await waitState(guestPopup, value => value.status === 'connected' && value.activeTabId === hostTab.id, 'capture returns to original tab');
      await server.close();
      await waitState(guestPopup, value => value.status === 'connected' && value.notice?.includes('servidor se desconectó'), 'P2P survives signaling shutdown');
      await poll(() => viewer.locator('canvas').evaluate(canvas => !canvas.classList.contains('invisible')), 'image after tab close');
      await poll(() => viewer.evaluate(() => globalThis.frameProbe.count >= 3), 'stable image after tab close');
      await remoteClick(hostPage, viewer, '#pixel');
      await poll(async () => (await hostPage.locator('#count').textContent()) === '3', 'remote click without signaling');
      await viewer.screenshot({ path: resolve(artifactRoot, `viewer-${pair.replace(':', '-')}.png`) });
      await call(hostPopup, 'ui.stop');
      await waitState(guestPopup, (value) => ['idle', 'error'].includes(value.status), 'peer stopped');
      assert.equal((await state(hostPopup)).status, 'idle');
      // getTargets().attached also counts Playwright's own CDP attachment.
      const extensionAttached = await host.worker.evaluate(async tabId => {
        try { await chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics'); return true; }
        catch { return false; }
      }, hostTab.id);
      assert.equal(extensionAttached, false, 'extension debugger detached on stop');
      assert.deepEqual(errors, [], 'no uncaught extension page errors');
      const result = { pair, hostVersion: host.version, guestVersion: guest.version,
        p2p: true, wrongPasswordRejected: true, capture: true, click: true, dragRelease: true, unicode: true, typingAndEnter: true, survivesSignalingShutdown: true,
        resizeAndZoom: true, pauseResume: true, controlToggle: true, createCloseTab: true,
        stop: true, clipboard: 'disabled; system clipboard never accessed', stunBindings: stun.bindings, server: server.stats };
      results.push(result);
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error(`Smoke failed for ${pair}: ${error.stack}`);
      for (const [name, instance] of [['host', host], ['guest', guest]]) if (instance) {
        console.error(name, JSON.stringify(await instance.worker.evaluate(async () => ({ state: (await chrome.storage.session.get('appState')).appState }))));
      }
      throw error;
    } finally {
      await closeBrowser(host);
      await closeBrowser(guest);
      await server?.close();
    }
  }
  await writeFile(resolve(artifactRoot, 'smoke-results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
} finally {
  await stun.close();
  await new Promise((resolve) => fixtureServer.close(resolve));
  await removeTestArtifact(extensionPath);
}
