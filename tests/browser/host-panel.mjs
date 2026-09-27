import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { installDomControl } from '../../apps/extension/src/core/dom-control.ts';
import { artifactRoot } from './helpers.mjs';

export async function hostPanel(page, name) {
  await page.evaluate(() => globalThis.__ghostpairControl?.dispose());
  await page.setContent('<style>body{font:18px system-ui;padding:24px}input,button{display:block;margin:24px 0;padding:12px}</style><h1>Shared page</h1><input id="answer" value="Original"><button id="action" onclick="this.textContent=\'Clicked\'">Continue</button>');
  await page.evaluate(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      const shadow = attach.call(this, options);
      if (this.hasAttribute('data-ghostpair-panel')) globalThis.hostPanelRoot = shadow;
      if (this.hasAttribute('data-ghostpair-visual')) globalThis.hostPreviews = shadow;
      return shadow;
    };
    globalThis.panelConfig = { mode: 'visual', revision: 0, preferences: { showInteractions: true, clickAnimations: true, notices: false, text: { duration: 'persistent', seconds: 10 }, other: { duration: 'persistent', seconds: 3 }, accentColor: '#7871e8' } };
    globalThis.panelMessages = [];
    globalThis.configurePanel = () => controller({ target: 'ghostpair.dom', captureId: 'panel', generation: 1, operation: 'configure', configuration: structuredClone(panelConfig) }, { id: 'fixture' }, () => {});
    chrome.runtime.sendMessage = async message => {
      if (message.type === 'dom.preferences') {
        panelMessages.push(message);
        if (globalThis.failPreference) { globalThis.failPreference = false; return { ok: false, error: 'Try again.' }; }
        panelConfig.preferences[message.preference] = message.enabled; configurePanel();
      }
      return { ok: true };
    };
  });
  const install = root => page.evaluate(`(${installDomControl.toString()})('panel',1,${root},structuredClone(panelConfig))`);
  const panelPoint = selector => page.evaluate(selector => { const b = hostPanelRoot.querySelector(selector).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, selector);
  const localClick = async selector => { const p = await panelPoint(selector); await page.mouse.click(p.x, p.y); };
  const remote = command => page.evaluate(command => {
    let result;
    controller({ target: 'ghostpair.dom', captureId: 'panel', generation: 1, operation: 'command', command: { controlRevision: panelConfig.revision, ...command } }, { id: 'fixture' }, reply => { result = reply; });
    if (!result?.ok) throw new Error(result?.error); return result;
  }, command);
  const clickAt = async point => { for (const event of ['down', 'up']) await remote({ type: 'pointer', ...point, event, button: 'left', buttons: event === 'down' ? 1 : 0, modifiers: 0, clickCount: 1 }); await page.clock.runFor(40); };
  const remoteClick = async selector => clickAt(await page.locator(selector).evaluate(e => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }));
  const visible = () => page.locator('[data-ghostpair-visual]').isVisible();
  await install(true); await install(true);
  assert.equal(await page.locator('[data-ghostpair-panel]').count(), 1);
  assert.equal(await page.evaluate(() => hostPanelRoot.querySelector('strong').textContent), 'Visual only');
  await localClick('summary');
  await remoteClick('#answer'); await remote({ type: 'text', text: ' preview' });
  assert.equal(await visible(), true);
  await localClick('input');
  assert.equal(await visible(), false);
  await remote({ type: 'text', text: ' hidden' });
  assert.equal(await visible(), false, 'new previews stay hidden');
  await localClick('input');
  assert.equal(await visible(), true);
  assert.ok(await page.evaluate(() => [...hostPreviews.querySelectorAll('[data-gp-editor]')].some(e => e.value === 'Original preview hidden')), 'hiding preserves simulation state');
  assert.equal(await page.locator('#answer').inputValue(), 'Original');
  for (const mode of ['visual', 'live']) {
    await page.evaluate(mode => { panelConfig.mode = mode; panelConfig.revision++; configurePanel(); }, mode);
    assert.equal(await page.locator('[data-ghostpair-visual]').count(), 0, 'mode revisions clear old previews');
    assert.equal(await page.evaluate(() => hostPanelRoot.querySelector('strong').textContent), mode === 'visual' ? 'Visual only' : 'Live control');
    const before = await page.evaluate(() => panelMessages.length);
    await clickAt(await panelPoint('input'));
    assert.equal(await page.evaluate(() => panelMessages.length), before, 'remote pointer cannot toggle host preferences');
    await localClick('input');
    await remote({ type: 'key', event: 'down', key: ' ', code: 'Space', modifiers: 0 });
    await remote({ type: 'key', event: 'up', key: ' ', code: 'Space', modifiers: 0 });
    assert.equal(await page.evaluate(() => panelMessages.length), before + 1, 'remote keyboard cannot toggle host preferences');
    await remoteClick('#action');
    assert.equal(await visible(), false);
    assert.equal(await page.locator('#action').textContent(), mode === 'live' ? 'Clicked' : 'Continue');
    await localClick('input'); await remoteClick('#action');
    assert.equal(await page.evaluate(() => hostPreviews.querySelectorAll('[data-gp-click]').length), 1);
    await localClick('label:nth-child(2) input');
    assert.equal(await page.evaluate(() => hostPreviews.querySelectorAll('[data-gp-click]').length), 0, 'disabling removes an active click animation');
    await remoteClick('#action');
    assert.equal(await page.evaluate(() => hostPreviews.querySelectorAll('[data-gp-click]').length), 0);
    await page.screenshot({ path: resolve(artifactRoot, `host-panel-${mode}-${name}.png`) });
    await localClick('label:nth-child(2) input');
  }
  await page.evaluate(() => { globalThis.failPreference = true; }); await localClick('input');
  assert.equal(await page.evaluate(() => hostPanelRoot.querySelector('[role="alert"]').textContent), 'Try again.');
  assert.equal(await page.evaluate(() => hostPanelRoot.querySelector('input').checked), true);
  const before = await page.evaluate(() => panelMessages.length);
  await page.evaluate(() => hostPanelRoot.querySelector('input').dispatchEvent(new Event('change', { bubbles: true })));
  assert.equal(await page.evaluate(() => panelMessages.length), before, 'untrusted events cannot change preferences');
  await page.setViewportSize({ width: 390, height: 700 });
  const box = await page.locator('[data-ghostpair-panel]').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  await page.screenshot({ path: resolve(artifactRoot, `host-panel-narrow-${name}.png`) });
  await page.evaluate(() => __ghostpairControl.dispose());
  assert.equal(await page.locator('#answer').inputValue(), 'Original');
  assert.equal(await page.locator('[data-ghostpair-panel]').count(), 0);
  await install(false);
  assert.equal(await page.locator('[data-ghostpair-panel]').count(), 0, 'embedded frames have no duplicate panel');
  await page.evaluate(() => __ghostpairControl.dispose());
}
