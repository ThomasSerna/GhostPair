import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../apps/signaling/dist/server.js';
import { launchExtension, closeBrowser, removeTestArtifact, poll, resizePage, artifactRoot, browsers } from '../tests/browser/helpers.mjs';
import { startStun } from '../tests/browser/stun.mjs';

// Run npm run build first. Export actual isolated extension UI, without its runtime.
const output = resolve('docs/assets/previews'), comparisons = resolve(artifactRoot, 'previews');
await mkdir(output, { recursive: true });
await mkdir(comparisons, { recursive: true });
await cp(resolve('apps/extension/src/styles.css'), resolve(output, 'extension.css'));
const policy = `default-src 'none'; style-src 'self' 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'`;
const previews = [], geometry = [];
function documentHtml(name, markup, bodyFont) {
  const labels = { 'share-tab': 'GhostPair sharing example with a session password, tab sharing consent, and Share current tab button.', 'connect-host': 'GhostPair connection example with a host address, session password, and Connect button.', 'remote-viewer': 'Connected GhostPair viewer example with an approved shared page, browser tab, and navigation controls.' };
  // Chrome gives extension documents a platform body font. Preserve that computed baseline on the web.
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>GhostPair · ${name} example</title><link rel="stylesheet" href="extension.css"></head><body style="font:${bodyFont.replaceAll('"', '&quot;')}" role="img" aria-label="${labels[name]}">${markup}</body></html>\n`;
}
// Same selectors and computed geometry are checked in the real and exported pages.
function describe() {
  return [...document.querySelectorAll('main,main .brand,main .brand svg,main header,main h1,main label,main button,main input,main footer,main .remote-tabs,main .navigation,main .remote-stage')].map(element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { tag: element.tagName, class: element.className?.baseVal ?? element.className, bounds: [rect.x, rect.y, rect.width, rect.height].map(value => +value.toFixed(2)), font: style.font, color: style.color, background: style.backgroundColor, opacity: style.opacity };
  });
}
async function exportPreview(page, name, width, height, frame) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(200); // Allow the extension's enabled-button opacity transition to settle.
  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).font);
  const reference = await page.evaluate(describe);
  const markup = await page.evaluate(({ frame }) => {
    const original = document.querySelector('main'), main = original.cloneNode(true);
    const fields = original.querySelectorAll('input,textarea,option');
    main.querySelectorAll('input,textarea,option').forEach((field, index) => {
      const value = fields[index];
      if (field instanceof HTMLInputElement) { field.value = value.value; field.setAttribute('value', value.value); field.toggleAttribute('checked', value.checked); }
      else if (field instanceof HTMLTextAreaElement) field.textContent = value.value;
      else field.toggleAttribute('selected', value.selected);
    });
    main.setAttribute('inert', '');
    main.querySelectorAll('script').forEach(script => script.remove());
    for (const element of main.querySelectorAll('*')) for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
    if (frame) {
      const video = main.querySelector('video'), box = document.createElement('div'), iframe = document.createElement('iframe');
      main.querySelector('.remote-stage').style.containerType = 'size';
      box.className = 'preview-frame';
      Object.assign(box.style, { position: 'relative', flexShrink: '0', width: `min(100cqw, calc(100cqh * ${frame.sourceWidth / frame.sourceHeight}))`, height: `min(100cqh, calc(100cqw / ${frame.sourceWidth / frame.sourceHeight}))`, overflow: 'hidden', borderRadius: frame.borderRadius, boxShadow: frame.boxShadow });
      iframe.src = 'shared-page.html'; iframe.title = 'Example shared page'; iframe.tabIndex = -1; iframe.setAttribute('sandbox', 'allow-same-origin');
      Object.assign(iframe.style, { position: 'absolute', border: '0', width: `${frame.sourceWidth}px`, height: `${frame.sourceHeight}px`, left: '0', top: '0', zoom: `min(calc(100cqw / ${frame.sourceWidth}px), calc(100cqh / ${frame.sourceHeight}px))` });
      box.append(iframe); video.replaceWith(box);
      main.querySelectorAll('[data-generation]').forEach(element => element.removeAttribute('data-generation'));
    }
    return main.outerHTML;
  }, { frame });
  await writeFile(resolve(output, `${name}.html`), documentHtml(name, markup, bodyFont));
  await page.screenshot({ path: resolve(comparisons, `${name}-original.png`), clip: { x: 0, y: 0, width, height } });
  previews.push({ name, width, height, reference, frame });
}
const demoHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Our weekend plans</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f5ee;color:#193d30;font:18px/1.5 'Segoe UI',sans-serif}main{max-width:1050px;margin:auto;padding:56px 48px}header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #d5dfd2;padding-bottom:22px}.label{font-size:12px;font-weight:650;letter-spacing:2px;text-transform:uppercase}.demo{font-size:12px;background:#e0ebdf;border:1px solid #cadbc7;padding:5px 12px;border-radius:30px;animation:live 2s infinite alternate}@keyframes live{to{background:#cadbc7}}h1{font-size:48px;letter-spacing:-2px;line-height:1.15;margin:34px 0 14px;font-weight:600}.intro{color:#607465;max-width:630px;margin:0;font-size:19px}.cards{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:34px}.card{background:#fffef8;border:1px solid #d5dfd2;border-radius:17px;padding:25px}h2{margin:0 0 18px;font-size:22px;font-weight:600;letter-spacing:-.5px}label{display:flex;align-items:center;gap:10px;margin-top:16px;font-size:16px}input[type=checkbox]{accent-color:#416949;width:17px;height:17px}textarea{width:100%;min-height:130px;resize:none;border:1px solid #d1dcca;background:#f6f8f1;border-radius:10px;padding:14px;font:16px/1.6 'Segoe UI',sans-serif;color:#244933;outline:none}.tip{font-size:13px;color:#607465;margin:20px 0 0}footer{display:flex;justify-content:space-between;margin-top:25px;font-size:13px;color:#697b6c}
</style></head><body><main><header><span class="label">Our weekend plans</span><span class="demo">Demo page</span></header><h1>Make a little room for adventure.</h1><p class="intro">Pick a place, make a plan, and work through the details together.</p><section class="cards"><article class="card"><h2>The short list</h2><label><input type="checkbox" checked>Choose a nearby trail</label><label><input type="checkbox" checked>Check the weather</label><label><input type="checkbox">Pack lunch for two</label><label><input type="checkbox">Save a spot for coffee</label></article><article class="card"><h2>A few notes</h2><textarea aria-label="Trip notes">Saturday, 9:00 AM\nAn easy trail and a picnic by the lake.\nBring a camera and a light jacket.</textarea><p class="tip">Leave a thought here while we browse.</p></article></section><footer><span>One page. Two perspectives.</span><span>Ready when you are →</span></footer></main></body></html>`;
const fixture = createHttpServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/weekend-plans') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(demoHtml); return; }
  const target = resolve('docs', `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!target.startsWith(`${resolve('docs')}\\`) && !target.startsWith(`${resolve('docs')}/`)) { response.writeHead(404); response.end(); return; }
  try { const content = await readFile(target); response.setHeader('Content-Type', target.endsWith('.css') ? 'text/css' : target.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8'); response.end(content); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise(done => fixture.listen(0, '127.0.0.1', done));
const demoUrl = `http://127.0.0.1:${fixture.address().port}/weekend-plans`;
const signal = createServer({ databasePath: ':memory:', port: 0 });
const signalAddress = await signal.listen(0);
const stun = await startStun();
const settings = { signalingUrl: `http://127.0.0.1:${signalAddress.port}`, stunUrls: [stun.url] };
const paths = [];
let host, guest, previewBrowser;
const errors = [];
const call = (page, type, fields = {}) => page.evaluate(async ({ type, fields }) => { const result = await chrome.runtime.sendMessage({ target: 'background', type, ...fields }); if (!result?.ok) throw new Error(result?.error ?? type); return result.state; }, { type, fields });
try {
  for (const role of ['host', 'guest']) {
    const path = await mkdtemp(resolve(artifactRoot, `landing-${role}-extension-`)); paths.push(path);
    await cp(resolve('dist/extension'), path, { recursive: true });
    const manifest = JSON.parse(await readFile(resolve(path, 'manifest.json'), 'utf8'));
    manifest.host_permissions = ['http://*/*', 'https://*/*'];
    await writeFile(resolve(path, 'manifest.json'), JSON.stringify(manifest));
  }
  host = await launchExtension('chrome', paths[0]);
  guest = await launchExtension('chrome', paths[1], { nativeVisibility: true });
  assert.notEqual(host.id, guest.id);
  for (const browser of [host, guest]) browser.context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const popup = await host.context.newPage(); await popup.goto(`chrome-extension://${host.id}/popup.html`);
  await popup.setViewportSize({ width: 398, height: 800 });
  await popup.getByRole('button', { name: 'Share current tab →' }).waitFor();
  await popup.getByLabel('Session password', { exact: true }).fill('Example-42');
  await popup.getByLabel('I authorize sharing', { exact: false }).check();
  await exportPreview(popup, 'share-tab', 398, 694);

  const viewer = await guest.context.newPage(); await viewer.goto(`chrome-extension://${guest.id}/viewer.html`);
  await resizePage(guest, viewer, 512, 660);
  await viewer.getByRole('heading', { name: 'Connect with your host.' }).waitFor();
  await viewer.getByLabel('Host address', { exact: true }).fill('0123456789abcdef0123456789abcdef');
  await viewer.getByLabel('Session password', { exact: true }).fill('Example-42');
  await exportPreview(viewer, 'connect-host', 512, 660);

  await call(popup, 'ui.settings.save', { settings });
  await call(viewer, 'ui.settings.save', { settings });
  const source = await host.context.newPage(); await source.goto(demoUrl);
  await resizePage(host, source, 1200, 760); await source.bringToFront();
  const tabId = await host.worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, demoUrl);
  // The actual host panel uses a closed shadow root; retain it only in this test profile for export.
  await host.worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { const shadow = attach.call(this, options); if (this.hasAttribute('data-ghostpair-panel')) globalThis.__previewPanel = shadow; return shadow; };
  } }), tabId);
  const { targetInfos } = await host.cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  await host.cdp.send('Extensions.triggerAction', { id: host.id, targetId: targetInfos.find(target => target.url === demoUrl).targetId });
  await call(popup, 'ui.host.start', { password: 'Example-42', clipboard: false });
  const waiting = await poll(async () => { const state = await call(popup, 'ui.status'); return state.status === 'waiting' && state.presentation && state; }, 'demo host sharing', 30000);
  await popup.close();
  for (const page of host.context.pages()) if (page.url() === 'about:blank') await page.close();
  await viewer.getByLabel('Host address', { exact: true }).fill(waiting.deviceId);
  await viewer.getByLabel('Session password', { exact: true }).fill('Example-42');
  await viewer.bringToFront(); await viewer.getByRole('button', { name: 'Connect →', exact: true }).click();
  await resizePage(guest, viewer, 1365, 900);
  await poll(() => viewer.evaluate(() => { const video = document.querySelector('video'); return video?.dataset.generation && video.readyState >= 2 && video.videoWidth > 0; }), 'real shared video frame', 30000);
  await poll(() => viewer.locator('video').evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames >= 90), 'steady shared video quality', 30000);
  await viewer.getByText('Session connected', { exact: true }).waitFor();
  assert.equal(await viewer.getByRole('tab', { name: 'Our weekend plans', exact: false }).getAttribute('aria-selected'), 'true');
  assert.equal(await viewer.getByLabel('Remote keyboard input').isDisabled(), false);
  const [panel] = await host.worker.evaluate(tabId => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: () => {
    const root = globalThis.__previewPanel, clone = root.host.cloneNode(true), template = document.createElement('template');
    template.setAttribute('shadowrootmode', 'closed'); template.innerHTML = root.innerHTML;
    [...template.content.querySelectorAll('input')].forEach((input, index) => input.toggleAttribute('checked', root.querySelectorAll('input')[index].checked));
    clone.append(template); clone.setAttribute('inert', ''); return { original: root.host.outerHTML, exported: clone.outerHTML };
  } }), tabId);
  let shared = await source.evaluate(policy => {
    const html = document.documentElement.cloneNode(true), csp = document.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy'; csp.content = policy;
    html.setAttribute('inert', ''); html.querySelector('head').append(csp);
    html.querySelectorAll('script').forEach(script => script.remove()); return html.outerHTML;
  }, policy);
  shared = shared.replace(panel.result.original, panel.result.exported);
  assert.ok(shared.includes('shadowrootmode="closed"'), 'actual host panel exported');
  await writeFile(resolve(output, 'shared-page.html'), `<!doctype html>\n${shared}\n`);
  const frame = await viewer.locator('video').evaluate(video => { const rect = video.getBoundingClientRect(), style = getComputedStyle(video); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, borderRadius: style.borderRadius, boxShadow: style.boxShadow }; });
  frame.sourceWidth = 1200; frame.sourceHeight = 760;
  await exportPreview(viewer, 'remote-viewer', 1365, 900, frame);
  for (const preview of previews) {
    const path = resolve(output, `${preview.name}.html`), html = await readFile(path, 'utf8');
    assert.ok(!html.includes(waiting.deviceId) && !html.includes(waiting.sessionId), 'session credentials are excluded');
    await writeFile(path, html.replaceAll(demoUrl, 'http://127.0.0.1:8787/weekend-plans'));
  }

  previewBrowser = await chromium.launch({ executablePath: browsers.chrome, headless: true });
  const context = await previewBrowser.newContext();
  const page = await context.newPage(), unexpectedRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(`http://127.0.0.1:${fixture.address().port}/`)) unexpectedRequests.push(request.url()); });
  for (const preview of previews) {
    await page.setViewportSize({ width: preview.width, height: preview.height });
    await page.goto(`http://127.0.0.1:${fixture.address().port}/assets/previews/${preview.name}.html`);
    assert.deepEqual(await page.evaluate(describe), preview.reference, `${preview.name}: exact extension geometry and styles`);
    assert.equal(await page.locator('script,video').count(), 0);
    assert.equal(await page.locator('main').getAttribute('inert'), '');
    assert.equal(await page.locator('body').getAttribute('role'), 'img');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY', 'example controls cannot receive keyboard focus');
    if (preview.frame) {
      const box = await page.locator('.preview-frame').boundingBox();
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(box[key] - preview.frame[key]) < 0.01, `shared page preserves video ${key}`);
      await page.frameLocator('iframe').getByRole('heading', { name: 'Make a little room for adventure.', includeHidden: true }).waitFor();
    }
    await page.screenshot({ path: resolve(comparisons, `${preview.name}-html.png`) });
    geometry.push({ name: preview.name, width: preview.width, height: preview.height, elements: preview.reference.length, exactGeometry: true, inert: true });
  }
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`http://127.0.0.1:${fixture.address().port}/assets/previews/remote-viewer.html`);
    const fit = await page.locator('.preview-frame').evaluate(frame => { const box = frame.getBoundingClientRect(), stage = frame.parentElement.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, stageX: stage.x, stageY: stage.y, stageRight: stage.right, stageBottom: stage.bottom, width: box.width, height: box.height }; });
    assert.ok(fit.x >= fit.stageX && fit.y >= fit.stageY && fit.right <= fit.stageRight && fit.bottom <= fit.stageBottom, `${width}: standalone shared page fits without clipping`);
    assert.ok(Math.abs(fit.width / fit.height - 1200 / 760) < 0.001, `${width}: standalone shared page preserves its aspect ratio`);
    await page.setViewportSize({ width, height: 900 }); await page.goto(`http://127.0.0.1:${fixture.address().port}/`);
    await page.waitForFunction(() => [...document.querySelectorAll('.preview-stage iframe')].length === 3 && [...document.querySelectorAll('.preview-stage iframe')].every(frame => getComputedStyle(frame).transform !== 'none'));
    for (const frame of await page.locator('.preview-stage iframe').all()) {
      const boxes = await frame.evaluate(frame => { const box = frame.getBoundingClientRect(), stage = frame.parentElement.getBoundingClientRect(), scale = new DOMMatrixReadOnly(getComputedStyle(frame).transform); return { width: box.width, height: box.height, stageWidth: stage.width, stageHeight: stage.height, scale: scale.a, originalWidth: Number(frame.getAttribute('width')) }; });
      assert.ok(Math.abs(boxes.width - boxes.stageWidth) < 1 && Math.abs(boxes.height - boxes.stageHeight) < 1, `${width}: uniform preview scaling fills stage`);
      assert.ok(Math.abs(boxes.scale * boxes.originalWidth - boxes.stageWidth) < 1, `${width}: original preview width is scaled`);
    }
  }
  assert.deepEqual(unexpectedRequests, []);
  const retina = await previewBrowser.newContext({ deviceScaleFactor: 2, viewport: { width: 375, height: 900 } });
  const retinaPage = await retina.newPage();
  await retinaPage.goto(`http://127.0.0.1:${fixture.address().port}/`);
  const previewDpr = await retinaPage.frameLocator('.popup-preview iframe').locator('body').evaluate(() => devicePixelRatio);
  assert.equal(previewDpr, 2, 'embedded examples retain high-density text and SVG rendering');
  await retina.close();
  assert.equal(await readFile(resolve(output, 'extension.css'), 'utf8'), await readFile('apps/extension/src/styles.css', 'utf8'));
  await writeFile(resolve(comparisons, 'geometry.json'), JSON.stringify(geometry, null, 2));
  assert.deepEqual(errors, []);
  await call(viewer, 'ui.stop');
  console.log('Three native HTML examples exported from real UI; exact geometry/styles, static inert safety and landing scaling verified.');
} finally {
  await previewBrowser?.close();
  await closeBrowser(guest); await closeBrowser(host);
  await signal.close(); await stun.close();
  await new Promise(done => fixture.close(done));
  for (const path of paths) await removeTestArtifact(path);
}
