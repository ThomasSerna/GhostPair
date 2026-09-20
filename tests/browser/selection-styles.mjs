import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { installDomControl } from '../../apps/extension/src/core/dom-control.ts';
import { artifactRoot } from './helpers.mjs';

const fixture = `<!doctype html><meta charset="utf-8"><title>Real and simulated selection</title>
<style>
:root{--brand:#14794d;--chosen:#dcf3e6;--paper:#fff;--ink:#18251f}
*{box-sizing:border-box}body{margin:24px;background:var(--paper);color:var(--ink);font:16px/1.4 system-ui}
body.dark{--brand:#e9b254;--chosen:#423823;--paper:#18251f;--ink:#fff2d7}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.group{min-width:0}
.option{display:flex;position:relative;align-items:center;gap:12px;margin:8px 0;padding:12px;border:1px solid #71837a;border-radius:12px;background:var(--paper)}
.hidden{position:absolute;opacity:0;width:18px;height:18px}
.dot{display:inline-block;position:relative;width:20px;height:20px;border:2px solid #71837a;border-radius:50%;flex-shrink:0}
.option:has(input:checked),.option[aria-checked=true]{border-color:var(--brand);background:var(--chosen);color:var(--brand)}
.group:has(#r4:checked){--brand:#165a9d;--chosen:#e3eef9}
.group:has(#r4:checked) .option{font-weight:600}
input:checked + .dot,.option[aria-checked=true] .dot{border-color:var(--brand)}
input:checked + .dot::after,.option[aria-checked=true] .dot::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--brand)}
.square .dot{border-radius:4px}.square input:checked + .dot::after{border-radius:1px}
.option svg{width:20px;height:20px;fill:transparent;stroke:#71837a;stroke-width:2}
.option[aria-checked=true] svg{fill:var(--brand);stroke:var(--brand)}
.native{display:block;margin:10px 0}.native input{accent-color:var(--brand)}
button{font:inherit;padding:10px 24px;border:1px solid #71837a;border-radius:18px;background:var(--paper);color:var(--ink)}
button:active{background:var(--brand);color:white;border-color:var(--brand)}
button:focus-visible{outline:3px solid var(--brand);outline-offset:-3px}
</style><h1>Choose one of four answers</h1><div class="grid">
<section class="group" id="answers">${[1,2,3,4].map(n => `<label class="option" id="option${n}"><input class="hidden" id="r${n}" name="answer" type="radio" ${n === 1 ? 'checked' : ''}><span class="dot"></span><span>Answer ${n}</span></label>`).join('')}</section>
<section class="group">
<label id="check-card" class="option square"><input id="check" class="hidden" type="checkbox"><span class="dot"></span><span>Multiple answers</span></label>
<label class="native" id="native-label"><input id="native" type="checkbox" checked>Native checked appearance</label>
<div role="radiogroup" id="aria-group"><div class="option" id="aria1" role="radio" aria-checked="true" tabindex="0"><span class="dot"></span><span>First ARIA answer</span></div>
<div class="option" id="aria2" role="radio" aria-checked="false" tabindex="0"><span class="dot"></span><span>Second ARIA answer</span></div></div>
<div class="option" id="svg-choice" role="checkbox" aria-checked="false" tabindex="0"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M2 10 L8 16 L18 3"/></svg><span>SVG answer</span></div>
<label id="plain" class="option"><input id="plain-input" type="checkbox" class="hidden">Card without a separate indicator</label>
</section></div><section role="group"><input class="hidden" id="separate" type="checkbox"><label class="option" id="separate-label" for="separate">Separate label</label><input class="hidden" id="another" type="checkbox"><label for="another">Another answer</label></section>
<style>#separate:checked + label{background:var(--chosen);border-color:var(--brand)}#separate:checked + label::before{content:"✓";color:var(--brand)}</style>
<button id="continue" type="button">Continue</button><input id="text" value="Original">
<div id="empty" style="height:80px"></div>
<script>
window.selectionEvents=[];for(const type of ['click','input','change','focusin','focusout','pointerdown','pointerup','submit'])document.addEventListener(type,e=>selectionEvents.push([type,e.target.id]),true);
for(const e of document.querySelectorAll('[role=radio],[role=checkbox]'))e.addEventListener('click',()=>{
 if(e.getAttribute('role')==='radio'){for(const peer of e.parentElement.querySelectorAll('[role=radio]'))peer.setAttribute('aria-checked',String(peer===e))}
 else e.setAttribute('aria-checked',String(e.getAttribute('aria-checked')!=='true'));
});
</script>`;

export async function selectionStyles(page, name) {
  await page.setViewportSize({ width: 1050, height: 900 });
  await page.setContent(fixture);
  const oracle = await page.context().browser().newPage();
  await oracle.setViewportSize({ width: 1050, height: 900 });
  await oracle.setContent(fixture);
  const config = { mode: 'visual', revision: 0, preferences: { clickAnimations: true, notices: false, text: { duration: 'persistent', seconds: 10 }, other: { duration: 'persistent', seconds: 3 }, accentColor: '#ec4899' } };
  await page.evaluate(`(${installDomControl.toString()})('selection',1,true,${JSON.stringify(config)})`);
  const send = async (command, extra = {}) => {
    const reply = await page.evaluate(({ command, extra }) => {
      let reply; controller({ target: 'ghostpair.dom', captureId: 'selection', generation: 1, controlRevision: 0, operation: 'command', command: { controlRevision: 0, ...command }, ...extra }, { id: 'fixture' }, result => { reply = result; }); return reply;
    }, { command, extra });
    assert.equal(reply?.ok, true, JSON.stringify(reply)); await page.clock.runFor(40);
  };
  const click = async selector => {
    const box = await page.locator(selector).boundingBox(); assert.ok(box);
    for (const event of ['down', 'up']) await send({ type: 'pointer', event, button: 'left', x: box.x + box.width / 2, y: box.y + box.height / 2 });
  };
  const snapshot = () => page.evaluate(() => ({
    html: document.querySelector('.grid').outerHTML, focus: document.activeElement.tagName,
    values: [...document.querySelectorAll('input')].map(e => [e.value, e.checked]), events: selectionEvents,
  }));
  const original = await snapshot();
  // Real browser selection is the oracle; it does not use the replica renderer.
  const appearance = ({ id, simulated }) => {
    const source = document.getElementById(id) ?? document.querySelector('#shadow-host')?.shadowRoot.getElementById(id);
    const host = simulated && [...preview.children].find(e => replicaRoots.get(e)?.querySelector('[data-gp-surface]')?.id === id && getComputedStyle(e).display !== 'none');
    const surface = simulated ? host && replicaRoots.get(host).querySelector('[data-gp-surface]') : source;
    if (!surface) return null;
    const keys = ['color', 'backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderRadius', 'fontFamily', 'fontSize', 'fontWeight', 'fill', 'stroke', 'opacity', 'content'];
    const nodes = [surface, ...surface.querySelectorAll('*')];
    return nodes.map(e => ({
      tag: e.tagName, checked: e instanceof HTMLInputElement ? e.checked : e.getAttribute('aria-checked'),
      styles: ['', '::before', '::after'].map(pseudo => { const css = getComputedStyle(e, pseudo || null); return keys.map(key => css[key]); }),
    }));
  };
  const matches = async id => {
    const actual = await page.evaluate(appearance, { id, simulated: true });
    assert.ok(actual, `${id} has a visible page-styled replica`);
    assert.deepEqual(actual, await oracle.evaluate(appearance, { id, simulated: false }), `${id} matches real selected appearance`);
  };
  try {
    await click('#empty');
    assert.ok(await page.evaluate(() => preview.querySelectorAll('[data-gp-click]').length > 0));
    config.preferences.clickAnimations = false;
    await send(undefined, { operation: 'configure', configuration: config });
    assert.equal(await page.evaluate(() => preview.querySelectorAll('[data-gp-click]').length), 0, 'active circles disappear immediately');
    await click('#empty');
    assert.equal(await page.evaluate(() => preview.querySelectorAll('[data-gp-click]').length), 0);
    for (const id of ['option2', 'option4', 'check-card', 'native-label', 'aria2', 'svg-choice', 'plain', 'separate-label']) {
      await click(`#${id}`); await oracle.locator(`#${id}`).click(); await matches(id);
    }
    for (const id of ['option1', 'option2', 'option3', 'aria1']) await matches(id);
    await click('#check-card'); await oracle.locator('#check-card').click(); await matches('check-card');
    await click('#text'); await send({ type: 'text', text: ' still editable' });
    assert.ok(await page.evaluate(() => [...preview.children].some(e => e.textContent === 'Original still editable')));
    await click('#continue');
    await oracle.locator('#continue').hover(); await oracle.mouse.down(); await matches('continue'); await oracle.mouse.up();
    assert.equal(await page.evaluate(() => preview.querySelectorAll('[data-gp-click]').length), 0, 'button/text/choice interactions do not recreate circles');
    assert.deepEqual(await snapshot(), original);
    await page.clock.runFor(600);
    await page.screenshot({ path: resolve(artifactRoot, `selection-${name}-simulated.png`) });
    await oracle.screenshot({ path: resolve(artifactRoot, `selection-${name}-real.png`) });
    for (const target of [page, oracle]) await target.evaluate(() => document.body.classList.add('dark'));
    await page.clock.runFor(600);
    for (const id of ['option1', 'option4', 'native-label', 'aria2', 'svg-choice', 'plain']) await matches(id);
    config.preferences.accentColor = '#12abcd';
    await send(undefined, { operation: 'configure', configuration: config });
    await matches('option4');
    await page.screenshot({ path: resolve(artifactRoot, `selection-${name}-dark.png`) });
    await page.locator('#answers').evaluate(e => { e.style.transformOrigin = 'top left'; e.style.transform = 'scale(.8)'; });
    await page.clock.runFor(80);
    assert.ok(await page.evaluate(() => {
      const source = document.querySelector('#option4').getBoundingClientRect();
      const overlay = [...preview.children].find(e => replicaRoots.get(e)?.querySelector('[data-gp-surface]')?.id === 'option4');
      const surface = replicaRoots.get(overlay).querySelector('[data-gp-surface]').getBoundingClientRect();
      return Math.abs(source.left - surface.left) < 1 && Math.abs(source.top - surface.top) < 1 && Math.abs(source.width - surface.width) < 1;
    }), 'replica follows scaled geometry');
    // An open component has its own stylesheet scope and inherited host theme.
    const addShadow = () => {
      const host = document.createElement('div'); host.id = 'shadow-host'; document.body.append(host);
      const root = host.attachShadow({ mode: 'open' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(':host{--brand:#8c3a15;display:block;font:16px system-ui}label{display:flex;gap:8px;width:300px;padding:10px;border:2px solid gray;border-radius:8px}label:has(input:checked){color:var(--brand);border-color:var(--brand);background:#fee9d7}input{accent-color:var(--brand)}');
      root.adoptedStyleSheets = [sheet];
      root.innerHTML = '<label id="shadow-card"><input type="checkbox">Inside component</label>';
    };
    for (const target of [page, oracle]) await target.evaluate(addShadow);
    await click('#shadow-card'); await oracle.locator('#shadow-card').click(); await matches('shadow-card');
    assert.equal(await page.locator('#shadow-card input').isChecked(), false);
    for (const target of [page, oracle]) await target.evaluate(() => document.querySelector('#shadow-host').style.setProperty('--brand', '#6549a1'));
    await page.clock.runFor(80); await matches('shadow-card');
    // Inaccessible CSS must leave a visible fallback, never disappear or fetch it.
    await page.evaluate(() => {
      const sheet = document.styleSheets[0];
      Object.defineProperty(sheet, 'cssRules', { configurable: true, get() { throw new DOMException('Cross-origin sheet', 'SecurityError'); } });
    });
    await page.clock.runFor(600);
    assert.ok(await page.evaluate(() => {
      const box = document.querySelector('#plain').getBoundingClientRect();
      return [...preview.children].some(e => getComputedStyle(e).display !== 'none' && e.style.border.includes('2px') && Math.abs(parseFloat(e.style.left) - box.left) < 1 && Math.abs(parseFloat(e.style.top) - box.top) < 1);
    }), 'inaccessible style uses a visible page-colored fallback');
    await page.evaluate(() => { delete document.styleSheets[0].cssRules; });
    await page.clock.runFor(600); await matches('plain');
    let assetRequests = 0;
    await page.route('https://replica-assets.invalid/**', route => { assetRequests++; return route.abort(); });
    await page.evaluate(() => {
      window.replicaConstructors = 0;
      customElements.define('gp-fixture-widget', class extends HTMLElement { constructor() { super(); replicaConstructors++; } });
      const widget = document.createElement('gp-fixture-widget');
      widget.innerHTML = '<label class="option" id="safe-card"><input class="hidden" id="safe-input" type="checkbox"><span class="dot" onclick="window.replicaHandlerRan=true"></span><span>Passive replica</span></label>';
      document.body.append(widget);
      const style = document.createElement('style');
      style.textContent = ':root{--unsafe-image:url("https://replica-assets.invalid/inherited.png")}#safe-input:checked + span{background-image:var(--unsafe-image)}#safe-input:checked + span::after{background-image:url("https://replica-assets.invalid/direct.png")}';
      document.head.append(style);
    });
    await page.locator('#safe-card').scrollIntoViewIfNeeded(); await page.clock.runFor(600);
    await click('#safe-card'); await page.clock.runFor(100);
    assert.equal(assetRequests, 0, 'replicas never load copied CSS assets');
    assert.deepEqual(await page.evaluate(() => {
      const host = [...preview.children].find(e => replicaRoots.get(e)?.querySelector('[data-gp-surface]')?.id === 'safe-card');
      return { visible: Boolean(host && getComputedStyle(host).display !== 'none'), constructors: replicaConstructors, handlers: Boolean(window.replicaHandlerRan), copiedHandler: Boolean(replicaRoots.get(host)?.querySelector('[onclick]')), checked: document.querySelector('#safe-input').checked };
    }), { visible: true, constructors: 1, handlers: false, copiedHandler: false, checked: false });
    config.preferences.clickAnimations = true;
    await send(undefined, { operation: 'configure', configuration: config }); await click('#empty');
    assert.ok(await page.evaluate(() => preview.querySelectorAll('[data-gp-click]').length > 0));
    await send(undefined, { operation: 'visual.clear' });
    assert.equal(await page.locator('[data-ghostpair-visual]').count(), 0);
  } finally { await oracle.close(); await send(undefined, { operation: 'dispose' }); }
}
