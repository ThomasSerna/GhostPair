import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { installDomControl } from '../../apps/extension/src/core/dom-control.ts';
import { artifactRoot, browsers } from './helpers.mjs';

// Exercise the production DOM function in real browser DOMs, using only synthetic
// pages and a runtime stub. This does not validate extension permissions or video.
const embedded = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><title>Cross-origin fixture</title><button>Embedded target</button>');
});
await new Promise(done => embedded.listen(0, '127.0.0.1', done));
const fixture = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><meta charset="utf-8"><title>GhostPair DOM control probe</title>
    <style>body{font:16px sans-serif;margin:20px;min-height:1500px}button,input,textarea{font:inherit;margin:8px;padding:8px}#scroller{position:absolute;top:250px;left:20px;width:180px;height:120px;overflow:auto;border:2px solid}#scroller div{height:600px;width:600px;background:linear-gradient(#ddd,#789)}iframe{position:absolute;top:250px;left:280px;width:300px;height:120px}#editable{min-height:30px;width:400px;border:1px solid;padding:8px}</style>
    <button id="button"><span>Click target</span></button><label><input id="checkbox" type="checkbox">Toggle</label>
    <input id="controlled" aria-label="Controlled input"><textarea id="textarea"></textarea><div id="editable" contenteditable="true"></div>
    <div id="scroller"><div></div></div><iframe src="http://127.0.0.1:${embedded.address().port}/"></iframe>
    <script>
      globalThis.probe = { clicks: 0, releases: 0, inputEvents: [], customSetterCalls: 0 };
      document.querySelector('#button').addEventListener('click', () => probe.clicks++);
      document.addEventListener('pointercancel', () => probe.releases++);
      const input = document.querySelector('#controlled');
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      Object.defineProperty(input, 'value', { get() { return descriptor.get.call(this); }, set(value) { probe.customSetterCalls++; descriptor.set.call(this, value); } });
      input.addEventListener('input', event => probe.inputEvents.push({ value: input.value, inputType: event.inputType, data: event.data }));
    </script>`);
});
await new Promise(done => fixture.listen(0, '127.0.0.1', done));

const captureId = 'synthetic-capture';
const results = [];
const controlSource = `(${installDomControl.toString()})`;

async function send(page, command, { generation = 1, operation = 'command', sender = { id: 'synthetic-extension' }, targetCaptureId = captureId } = {}) {
  return page.evaluate(({ command, generation, operation, sender, captureId }) => {
    let response;
    for (const listener of globalThis.runtimeProbe.listeners) listener({ target: 'ghostpair.dom', captureId, generation, operation, command }, sender, value => { response = value; });
    return response;
  }, { command, generation, operation, sender, captureId: targetCaptureId });
}

async function execute(page, command, options) {
  const reply = await send(page, command, options);
  assert.equal(reply?.ok, true, `${command.type}: ${JSON.stringify(reply)}`);
}

async function point(page, selector) {
  return page.locator(selector).evaluate(element => {
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
}

async function click(page, selector, options) {
  const coords = await point(page, selector);
  for (const event of ['down', 'up']) await execute(page, { type: 'pointer', tabId: 1, generation: 1, ...coords, event, button: 'left', buttons: event === 'down' ? 1 : 0, modifiers: 0, clickCount: 1 }, options);
}

async function key(page, value, options) {
  for (const event of ['down', 'up']) await execute(page, { type: 'key', tabId: 1, generation: 1, event, key: value, code: value, keyCode: 0, modifiers: 0, repeat: false }, options);
}

try {
  await mkdir(artifactRoot, { recursive: true });
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'edge']) {
    assert.ok(browsers[name], `Unknown browser: ${name}`);
    // launch() creates its own temporary profile; no installed user profile is used.
    const browser = await chromium.launch({ executablePath: browsers[name], headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${fixture.address().port}/`);
      await page.evaluate(() => {
        globalThis.runtimeProbe = { listeners: new Set(), sent: [] };
        globalThis.chrome = { runtime: {
          id: 'synthetic-extension',
          onMessage: { addListener: listener => runtimeProbe.listeners.add(listener), removeListener: listener => runtimeProbe.listeners.delete(listener) },
          sendMessage: async message => { runtimeProbe.sent.push(message); },
        } };
      });
      await page.addScriptTag({ content: `globalThis.installedGeometry = ${controlSource}('synthetic-capture', 1);` });
      assert.deepEqual(await page.evaluate(() => globalThis.installedGeometry), { viewportWidth: 1000, viewportHeight: 760, offsetLeft: 0, offsetTop: 0, scale: 1 });

      await click(page, '#button span');
      assert.equal(await page.evaluate(() => probe.clicks), 1, 'one pointer gesture produces one click');
      await click(page, '#checkbox');
      assert.equal(await page.locator('#checkbox').isChecked(), true, 'checkbox activation toggles once');
      await click(page, '#checkbox');
      assert.equal(await page.locator('#checkbox').isChecked(), false, 'checkbox can toggle back');

      await click(page, '#controlled');
      await execute(page, { type: 'text', text: 'Remote á漢🙂' });
      assert.equal(await page.locator('#controlled').inputValue(), 'Remote á漢🙂', 'Unicode text reaches the field');
      assert.deepEqual(await page.evaluate(() => ({ customSetterCalls: probe.customSetterCalls, inputEvents: probe.inputEvents })), {
        customSetterCalls: 0, inputEvents: [{ value: 'Remote á漢🙂', inputType: 'insertText', data: 'Remote á漢🙂' }],
      }, 'native setter bypasses the controlled-input wrapper and emits input');
      await key(page, 'Backspace');
      assert.equal(await page.locator('#controlled').inputValue(), 'Remote á漢', 'Backspace removes an entire supplementary Unicode code point');

      await click(page, '#textarea');
      await execute(page, { type: 'text', text: 'Line🙂' });
      await key(page, 'Backspace');
      await key(page, 'Enter');
      await execute(page, { type: 'text', text: '第二行' });
      assert.equal(await page.locator('#textarea').inputValue(), 'Line\n第二行', 'textarea supports Unicode, deletion and line breaks');

      await click(page, '#editable');
      await execute(page, { type: 'text', text: 'Editable á漢🙂' });
      assert.equal(await page.locator('#editable').textContent(), 'Editable á漢🙂', 'basic contenteditable insertion works');
      await key(page, 'Backspace');
      assert.equal(await page.locator('#editable').textContent(), 'Editable á漢', 'basic contenteditable deletion works');

      const nested = await point(page, '#scroller');
      await execute(page, { type: 'wheel', ...nested, deltaX: 35, deltaY: 80, modifiers: 0 });
      assert.deepEqual(await page.evaluate(() => ({ top: document.querySelector('#scroller').scrollTop, left: document.querySelector('#scroller').scrollLeft, document: scrollY })), { top: 80, left: 35, document: 0 }, 'scroll stays in its nested container');

      const embeddedPoint = await point(page, 'iframe');
      const routed = await send(page, { type: 'pointer', ...embeddedPoint, event: 'down', button: 'left', buttons: 1, modifiers: 0, clickCount: 1 }, { operation: 'prepare' });
      assert.equal(routed?.ok, true);
      assert.equal(routed.child.index, 0, 'cross-origin iframe resolves to a child window index');
      assert.ok(Math.abs(routed.child.x - 0.5) < 0.01 && Math.abs(routed.child.y - 0.5) < 0.01);

      const button = await point(page, '#button');
      const stale = await send(page, { type: 'pointer', ...button, event: 'down', button: 'left', buttons: 1, modifiers: 0, clickCount: 1 }, { generation: 0 });
      assert.equal(stale?.ok, false);
      assert.match(stale.error, /page changed/);
      assert.equal(await page.evaluate(() => probe.clicks), 1, 'stale generation cannot activate a target');
      assert.equal(await send(page, { type: 'text', text: 'denied' }, { sender: { id: 'foreign-extension' } }), undefined, 'foreign extension is ignored');
      assert.equal(await send(page, { type: 'text', text: 'denied' }, { sender: { id: 'synthetic-extension', tab: { id: 1 } } }), undefined, 'tab-originated commands are ignored');
      assert.equal(await send(page, { type: 'text', text: 'denied' }, { targetCaptureId: 'old-capture' }), undefined, 'old capture identity is ignored');

      const beforeRelease = await page.evaluate(() => probe.releases);
      await execute(page, { type: 'pointer', ...button, event: 'down', button: 'left', buttons: 1, modifiers: 0, clickCount: 1 });
      await page.addScriptTag({ content: `${controlSource}('synthetic-capture', 2);` });
      assert.equal(await page.evaluate(() => runtimeProbe.listeners.size), 1, 'reinstallation updates rather than duplicates the listener');
      assert.equal(await page.evaluate(() => probe.releases), beforeRelease + 1, 'generation transition releases a held pointer');
      await click(page, '#button', { generation: 2 });
      assert.equal(await page.evaluate(() => probe.clicks), 2, 'the new generation accepts input');
      const reports = await page.evaluate(() => runtimeProbe.sent.length);
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      assert.equal(await page.evaluate(() => runtimeProbe.sent.length), reports, 'unchanged geometry does not block input');
      await page.setViewportSize({ width: 900, height: 700 });
      await page.waitForFunction(() => runtimeProbe.sent.at(-1)?.geometry.viewportWidth === 900);
      assert.equal(await page.evaluate(() => runtimeProbe.sent.at(-1)?.generation), 2, 'geometry notification uses the current generation');
      assert.equal((await send(page, { type: 'text', text: 'stale coordinates' }, { generation: 2 })).ok, false, 'resize blocks input before the background can respond');

      assert.equal((await send(page, undefined, { operation: 'dispose', generation: 2 }))?.ok, true);
      assert.deepEqual(await page.evaluate(() => ({ listeners: runtimeProbe.listeners.size, installed: Boolean(globalThis.__ghostpairControl) })), { listeners: 0, installed: false }, 'disposal removes the runtime listener and capture context');
      const beforeDisposedResize = await page.evaluate(() => runtimeProbe.sent.length);
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      assert.equal(await page.evaluate(() => runtimeProbe.sent.length), beforeDisposedResize, 'disposal removes geometry listeners');
      assert.deepEqual(errors, [], 'no uncaught fixture errors');

      const result = { browser: name, version: browser.version(), click: true, checkbox: true, unicode: true, nativeSetterAndInput: true, textareaEditing: true, contenteditable: true, nestedScroll: true, iframeRoute: true, staleGenerationRejected: true, senderAndCaptureIsolation: true, generationRelease: true, disposal: true, runtime: 'stubbed; no extension or media permission validation', clipboard: 'never accessed' };
      results.push(result);
      console.log(JSON.stringify(result));
    } finally { await browser.close(); }
  }
  await writeFile(resolve(artifactRoot, 'dom-probe.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
} finally {
  await Promise.all([new Promise(done => fixture.close(done)), new Promise(done => embedded.close(done))]);
}
