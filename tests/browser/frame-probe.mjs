import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from '../../apps/signaling/dist/server.js';
import { launchExtension, closeBrowser, removeTestArtifact, poll, artifactRoot } from './helpers.mjs';
import { startStun } from './stun.mjs';

const fixture = httpServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const port = fixture.address().port;
  const child = request.url !== '/';
  response.end(`<!doctype html><meta charset="utf-8"><title>GhostPair embedded control fixture</title>
    <style>body{font:15px sans-serif;margin:10px;background:#fbf7e9}button,input{font:inherit;margin:5px;padding:5px}canvas{border:1px solid}#scroller{width:160px;height:45px;overflow:auto}#scroller>div{height:500px}.frames{display:flex;gap:12px}iframe{width:280px;height:280px;border:6px solid #567;padding:3px}#a{transform:scale(.9);transform-origin:top left}#nested{width:220px;height:120px;border:3px solid}#dynamic{position:absolute;left:10px;top:440px;width:280px;height:190px}#denied{position:absolute;left:340px;top:450px;width:200px;height:100px}#space{height:${child ? 0 : 1100}px}</style>
    ${child ? '<button id="button">Child button</button><input id="text"><div id="scroller"><div>Child scroll</div></div>' : '<h2>Authorized embedded control</h2><canvas id="canvas" width="230" height="60"></canvas><svg width="70" height="60"><rect id="svg" width="60" height="50" fill="#598"/></svg><label><input id="checkbox" type="checkbox">Toggle</label><button id="button">Root button</button>'}
    ${!child ? `<div class="frames"><iframe id="a" src="http://localhost:${port}/child"></iframe><iframe id="b" src="http://localhost:${port}/child"></iframe><iframe id="same" src="/nested-parent"></iframe></div><iframe id="denied" src="data:text/html,<button>Restricted fixture</button>"></iframe>` : request.url === '/nested-parent' ? `<iframe id="nested" src="http://localhost:${port}/child"></iframe>` : ''}
    <div id="space"></div><script>
      window.probe={clicks:[],downs:0,ups:0,keys:[],wheels:[]};
      document.querySelector('#button').addEventListener('click', e=>probe.clicks.push({x:e.clientX,y:e.clientY,trusted:e.isTrusted}));
      document.addEventListener('pointerdown',()=>probe.downs++);document.addEventListener('pointerup',()=>probe.ups++);
      document.addEventListener('keyup',e=>probe.keys.push(e.code));
      document.querySelector('#canvas')?.addEventListener('click',e=>probe.clicks.push({x:e.clientX,y:e.clientY,ctrl:e.ctrlKey,detail:e.detail,trusted:e.isTrusted}));
      document.querySelector('#svg')?.addEventListener('click',e=>probe.clicks.push({svg:true,x:e.clientX}));
      document.querySelector('#canvas')?.addEventListener('wheel',e=>{e.preventDefault();probe.wheels.push({x:e.clientX,dy:e.deltaY,ctrl:e.ctrlKey})},{passive:false});
    </script>`);
});
await new Promise(done => fixture.listen(0, done));
const base = `http://127.0.0.1:${fixture.address().port}`;
await mkdir(artifactRoot, { recursive: true });
const extensionPath = await mkdtemp(resolve(artifactRoot, 'frame-extension-'));
await cp(resolve('dist/extension'), extensionPath, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(extensionPath, 'manifest.json'), 'utf8'));
assert.ok(manifest.permissions.includes('webNavigation')); assert.ok(!manifest.permissions.includes('debugger'));
// Disposable profile grants; production host permissions remain optional.
manifest.host_permissions = ['http://*/*', 'https://*/*'];
await writeFile(resolve(extensionPath, 'manifest.json'), JSON.stringify(manifest));
const stun = await startStun(), results = [];
async function call(page, type, fields = {}) {
  const reply = await page.evaluate(({ type, fields }) => chrome.runtime.sendMessage({ target: 'background', type, ...fields }), { type, fields });
  if (!reply?.ok) throw new Error(reply?.error ?? type);
  return reply.state;
}
async function authorize(browser, page) {
  await page.bringToFront();
  const { targetInfos } = await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  await browser.cdp.send('Extensions.triggerAction', { id: browser.id, targetId: targetInfos.find(target => target.url === page.url()).targetId });
}
try {
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'edge']) {
    let host, guest, signal;
    try {
      host = await launchExtension(name, extensionPath); guest = await launchExtension(name, extensionPath);
      signal = createServer({ databasePath: ':memory:', port: 0, allowedOrigins: [`chrome-extension://${host.id}`, `chrome-extension://${guest.id}`] });
      const address = await signal.listen(0), settings = { signalingUrl: `http://127.0.0.1:${address.port}`, stunUrls: [stun.url] };
      const menu = await host.context.newPage(); await menu.goto(`chrome-extension://${host.id}/popup.html`);
      const viewer = await guest.context.newPage(); await viewer.goto(`chrome-extension://${guest.id}/viewer.html`);
      await call(menu, 'ui.settings.save', { settings }); await call(viewer, 'ui.settings.save', { settings });
      const page = await host.context.newPage(); await page.goto(base); await authorize(host, page);
      const start = await call(menu, 'ui.host.start', { password: 'Frames-42', clipboard: false }); assert.notEqual(start.status, 'error');
      const waiting = await poll(async () => { const s = await call(menu, 'ui.status'); return s.status === 'waiting' && s; }, 'host waiting');
      await viewer.getByLabel('Host address', { exact: true }).fill(waiting.deviceId);
      await viewer.getByLabel('Session password', { exact: true }).fill('Frames-42');
      await viewer.getByRole('button', { name: 'Connect →', exact: true }).click();
      const ready = () => poll(async () => {
        const s = await call(viewer, 'ui.status');
        const playing = await viewer.locator('video').evaluate(v => v.readyState >= 2 && v.videoWidth > 0 && v.dataset.generation);
        return s.status === 'connected' && s.presentation && Number(playing) === s.generation && s;
      }, 'current frame video', 30000);
      await ready();
      const command = async fields => { const s = await call(viewer, 'ui.status'); assert.ok(s.presentation); await call(viewer, 'ui.command', { command: { tabId: s.presentation.tabId, generation: s.generation, captureId: s.presentation.captureId, documentId: s.presentation.documentId, ...fields } }); };
      const point = async locator => { const box = await locator.boundingBox(); assert.ok(box); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
      const pointer = async (locator, event, extra = {}) => command({ type: 'pointer', ...await point(locator), event, button: 'left', buttons: event === 'up' ? 0 : 1, modifiers: 0, clickCount: 1, ...extra });
      const click = async (locator, extra) => { await pointer(locator, 'down', extra); await pointer(locator, 'up', extra); };
      const count = locator => locator.evaluate(() => probe.clicks.length);
      const a = page.frameLocator('#a'), b = page.frameLocator('#b'), same = page.frameLocator('#same'), nested = same.frameLocator('#nested');
      const canvas = page.locator('#canvas'), canvasPoint = await point(canvas);
      await click(canvas, { modifiers: 2 });
      const canvasClick = await page.evaluate(() => probe.clicks[0]);
      assert.deepEqual({ ctrl: canvasClick.ctrl, detail: canvasClick.detail, trusted: canvasClick.trusted }, { ctrl: true, detail: 1, trusted: false });
      assert.ok(Math.abs(canvasClick.x - canvasPoint.x) < 1 && Math.abs(canvasClick.y - canvasPoint.y) < 1, 'click coordinates retain CSS-pixel precision');
      await command({ type: 'wheel', ...canvasPoint, deltaX: 0, deltaY: 120, modifiers: 2 });
      assert.equal(await page.evaluate(() => scrollY), 0); assert.equal(await page.evaluate(() => probe.wheels[0].dy), 120);
      await click(page.locator('#svg')); assert.equal(await page.evaluate(() => probe.clicks.at(-1).svg), true);
      await click(page.locator('#checkbox')); assert.equal(await page.locator('#checkbox').isChecked(), true);
      await click(page.locator('#checkbox')); assert.equal(await page.locator('#checkbox').isChecked(), false);
      for (const frame of [a, b, same, nested]) {
        await click(frame.locator('#button')); assert.equal(await count(frame.locator('#button')), 1);
        await click(frame.locator('#text')); await command({ type: 'text', text: 'Remote á漢🙂' });
        assert.equal(await frame.locator('#text').inputValue(), 'Remote á漢🙂');
        const xy = await point(frame.locator('#scroller'));
        await command({ type: 'wheel', ...xy, deltaX: 0, deltaY: 80, modifiers: 0 });
        assert.equal(await frame.locator('#scroller').evaluate(e => e.scrollTop), 80);
      }
      // Child script worlds are isolated from page JavaScript, including cross-origin children.
      assert.equal(await a.locator('#button').evaluate(() => typeof globalThis.__ghostpairControl), 'undefined');
      await page.evaluate(() => window.postMessage({ target: 'ghostpair.dom', operation: 'command', command: { type: 'text', text: 'spoofed' } }, '*'));
      assert.equal(await nested.locator('#text').inputValue(), 'Remote á漢🙂');
      const beforeGeneration = (await call(viewer, 'ui.status')).generation;
      await assert.rejects(() => click(page.locator('#denied')), /access|loading|control|changed/i);
      assert.equal((await call(viewer, 'ui.status')).generation, beforeGeneration); await ready();
      await click(b.locator('#button')); assert.equal(await count(b.locator('#button')), 2);
      await page.locator('#a').evaluate(e => { e.style.transform = 'rotate(4deg)'; });
      await assert.rejects(() => click(a.locator('#button')), /rotation|skew|perspective/);
      await page.locator('#a').evaluate(e => { e.style.transform = 'scale(.9)'; });
      await click(a.locator('#button')); assert.equal(await count(a.locator('#button')), 2);
      await page.evaluate(base => { const f = document.createElement('iframe'); f.id = 'dynamic'; f.src = `${base}/child`; document.body.append(f); }, base);
      const dynamic = page.frameLocator('#dynamic'); await dynamic.locator('#button').waitFor();
      await click(dynamic.locator('#button')); assert.equal(await count(dynamic.locator('#button')), 1);
      await pointer(a.locator('#button'), 'down');
      await page.locator('#a').evaluate(e => { e.src = e.src + '?replacement'; });
      await poll(() => a.locator('#button').evaluate(() => location.search === '?replacement'), 'replacement document');
      await assert.rejects(() => pointer(a.locator('#button'), 'up'), /changed/);
      assert.equal(await count(a.locator('#button')), 0); await click(a.locator('#button')); assert.equal(await count(a.locator('#button')), 1);
      // State-preserving DOM moves relocate a live document without changing its URL.
      const beforeMove = await point(a.locator('#button'));
      await pointer(a.locator('#button'), 'down');
      await page.evaluate(() => { const container = document.querySelector('.frames'); container.moveBefore(document.querySelector('#b'), document.querySelector('#a')); });
      await assert.rejects(() => command({ type: 'pointer', ...beforeMove, event: 'up', button: 'left', buttons: 0, modifiers: 0, clickCount: 1 }), /changed/);
      assert.equal(await count(a.locator('#button')), 1); await click(a.locator('#button')); assert.equal(await count(a.locator('#button')), 2);
      const releases = await b.locator('#button').evaluate(() => probe.ups);
      const presses = await b.locator('#button').evaluate(() => probe.downs);
      await pointer(b.locator('#button'), 'down');
      assert.equal(await b.locator('#button').evaluate(() => probe.downs), presses + 1, 'held press reaches its original child');
      await call(menu, 'ui.control', { enabled: false });
      await poll(() => b.locator('#button').evaluate((_element, expected) => probe.ups > expected, releases), 'child release on control withdrawal');
      await ready(); await call(menu, 'ui.control', { enabled: true });
      await pointer(b.locator('#button'), 'down'); await call(menu, 'ui.pause', { paused: true });
      await call(menu, 'ui.pause', { paused: false }); await ready();
      await click(b.locator('#button')); assert.equal(await count(b.locator('#button')), 3);
      const visual = await host.worker.evaluate(async () => ({ badge: await chrome.action.getBadgeText({}), title: await chrome.action.getTitle({}), capture: (await chrome.tabCapture.getCapturedTabs()).some(t => t.status === 'active') }));
      assert.deepEqual(visual, { badge: '', title: 'GhostPair', capture: true });
      await viewer.screenshot({ path: resolve(artifactRoot, `frames-${name}.png`) });
      await call(menu, 'ui.stop');
      await poll(async () => !(await host.worker.evaluate(() => chrome.tabCapture.getCapturedTabs())).some(t => t.status === 'active'), 'native capture stopped');
      const controllers = await host.worker.evaluate(async tabId => {
        const frames = await chrome.webNavigation.getAllFrames({ tabId });
        return Promise.all(frames.filter(frame => /^https?:/.test(frame.url)).map(async frame => (await chrome.scripting.executeScript({ target: { tabId, documentIds: [frame.documentId] }, world: 'ISOLATED', func: () => Boolean(globalThis.__ghostpairControl) }))[0].result));
      }, waiting.presentation.tabId);
      assert.ok(controllers.every(value => value === false), 'all document controllers disposed');
      results.push({ browser: name, version: host.version, isolatedWorlds: true, crossOriginSiblings: true, nested: true, canvas: true, scaledBorders: true, dynamic: true, navigationAndReordering: true, nativeVideo: true, badge: '', passed: true });
      console.log(JSON.stringify(results.at(-1)));
    } finally { await signal?.close(); await closeBrowser(guest); await closeBrowser(host); }
  }
  await writeFile(resolve(artifactRoot, 'frame-control-results.json'), JSON.stringify(results, null, 2));
} finally { await stun.close(); await new Promise(done => fixture.close(done)); await removeTestArtifact(extensionPath); }
