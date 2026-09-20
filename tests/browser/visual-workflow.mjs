import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { artifactRoot, poll } from './helpers.mjs';

/** Exercise shipped control over WebRTC; observe closed shadows only in isolated test profiles. */
export async function visualWorkflow(page, viewer, menu, call, ready, { embedded, pair }) {
  await ready();
  const hostTab = (await call(menu, 'ui.status')).activeTabId;
  // Observe extension-owned editors without altering their behavior or the package.
  await menu.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'ISOLATED', func: () => {
    globalThis.__gpLocalMessages = [];
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (...args) => { const reply = await send(...args); if (args[0]?.type === 'dom.visual') globalThis.__gpLocalMessages.push({ operation: args[0].operation, token: args[0].token, reply }); return reply; };
    for (const type of ['dragstart', 'dragenter', 'dragover', 'drop', 'dragend']) window.addEventListener(type, e => globalThis.__gpLocalMessages.push({ event: type, types: [...(e.dataTransfer?.types ?? [])], x: e.clientX, y: e.clientY }), true);
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { const shadow = attach.call(this, options); if (this.hasAttribute('data-ghostpair-visual')) globalThis.__gpTestPreview = shadow; return shadow; };
  } }), hostTab);
  const editorValues = () => menu.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'ISOLATED', func: () => [...(globalThis.__gpTestPreview?.querySelectorAll('[data-gp-editor]') ?? [])].map(e => e.value) })).flatMap(entry => entry.result), hostTab);
  const content = embedded ? page.frameLocator('#questionnaire') : page;
  const form = content.locator('#quiz');
  const before = await form.evaluate(e => ({ html: e.outerHTML, focus: e.ownerDocument.activeElement.tagName, values: [...e.querySelectorAll('input')].map(e => [e.value, e.checked]) }));
  const click = async selector => {
    const box = await content.locator(selector).boundingBox(), video = await viewer.locator('video').boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(box && video);
    await viewer.mouse.click(video.x + (box.x + box.width / 2) / viewport.width * video.width, video.y + (box.y + box.height / 2) / viewport.height * video.height);
  };
  const accentPixels = (accent = 'violet') => viewer.locator('video').evaluate((video, accent) => {
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) if (accent === 'violet'
      ? pixels[i + 2] > pixels[i] + 35 && pixels[i + 2] > pixels[i + 1] + 35
      : pixels[i + 1] > pixels[i] + 60 && pixels[i + 2] > pixels[i] + 60) total++;
    return total;
  }, accent);
  await call(menu, 'ui.visual.preferences', { preferences: { notices: false, clickAnimations: false, text: { duration: 'persistent', seconds: 10 }, other: { duration: 'persistent', seconds: 3 } } });
  const basePixels = await accentPixels();
  await click('#choice-label'); await click('#r2'); await click('#text');
  const bounds = await content.locator('#text').boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const textPixels = () => viewer.locator('video').evaluate((video, { bounds, viewport }) => {
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
    const sx = canvas.width / viewport.width, sy = canvas.height / viewport.height;
    const pixels = ctx.getImageData((bounds.x + 5) * sx, (bounds.y + 4) * sy, (bounds.width - 10) * sx, (bounds.height - 8) * sy).data;
    let total = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 150 && pixels[i + 1] < 150 && pixels[i + 2] < 150) total++;
    return total;
  }, { bounds, viewport });
  const beforeText = await textPixels();
  await viewer.keyboard.insertText('Visual á漢🙂');
  await poll(async () => await accentPixels() > basePixels + 20, 'simulated states visible in the received video');
  // A delivery barrier ensures assertions include all preceding page input.
  const state = await call(viewer, 'ui.status');
  await call(viewer, 'ui.command', { command: { type: 'key', event: 'up', key: '', code: 'Barrier', keyCode: 0, modifiers: 0, repeat: false, tabId: state.activeTabId, captureId: state.presentation.captureId, documentId: state.presentation.documentId, generation: state.generation, controlRevision: state.controlRevision } });
  await poll(async () => await textPixels() > beforeText + 20, 'simulated text visible in the received video');
  await viewer.keyboard.press('Escape');
  assert.equal(await content.locator('[data-ghostpair-visual]').count(), 1);
  assert.deepEqual(await form.evaluate(e => ({ html: e.outerHTML, focus: e.ownerDocument.activeElement.tagName, values: [...e.querySelectorAll('input')].map(e => [e.value, e.checked]) })), before);
  assert.deepEqual(await form.evaluate(() => quizProbe.events), []);
  assert.deepEqual(await form.evaluate(() => quizProbe.changes), []);
  assert.deepEqual(await form.evaluate(() => quizProbe.submits), []);
  assert.equal(await menu.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'ISOLATED', func: () => globalThis.__gpTestPreview?.querySelectorAll('[data-gp-click]').length ?? 0 })).reduce((n, entry) => n + entry.result, 0), hostTab), 0, 'disabled click animations stay absent in authorized frames');
  const beforeCyan = await accentPixels('cyan');
  await call(menu, 'ui.visual.preferences', { preferences: { notices: false, clickAnimations: false, text: { duration: 'persistent', seconds: 10 }, other: { duration: 'persistent', seconds: 3 }, accentColor: '#12abcd' } });
  await poll(async () => await accentPixels('cyan') > beforeCyan + 20, 'updated custom color visible in the received video');
  assert.ok(await textPixels() > beforeText + 20, 'changing color preserves the simulated text');
  await page.screenshot({ path: resolve(artifactRoot, `visual-${pair.replace(':', '-')}-${embedded ? 'frame' : 'root'}-host.png`) });
  await viewer.screenshot({ path: resolve(artifactRoot, `visual-${pair.replace(':', '-')}-${embedded ? 'frame' : 'root'}-viewer.png`) });
  await page.bringToFront();
  const source = await content.locator('#text').boundingBox();
  await page.mouse.click(source.x + 20, source.y + source.height / 2);
  await page.keyboard.press('Control+a'); await page.keyboard.insertText('Host shared');
  await poll(async () => (await editorValues()).includes('Host shared'), 'host edits simulated text');
  assert.equal(await content.locator('#text').inputValue(), '');
  // A fresh destination in the root also exercises child-to-parent transfers.
  await page.evaluate(() => {
    const field = document.createElement('textarea'); field.id = 'visual-destination';
    field.style.cssText = 'position:fixed;left:40px;bottom:18px;width:260px;height:60px;font:18px sans-serif'; document.body.append(field);
  });
  await page.keyboard.press('Control+a');
  const destination = await page.locator('#visual-destination').boundingBox();
  await page.mouse.move(source.x + 15, source.y + source.height / 2);
  await page.mouse.down(); await new Promise(resolve => setTimeout(resolve, 150));
  await page.mouse.move(source.x + 30, source.y + source.height / 2, { steps: 5 });
  await page.mouse.move(destination.x + 12, destination.y + 20, { steps: 20 });
  await page.mouse.up();
  if (embedded) {
    // Chromium's isolated-frame drag source is real; send the trusted target
    // events explicitly because Playwright's mouse drag interceptor owns only
    // the root renderer session.
    const token = await poll(() => menu.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'ISOLATED', func: () => globalThis.__gpLocalMessages?.findLast(e => e.operation === 'drag.start')?.token })).map(e => e.result).find(Boolean), hostTab), 'cross-frame drag token');
    const cdp = await page.context().newCDPSession(page);
    const data = { items: [{ mimeType: 'application/x-ghostpair-text', data: token }, { mimeType: 'text/plain', data: 'Host shared' }], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: destination.x + 12, y: destination.y + 20, data });
    await cdp.detach();
  }
  try { await poll(async () => { const values = await editorValues(); return values.includes('Host shared') && values.includes(''); }, 'host drag moves text to a fresh field'); }
  catch (error) { const messages = await menu.evaluate(async tabId => chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'ISOLATED', func: () => globalThis.__gpLocalMessages }), hostTab); throw new Error(error.message + JSON.stringify({ values: await editorValues(), messages })); }
  assert.equal(await content.locator('#text').inputValue(), '');
  assert.equal(await page.locator('#visual-destination').inputValue(), '');
  await page.locator('#visual-destination').evaluate(e => e.remove());
  await viewer.bringToFront();
  const presentation = (await call(menu, 'ui.status')).presentation;
  await call(menu, 'ui.visual.clear');
  await poll(async () => await content.locator('[data-ghostpair-visual]').count() === 0, 'manual preview cleanup');
  assert.deepEqual((await call(menu, 'ui.status')).presentation, presentation, 'clearing previews does not restart media');
  const prefs = { notices: true, clickAnimations: true, text: { duration: 'temporary', seconds: 0.5 }, other: { duration: 'temporary', seconds: 0.5 } };
  await call(menu, 'ui.visual.preferences', { preferences: prefs });
  await poll(async () => (await call(viewer, 'ui.status')).controlRevision > state.controlRevision, 'clear revision received');
  await click('#text'); await viewer.keyboard.insertText('Temporary');
  await poll(async () => await content.locator('[data-ghostpair-visual]').count() === 1, 'temporary preview');
  await poll(async () => await content.locator('[data-ghostpair-visual]').count() === 0, 'preview expires in every frame');
  assert.equal(await content.locator('#text').inputValue(), '');
  await call(menu, 'ui.visual.preferences', { preferences: { notices: false, clickAnimations: true, text: { duration: 'persistent', seconds: 10 }, other: { duration: 'persistent', seconds: 3 } } });
}
