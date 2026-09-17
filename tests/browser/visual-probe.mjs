import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { installDomControl } from '../../apps/extension/src/core/dom-control.ts';
import { artifactRoot, browsers } from './helpers.mjs';

const fixture = `<!doctype html><meta charset="utf-8"><title>Visual simulation fixture</title>
<style>body{font:18px system-ui;margin:30px;background:#fff;color:#222}input,textarea,button{font:inherit;padding:8px;margin:10px}label{display:block}#scroll{height:100px;overflow:auto;border:1px solid #aaa}#spacer{height:500px}</style>
<h1>Visual simulation</h1><form><label><input id="check" type="checkbox">A simulated answer</label>
<label><input id="r1" type="radio" name="answer" checked>First</label><label><input id="r2" type="radio" name="answer">Second</label>
<input id="text" value="Original"><textarea id="area"></textarea><input id="password" type="password" value="secret">
<div id="editable" contenteditable>Editable</div><button id="trusted"><span>Trusted only</span></button>
<input id="readonly" readonly value="Read only"><input id="disabled" disabled value="Disabled"></form>
<div id="scroll"><input id="moving"><div id="spacer"></div></div><div style="height:1000px"></div>
<script>window.events=[];window.accepted=0;document.querySelector('#trusted').onclick=e=>{if(e.isTrusted)accepted++};
for(const type of ['click','dblclick','pointerdown','pointerup','pointermove','pointercancel','mousedown','mouseup','keydown','keyup','input','beforeinput','change','focusin','focusout','submit'])document.addEventListener(type,e=>{events.push([type,e.target.id]);if(type==='submit')e.preventDefault()},true);
</script>`;
await mkdir(artifactRoot, { recursive: true });
const results = [];
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'edge']) {
  const browser = await chromium.launch({ executablePath: browsers[name], headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    await page.clock.install(); await page.setContent(fixture);
    await page.evaluate(() => {
      // Capture a reference only in this fixture, without opening the production shadow root.
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (options) { const shadow = attach.call(this, options); if (this.hasAttribute('data-ghostpair-visual')) globalThis.preview = shadow; return shadow; };
      globalThis.chrome = { runtime: { id: 'fixture', onMessage: { addListener: fn => { globalThis.controller = fn; }, removeListener() {} }, sendMessage: async () => ({}) } };
    });
    const config = { mode: 'visual', revision: 0, preferences: { notices: false, duration: 'persistent', seconds: 3 } };
    const install = async (generation = 1) => page.evaluate(`(${installDomControl.toString()})('fixture',${generation},true,${JSON.stringify(config)})`);
    await install();
    const send = async (command, extra = {}) => {
      const reply = await page.evaluate(({ command, extra }) => { let reply; controller({ target: 'ghostpair.dom', captureId: 'fixture', generation: 1, controlRevision: 0, operation: 'command', command: { controlRevision: 0, ...command }, ...extra }, { id: 'fixture' }, result => { reply = result; }); return reply; }, { command, extra });
      assert.equal(reply?.ok, true, JSON.stringify(reply)); await page.clock.runFor(40); return reply;
    };
    const click = async selector => {
      const point = await page.locator(selector).evaluate(e => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      for (const event of ['down', 'up']) await send({ type: 'pointer', ...point, event, button: 'left', buttons: event === 'down' ? 1 : 0, clickCount: 1, modifiers: 0 });
    };
    const key = async (key, modifiers = 0) => { for (const event of ['down', 'up']) await send({ type: 'key', event, key, code: key, modifiers, repeat: false }); };
    const text = value => send({ type: 'text', text: value });
    const contents = () => page.evaluate(() => [...preview.querySelectorAll('div')].map(e => e.textContent));
    const original = await page.evaluate(() => ({ html: document.querySelector('form').outerHTML, focus: document.activeElement.tagName, values: [...document.querySelectorAll('input,textarea')].map(e => [e.value,e.checked,e.selectionStart,e.selectionEnd]), editable: document.querySelector('#editable').innerHTML }));
    await click('#check'); await click('#r2'); await click('#text'); await key('a', 2); await text('Visual á漢🙂'); await key('Backspace');
    assert.ok((await contents()).includes('Visual á漢'));
    await key('ArrowLeft', 8); await text('字'); assert.ok((await contents()).includes('Visual á字'));
    await click('#area'); await text('First'); await key('Enter'); await text('Second');
    await click('#editable'); await key('a', 2); await text('Only a preview');
    await click('#password'); await key('a', 2); await text('private');
    assert.ok((await contents()).includes('•••••••')); assert.ok(!(await contents()).includes('private'));
    await click('#trusted span'); await key('Enter'); await key(' '); await send({ type: 'text', text: ' ' });
    await click('#readonly'); await text('ignored'); await click('#disabled'); await text('ignored');
    const after = await page.evaluate(() => ({ html: document.querySelector('form').outerHTML, focus: document.activeElement.tagName, values: [...document.querySelectorAll('input,textarea')].map(e => [e.value,e.checked,e.selectionStart,e.selectionEnd]), editable: document.querySelector('#editable').innerHTML }));
    assert.deepEqual(after, original); assert.deepEqual(await page.evaluate(() => events), []); assert.equal(await page.evaluate(() => accepted), 0);
    assert.ok(!(await contents()).some(t => t.startsWith('Simulated')));
    assert.equal(await page.locator('[data-ghostpair-visual]').evaluate(e => getComputedStyle(e).pointerEvents), 'none');
    await page.screenshot({ path: resolve(artifactRoot, `visual-${name}-host.png`) });
    await send(undefined, { operation: 'release' }); assert.ok((await contents()).includes('Visual á字'));
    // A geometry rebind preserves previews in the same authorized document.
    await page.setViewportSize({ width: 1050, height: 850 }); await install(2);
    assert.ok((await contents()).includes('Visual á字'));
    await assert.rejects(() => install(1), /shared page changed/);
    await page.evaluate(() => { __ghostpairControl.dispose(); }); await install(1);
    await click('#moving'); await text('Attached to field');
    await page.locator('#scroll').evaluate(e => { e.scrollTop = 35; }); await page.clock.runFor(80);
    assert.equal(await page.evaluate(() => { const overlay = [...preview.querySelectorAll('div')].find(e => e.textContent === 'Attached to field'); return Math.round(parseFloat(overlay.style.top)) === Math.round(document.querySelector('#moving').getBoundingClientRect().top); }), true);
    await page.locator('#moving').evaluate(e => e.remove()); await page.clock.runFor(80); assert.ok(!(await contents()).includes('Attached to field'));
    await click('#text'); await key('a', 2); await text('A long simulated line '.repeat(8));
    assert.ok(await page.evaluate(() => [...preview.querySelectorAll('div')].some(e => e.textContent.startsWith('A long simulated line') && e.scrollLeft > 0)));
    assert.equal(await page.locator('#text').evaluate(e => e.scrollLeft), 0);
    config.preferences.notices = true;
    await send(undefined, { operation: 'configure', configuration: config });
    await send(undefined, { operation: 'visual.notice', kind: 'typing' });
    assert.equal((await contents()).filter(t => t === 'Simulated typing').length, 1);
    await send(undefined, { operation: 'visual.notice', kind: 'click' }); assert.ok(!(await contents()).includes('Simulated click'));
    await page.clock.runFor(1550); assert.ok(!(await contents()).includes('Simulated typing'));
    await page.clock.runFor(1500); await send(undefined, { operation: 'visual.notice', kind: 'click' }); assert.ok((await contents()).includes('Simulated click'));
    config.preferences.notices = false; await send(undefined, { operation: 'configure', configuration: config }); assert.ok(!(await contents()).includes('Simulated click'));
    // Old input cannot become live input across a mode change.
    config.mode = 'live'; config.revision = 1;
    await send(undefined, { operation: 'configure', configuration: config });
    assert.equal(await page.locator('[data-ghostpair-visual]').count(), 0);
    const stale = await page.evaluate(() => { let reply; controller({ target: 'ghostpair.dom', captureId: 'fixture', generation: 1, controlRevision: 0, operation: 'command', command: { type: 'text', text: 'STALE', controlRevision: 0 } }, { id: 'fixture' }, value => { reply = value; }); return reply; });
    assert.equal(stale.ok, false); assert.deepEqual(await page.evaluate(() => events), []);
    await send(undefined, { operation: 'dispose', controlRevision: 1 });
    assert.equal(await page.locator('[data-ghostpair-visual]').count(), 0);
    results.push({ browser: name, nonMutation: true, editing: true, geometry: true, notices: true, staleInputRejected: true });
  } finally { await browser.close(); }
}
await writeFile(resolve(artifactRoot, 'visual-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
