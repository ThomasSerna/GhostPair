import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { artifactRoot, poll } from './helpers.mjs';

/** Exercise the shipped extension over WebRTC; no controller inspection hooks. */
export async function visualWorkflow(page, viewer, menu, call, ready, { embedded, pair }) {
  await ready();
  const content = embedded ? page.frameLocator('#questionnaire') : page;
  const form = content.locator('#quiz');
  const before = await form.evaluate(e => ({ html: e.outerHTML, focus: e.ownerDocument.activeElement.tagName, values: [...e.querySelectorAll('input')].map(e => [e.value, e.checked]) }));
  const click = async selector => {
    const box = await content.locator(selector).boundingBox(), video = await viewer.locator('video').boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(box && video);
    await viewer.mouse.click(video.x + (box.x + box.width / 2) / viewport.width * video.width, video.y + (box.y + box.height / 2) / viewport.height * video.height);
  };
  const violetPixels = () => viewer.locator('video').evaluate(video => {
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2] > pixels[i] + 35 && pixels[i + 2] > pixels[i + 1] + 35) total++;
    return total;
  });
  await call(menu, 'ui.visual.preferences', { preferences: { notices: false, duration: 'persistent', seconds: 3 } });
  const basePixels = await violetPixels();
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
  await poll(async () => await violetPixels() > basePixels + 20, 'simulated states visible in the received video');
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
  await page.screenshot({ path: resolve(artifactRoot, `visual-${pair.replace(':', '-')}-${embedded ? 'frame' : 'root'}-host.png`) });
  await viewer.screenshot({ path: resolve(artifactRoot, `visual-${pair.replace(':', '-')}-${embedded ? 'frame' : 'root'}-viewer.png`) });
  const presentation = (await call(menu, 'ui.status')).presentation;
  await call(menu, 'ui.visual.clear');
  await poll(async () => await content.locator('[data-ghostpair-visual]').count() === 0, 'manual preview cleanup');
  assert.deepEqual((await call(menu, 'ui.status')).presentation, presentation, 'clearing previews does not restart media');
  const prefs = { notices: true, duration: 'temporary', seconds: 1 };
  await call(menu, 'ui.visual.preferences', { preferences: prefs });
  await poll(async () => (await call(viewer, 'ui.status')).controlRevision > state.controlRevision, 'clear revision received');
  await click('#text'); await viewer.keyboard.insertText('Temporary');
  await poll(async () => await content.locator('[data-ghostpair-visual]').count() === 1, 'temporary preview');
  await poll(async () => await content.locator('[data-ghostpair-visual]').count() === 0, 'preview expires in every frame');
  assert.equal(await content.locator('#text').inputValue(), '');
  await call(menu, 'ui.visual.preferences', { preferences: { notices: false, duration: 'persistent', seconds: 3 } });
}
