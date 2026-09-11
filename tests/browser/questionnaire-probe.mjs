import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installDomControl } from '../../apps/extension/src/core/dom-control.ts';
import { artifactRoot, browsers } from './helpers.mjs';
import { questionnaireHtml, questionnaireState } from './questionnaire-fixture.mjs';

// Compare production DOM behavior with browser input on disposable local fixtures.
// Native input here is a test oracle, never an extension capability.
const cases = [
  { name: 'checkbox label', click: '#choice-label', choice: true },
  { name: 'radio click', click: '#r2', radio: 'r2' },
  { name: 'nested next button', from: '#left', to: '#right', valid: true, submits: ['next'] },
  { name: 'canceled pointerdown preserves click', click: '#next', cancel: 'pointerdown', valid: true, submits: ['next'], events: ['pointerdown', 'pointerup', 'click'] },
  { name: 'canceled mousedown preserves click', click: '#next', cancel: 'mousedown', valid: true, submits: ['next'] },
  { name: 'canceled click rolls back choice', click: '#choice', cancel: 'click', choice: false },
  { name: 'canceled submit click', click: '#next', cancel: 'click', valid: true, submits: [] },
  { name: 'first legend remains enabled', click: '#legend', legend: 1 },
  { name: 'fieldset control stays disabled', click: '#disabled-child', disabled: 0 },
  { name: 'space toggles checkbox', focus: '#choice', key: 'Space', choice: true },
  { name: 'space activates button', focus: '#next', key: 'Space', valid: true, submits: ['next'] },
  { name: 'canceled space keydown', focus: '#choice', key: 'Space', cancel: 'keydown', choice: false },
  { name: 'canceled space keyup', focus: '#choice', key: 'Space', cancel: 'keyup', choice: false },
  { name: 'radio arrows skip disabled', focus: '#r1', key: 'ArrowRight', radio: 'r2' },
  { name: 'select arrows skip disabled options', focus: '#list', key: 'ArrowDown', list: 'D' },
  { name: 'select respects canceled keydown', focus: '#list', key: 'ArrowDown', cancel: 'keydown', list: 'A' },
  { name: 'implicit Enter preserves submitter', focus: '#text', key: 'Enter', valid: true, submits: ['next'] },
  { name: 'Enter retains required validation', focus: '#text', key: 'Enter', submits: [] },
  { name: 'disabled default submitter blocks Enter', focus: '#text', key: 'Enter', valid: true, disableDefault: true, submits: [] },
  { name: 'trusted-only remains unsupported', click: '#trusted', trustedOnly: true },
];

const results = [];
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'edge']) {
  const browser = await chromium.launch({ executablePath: browsers[name], headless: true });
  try {
    for (const test of cases) {
      const states = [];
      for (const native of [true, false]) {
        const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
        try {
          await page.setContent(questionnaireHtml);
          await page.evaluate(test => {
            if (test.valid) document.querySelector('#choice').checked = true;
            if (test.disableDefault) document.querySelector('#next').disabled = true;
            if (test.cancel) document.querySelector(test.click ?? test.focus).addEventListener(test.cancel, e => e.preventDefault());
          }, test);
          if (!native) {
            await page.evaluate(() => {
              globalThis.chrome = { runtime: { id: 'fixture', onMessage: { addListener: fn => { globalThis.controller = fn; }, removeListener() {} }, sendMessage: async () => ({}) } };
            });
            await page.evaluate(`(${installDomControl.toString()})('fixture',1)`);
          }
          const send = command => page.evaluate(command => {
            let result;
            controller({ target: 'ghostpair.dom', captureId: 'fixture', generation: 1, operation: 'command', command }, { id: 'fixture' }, value => { result = value; });
            if (!result?.ok) throw new Error(result?.error ?? 'Missing controller result');
          }, command);
          const point = selector => page.locator(selector).evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; });
          if (test.focus) {
            await page.locator(test.focus).focus();
            if (native) await page.keyboard.press(test.key);
            else {
              const key = test.key === 'Space' ? ' ' : test.key;
              for (const event of ['down', 'up']) await send({ type: 'key', event, key, code: test.key, modifiers: 0, repeat: false });
            }
          } else {
            const from = await point(test.from ?? test.click), to = await point(test.to ?? test.click);
            if (native) { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y); await page.mouse.up(); }
            else {
              await send({ type: 'pointer', event: 'down', ...from, button: 'left', buttons: 1, modifiers: 0, clickCount: 1 });
              await send({ type: 'pointer', event: 'up', ...to, button: 'left', buttons: 0, modifiers: 0, clickCount: 1 });
            }
          }
          const state = await page.evaluate(questionnaireState);
          for (const property of ['choice', 'radio', 'list', 'submits', 'legend', 'disabled']) if (property in test) assert.deepEqual(state[property], test[property], `${name}/${test.name}/${native ? 'browser' : 'DOM'}/${property}`);
          if (test.events) assert.deepEqual(await page.evaluate(() => quizProbe.events.map(e => e[0])), test.events);
          states.push(state);
        } finally { await page.close(); }
      }
      if (test.trustedOnly) { assert.equal(states[0].trusted, 1); assert.equal(states[1].trusted, 0); }
      else assert.deepEqual(states[1], states[0], `${name}/${test.name}: browser parity`);
      results.push({ browser: name, case: test.name, passed: true });
    }
  } finally { await browser.close(); }
}
await mkdir(artifactRoot, { recursive: true });
await writeFile(`${artifactRoot}/questionnaire-results.json`, JSON.stringify(results, null, 2));
console.log(`Passed ${results.length} questionnaire comparisons.`);
