import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { installDomControl } from '../../apps/extension/src/core/dom-control.ts';
import { artifactRoot } from './helpers.mjs';

const theme = (id, title) => `<section id="${id}" class="theme ${id}"><h2>${title}</h2><form>
<label>Short answer<div class="text-panel"><input id="${id}-text" class="text" value="Original answer"></div></label>
<label>Notes<div class="text-panel"><textarea id="${id}-area" class="text"></textarea></div></label>
<label id="${id}-card" class="option"><input id="${id}-hidden" type="checkbox" class="hidden"><span class="indicator" aria-hidden="true"></span><span>A custom checkbox with its original label</span></label>
<div role="radiogroup" aria-label="${title} choices">
<div id="${id}-r1" class="option" role="radio" aria-checked="false" tabindex="0"><span class="indicator round" aria-hidden="true"></span><span>First choice</span></div>
<div id="${id}-r2" class="option" role="radio" aria-checked="false" tabindex="0"><span class="indicator round" aria-hidden="true"></span><span>A longer second choice that remains readable</span></div></div>
<label id="${id}-plain" class="option plain"><input type="checkbox" class="hidden">An option with no separate visual indicator</label>
<button id="${id}-button" type="button">Continue</button>
</form></section>`;

const fixture = `<!doctype html><meta charset="utf-8"><title>Adaptive visual simulation</title>
<style>
*{box-sizing:border-box}body{margin:24px;background:#dce3ec;font:15px/1.4 system-ui;color:#24324a}h1{font-size:24px;margin:0 0 16px}h2{margin:0 0 16px;font-size:21px}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.theme{--surface:#f5f7fb;--panel:#e8eef7;--text:#24324a;--line:#8b9db6;--button:#dde5f1;color-scheme:light;padding:22px;border-radius:20px;background:var(--surface);color:var(--text)}
.theme.dark{--surface:#182436;--panel:#26364e;--text:#edf1fa;--line:#6a809c;--button:#344760;color-scheme:dark}
label{display:block}.text-panel{background:var(--panel);border-radius:18px 8px 12px 4px;margin:6px 0 14px}.text{display:block;width:100%;background:transparent;color:inherit;font:17px/26px Georgia,serif;letter-spacing:.3px;padding:9px 16px 11px 14px;border-style:solid;border-width:1px 2px 3px 4px;border-color:var(--line);border-radius:18px 8px 12px 4px}textarea{height:78px;resize:none}
.option{position:relative;display:flex;align-items:center;gap:12px;padding:13px 16px;margin:10px 0;border:1px solid var(--line);border-radius:14px;background:var(--surface);min-height:54px}.hidden{position:absolute;opacity:0;width:18px;height:18px;margin:0}.indicator{display:block;width:20px;height:20px;flex-shrink:0;border:2px solid var(--line);border-radius:6px;background:var(--surface)}.round{border-radius:50%}.plain{font-style:italic;border-radius:4px}
button{font:inherit;font-weight:600;color:inherit;background:var(--button);padding:10px 26px;border:1px solid var(--line);border-radius:28px;margin-top:8px}
</style><h1>Page-aware simulation · Original controls stay unchanged</h1><main>${theme('light', 'Light questionnaire')}${theme('dark', 'Dark questionnaire')}</main>
<div id="compact" role="checkbox" aria-checked="false" tabindex="0" style="width:40px;height:32px;margin-top:16px;border:1px solid #8b9db6;border-radius:6px;padding:4px">Yes</div>
<script>window.styleEvents=[];for(const type of ['click','pointerdown','pointerup','keydown','keyup','input','beforeinput','change','focusin','focusout','submit'])document.addEventListener(type,e=>styleEvents.push([type,e.target.id]),true);</script>`;

/** Runs after the basic visual probe, using its fixture-only closed-shadow inspection hook. */
export async function visualStyles(page, name) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.setContent(fixture);
  const configuration = { mode: 'visual', revision: 0, preferences: { notices: false, clickAnimations: true, text: { duration: 'persistent', seconds: 0.5 }, other: { duration: 'persistent', seconds: 0.5 }, accentColor: '#7871e8' } };
  await page.evaluate(`(${installDomControl.toString()})('styles',1,true,${JSON.stringify(configuration)})`);
  const send = async (command, extra = {}) => {
    const reply = await page.evaluate(({ command, extra }) => {
      let result;
      controller({ target: 'ghostpair.dom', captureId: 'styles', generation: 1, controlRevision: 0, operation: 'command', command: { controlRevision: 0, ...command }, ...extra }, { id: 'fixture' }, reply => { result = reply; });
      return result;
    }, { command, extra });
    assert.equal(reply?.ok, true, JSON.stringify(reply));
    await page.clock.runFor(40);
  };
  const click = async selector => {
    const box = await page.locator(selector).boundingBox(); assert.ok(box);
    for (const event of ['down', 'up']) await send({ type: 'pointer', event, x: box.x + box.width / 2, y: box.y + box.height / 2, button: 'left' });
  };
  const text = value => send({ type: 'text', text: value });
  const snapshot = () => page.evaluate(() => ({ forms: [...document.forms].map(e => e.outerHTML), values: [...document.querySelectorAll('input,textarea')].map(e => [e.value, e.checked, e.selectionStart, e.selectionEnd]), focus: document.activeElement.tagName, events: styleEvents }));
  const original = await snapshot();
  const overlays = selector => page.evaluate(selector => {
    const box = document.querySelector(selector).getBoundingClientRect();
    return [...preview.children].filter(e => e.tagName === 'DIV' && Math.abs(parseFloat(e.style.left) - box.left) < 1 && Math.abs(parseFloat(e.style.top) - box.top) < 1 && Math.abs(parseFloat(e.style.width) - box.width) < 1).map(e => {
      const css = getComputedStyle(e);
      return { text: e.textContent, background: css.backgroundColor, border: css.borderTopWidth, color: css.borderTopColor, radius: css.borderTopLeftRadius, display: css.display };
    }).filter(e => e.display !== 'none');
  }, selector);
  const textStyleMatches = async id => {
    const result = await page.evaluate(id => {
      const target = document.getElementById(id), css = getComputedStyle(target);
      const overlay = [...preview.children].find(e => e.textContent === `Original answer · ${id}`);
      const painted = getComputedStyle(overlay);
      const keys = ['fontFamily', 'fontSize', 'lineHeight', 'color', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'];
      return { source: keys.map(key => css[key]), painted: keys.map(key => painted[key]), background: painted.backgroundColor, parentBackground: getComputedStyle(target.parentElement).backgroundColor };
    }, id);
    assert.deepEqual(result.painted, result.source);
    assert.equal(result.background, result.parentBackground);
  };
  for (const id of ['light', 'dark']) {
    await click(`#${id}-text`); await text(` · ${id}-text`); await textStyleMatches(`${id}-text`);
    await click(`#${id}-area`); await text('A simulated response\nwith a second line');
    await click(`#${id}-card`); await click(`#${id}-r1`); await click(`#${id}-r2`); await click(`#${id}-plain`);
    await click(`#${id}-button`);
    const pressed = await overlays(`#${id}-button`);
    assert.ok(pressed.some(e => e.border === '2px' && Math.abs(parseFloat(e.radius) - 28) < .1), JSON.stringify({ id, pressed }));
    assert.equal((await overlays(`#${id}-card`)).length, 0);
    assert.ok((await overlays(`#${id}-card .indicator`)).some(e => e.border === '2px'));
    assert.ok((await overlays(`#${id}-r1`)).every(e => e.border === '0px'));
    assert.equal((await overlays(`#${id}-r2`)).length, 0);
    assert.ok((await overlays(`#${id}-r2 .indicator`)).some(e => e.border === '2px'));
    assert.ok((await overlays(`#${id}-plain`)).some(e => e.border === '2px'), 'unrecognized controls retain a visible fallback');
  }
  await page.clock.runFor(600);
  await click('#compact');
  assert.ok((await overlays('#compact')).every(e => e.background.includes('/')));
  assert.deepEqual(await snapshot(), original);
  await page.screenshot({ path: resolve(artifactRoot, `visual-styles-${name}.png`), caret: 'initial' });

  // Theme and accent changes restyle existing virtual values, without another input.
  await page.locator('#light').evaluate(e => e.classList.add('dark'));
  configuration.preferences.accentColor = '#12abcd';
  await send(undefined, { operation: 'configure', configuration });
  await page.clock.runFor(80);
  await textStyleMatches('light-text');
  const pageColor = await page.locator('#light-card .indicator').evaluate(e => getComputedStyle(e).color);
  assert.ok((await overlays('#light-card .indicator')).some(e => e.color === pageColor));
  assert.deepEqual(await snapshot(), original);
  await page.screenshot({ path: resolve(artifactRoot, `visual-styles-${name}-updated.png`), caret: 'initial' });

  // A translucent field composites over the page surface rather than becoming white.
  await page.locator('#dark-text').evaluate(e => { e.style.backgroundColor = 'rgba(255, 255, 255, .15)'; });
  await page.clock.runFor(80);
  assert.equal(await page.evaluate(() => {
    const e = [...preview.children].find(e => e.textContent === 'Original answer · dark-text');
    const css = getComputedStyle(e);
    return css.backgroundColor === 'rgb(38, 54, 78)' && css.backgroundImage.includes('rgba(255, 255, 255, 0.15)');
  }), true);

  // Recompute both text metrics and asymmetric geometry under page transforms.
  await page.locator('#dark').evaluate(e => { e.style.transformOrigin = 'top left'; e.style.transform = 'scale(.8)'; });
  await page.clock.runFor(80);
  assert.equal(await page.evaluate(() => {
    const e = [...preview.children].find(e => e.textContent === 'Original answer · dark-text');
    const css = getComputedStyle(e);
    return Math.abs(parseFloat(css.fontSize) - 13.6) < .05 && Math.abs(parseFloat(css.paddingLeft) - 11.2) < .05 && Math.abs(parseFloat(css.borderLeftWidth) - 3.2) < 1;
  }), true);
  await page.locator('#light').evaluate(e => e.remove());
  await page.clock.runFor(80);
  assert.equal(await page.evaluate(() => [...preview.children].some(e => e.textContent === 'Original answer · light-text')), false);
  await send(undefined, { operation: 'visual.clear' });
  assert.equal(await page.locator('[data-ghostpair-visual]').count(), 0);
  await send(undefined, { operation: 'dispose' });
}
