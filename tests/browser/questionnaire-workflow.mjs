import assert from 'node:assert/strict';
import { poll } from './helpers.mjs';

// Full guest UI -> WebRTC -> authorized DOM controller, with no host-side clicks.
export async function questionnaireWorkflow(page, viewer, ready, { embedded = false } = {}) {
  await ready();
  const root = embedded ? page.frameLocator('#questionnaire') : page;
  const read = fn => root.locator('body').evaluate(fn);
  const point = async selector => {
    const host = await root.locator(selector).boundingBox(), video = await viewer.locator('video').boundingBox();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(host && video);
    return { x: video.x + (host.x + host.width / 2) / viewport.width * video.width, y: video.y + (host.y + host.height / 2) / viewport.height * video.height };
  };
  const click = async selector => { const p = await point(selector); await viewer.mouse.click(p.x, p.y); };
  const checked = async (selector, value) => poll(() => root.locator(selector).isChecked().then(checked => checked === value), `${selector} checked=${value}`);
  await click('#choice-label'); await checked('#choice', true);
  await viewer.keyboard.press('Space'); await checked('#choice', false);
  await viewer.keyboard.press('Space'); await checked('#choice', true);
  await click('#r1'); await viewer.keyboard.press('ArrowRight'); await checked('#r2', true);
  await click('#list'); await viewer.keyboard.press('ArrowDown');
  await poll(() => root.locator('#list').inputValue().then(value => value === 'D'), 'select skips disabled options');
  await click('#text'); await viewer.keyboard.insertText('á漢🙂aa');
  await poll(() => root.locator('#text').inputValue().then(value => value === 'á漢🙂aa'), 'Unicode and repeated text');
  // Synthetic composition/paste sequences exercise the viewer adapter without using the OS clipboard.
  await viewer.getByLabel('Remote keyboard input').evaluate(input => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = '仮'; input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '仮', isComposing: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '仮' }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '仮' }));
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'paste');
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  });
  await poll(() => root.locator('#text').inputValue().then(value => value === 'á漢🙂aa仮paste'), 'composition and paste commit once');
  await viewer.keyboard.press('Enter'); await poll(() => read(() => quizProbe.submits.length === 1), 'implicit submission');
  assert.deepEqual(await read(() => quizProbe.submits), ['next']);

  const left = await point('#left'), right = await point('#right');
  await viewer.mouse.move(left.x, left.y); await viewer.mouse.down();
  await viewer.mouse.move(right.x, right.y, { steps: 50 }); await viewer.mouse.up();
  await poll(() => read(() => quizProbe.submits.length === 2), 'one nested-button gesture submits once');

  for (const mode of ['escape', 'focus', 'capture', 'pointercancel', 'hidden']) {
    const before = await read(() => quizProbe.events.filter(e => e[0] === 'pointerdown').length);
    await viewer.mouse.move(left.x, left.y); await viewer.mouse.down();
    await poll(async () => await read(() => quizProbe.events.filter(e => e[0] === 'pointerdown').length) > before, `${mode} press received`);
    const cancels = await read(() => quizProbe.events.filter(e => e[0] === 'pointercancel').length);
    if (mode === 'escape') await viewer.keyboard.press('Escape');
    if (mode === 'focus') await viewer.getByLabel('Remote page address').focus();
    if (mode === 'capture') {
      // Capture changes are processed before the next native pointer event.
      await viewer.mouse.move(left.x + 1, left.y);
      await viewer.locator('video').evaluate(video => { if (!video.hasPointerCapture(1)) throw new Error('Expected mouse capture'); video.releasePointerCapture(1); });
      await viewer.mouse.move(left.x + 2, left.y);
    }
    if (mode === 'pointercancel') await viewer.locator('video').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' });
    if (mode === 'hidden') {
      const other = await viewer.evaluate(async () => {
        const current = await chrome.tabs.getCurrent();
        return chrome.tabs.create({ windowId: current.windowId, url: 'about:blank', active: true });
      });
      try {
        await poll(() => viewer.evaluate(() => document.hidden), 'viewer becomes hidden in its window');
        await poll(async () => await read(() => quizProbe.events.filter(e => e[0] === 'pointercancel').length) > cancels, 'hidden viewer releases input');
      } finally {
        await viewer.evaluate(id => chrome.tabs.remove(id), other.id); await viewer.bringToFront();
      }
    }
    await poll(async () => await read(() => quizProbe.events.filter(e => e[0] === 'pointercancel').length) > cancels, `${mode} cancels host gesture`);
    await viewer.mouse.up();
    // A subsequent successful action is an ordered delivery barrier for the canceled gesture.
    const legend = await read(() => quizProbe.legend);
    await click('#legend');
    await poll(async () => await read(() => quizProbe.legend) === legend + 1, 'control remains available');
    assert.equal(await read(() => quizProbe.submits.length), 2, `${mode} must not submit`);
  }
  const beforeTrusted = await read(() => quizProbe.legend);
  await click('#trusted'); await click('#legend');
  await poll(async () => await read(() => quizProbe.legend) === beforeTrusted + 1, 'trusted-only check delivery barrier');
  assert.equal(await read(() => quizProbe.trusted), 0, 'trusted-only page remains unsupported');
  await click('#flow-answer'); await checked('#flow-answer', true);
  await click('#step-one button'); await poll(() => root.locator('#flow-status').innerText().then(text => text === 'Step 2'), 'questionnaire second step');
  await click('#flow-confirm'); await checked('#flow-confirm', true);
  await click('#step-two button'); await poll(() => root.locator('#flow-status').innerText().then(text => text === 'Complete'), 'questionnaire finished');
}
