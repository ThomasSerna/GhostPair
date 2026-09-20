import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Visual QA only: Chrome APIs are mocked. Browser integration tests use real extensions.
const output = resolve('tests/browser/.artifacts/ui');
mkdirSync(output, { recursive: true });
const server = await createServer({ root: resolve('apps/extension'), optimizeDeps: { entries: ['popup.html', 'viewer.html'] }, server: { host: '127.0.0.1', port: 5193, strictPort: true } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 398, height: 790 } });
  await context.addInitScript(() => {
    const state = { role: null, status: 'idle', paused: false, controlEnabled: true, controlMode: 'visual', controlRevision: 0, visualPreferences: { notices: false, clickAnimations: true, text: { duration: 'persistent', seconds: 10 }, other: { duration: 'persistent', seconds: 3 }, accentColor: '#7871e8' }, clipboardEnabled: false, remoteClipboardEnabled: false, tabs: [], generation: 0, settings: { signalingUrl: 'http://127.0.0.1:8787', stunUrls: ['stun:stun.example.com:3478'] } };
    if (location.search === '?host') { state.role = 'host'; state.status = 'connected'; }
    globalThis.uiState = state;
    const noEvent = { addListener() {}, removeListener() {} };
    globalThis.chrome = {
      runtime: { id: 'a'.repeat(32), onMessage: noEvent, sendMessage: async message => { if (message.type === 'ui.control.mode') state.controlMode = message.mode; if (message.type === 'ui.visual.preferences') state.visualPreferences = message.preferences; return { ok: true, state: structuredClone(state) }; }, getURL: p => `http://127.0.0.1:5193/${p}`, connect: () => ({ onMessage: noEvent, onDisconnect: noEvent, postMessage() {}, disconnect() {} }) },
      permissions: { request: async () => true }, tabs: { create: async () => ({}) },
    };
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5193/popup.html');
  await page.getByRole('button', { name: 'Share current tab →' }).waitFor();
  await page.screenshot({ path: resolve(output, 'popup.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open settings' }).click();
  assert.equal(await page.getByLabel('Click animations').isChecked(), true);
  await page.getByLabel('Click animations').uncheck();
  assert.equal(await page.evaluate(() => uiState.visualPreferences.clickAnimations), false);
  assert.equal(await page.getByLabel('Purple', { exact: true }).isChecked(), true);
  await page.getByLabel('Blue', { exact: true }).check();
  assert.equal(await page.evaluate(() => uiState.visualPreferences.accentColor), '#3b82f6');
  await page.getByLabel('Custom color', { exact: false }).fill('#12abcd');
  assert.equal(await page.evaluate(() => uiState.visualPreferences.accentColor), '#12abcd');
  await page.screenshot({ path: resolve(output, 'settings.png'), fullPage: true });
  await page.goto('http://127.0.0.1:5193/popup.html?host');
  await page.getByLabel('Interaction mode').waitFor();
  assert.equal(await page.getByLabel('Interaction mode').inputValue(), 'visual');
  assert.equal(await page.getByLabel('Simulation notices').isChecked(), false);
  assert.equal(await page.getByLabel('Click animations').isChecked(), true);
  await page.getByLabel('Click animations').uncheck();
  assert.equal(await page.evaluate(() => uiState.visualPreferences.clickAnimations), false);
  await page.getByLabel('Click animations').check();
  await page.screenshot({ path: resolve(output, 'simulation-default.png'), fullPage: true });
  const textPreferences = page.getByRole('group', { name: 'Simulated text', exact: true }), otherPreferences = page.getByRole('group', { name: 'Other simulations', exact: true });
  await textPreferences.getByRole('combobox').selectOption('temporary');
  await otherPreferences.getByRole('combobox').selectOption('temporary');
  assert.equal(await otherPreferences.getByLabel('Seconds without interaction').inputValue(), '3');
  await textPreferences.getByLabel('Seconds without interaction').fill('0.5');
  await textPreferences.getByLabel('Seconds without interaction').blur();
  await page.getByLabel('Simulation notices').check();
  await page.screenshot({ path: resolve(output, 'simulation-temporary.png'), fullPage: true });
  assert.deepEqual(await page.evaluate(() => uiState.visualPreferences), { notices: true, clickAnimations: true, text: { duration: 'temporary', seconds: 0.5 }, other: { duration: 'temporary', seconds: 3 }, accentColor: '#7871e8' });
  for (const invalid of ['0', '0.25', '31', '']) {
    await textPreferences.getByLabel('Seconds without interaction').fill(invalid);
    await textPreferences.getByLabel('Seconds without interaction').blur();
    assert.equal(await textPreferences.getByLabel('Seconds without interaction').inputValue(), '0.5');
  }
  for (const [name, hex] of [['Blue', '#3b82f6'], ['Green', '#22c55e'], ['Orange', '#f97316'], ['Pink', '#ec4899'], ['Purple', '#7871e8']]) {
    await page.getByLabel(name, { exact: true }).check();
    assert.equal(await page.evaluate(() => uiState.visualPreferences.accentColor), hex);
  }
  await page.getByLabel('Custom color', { exact: false }).fill('#12abcd');
  assert.equal(await page.evaluate(() => uiState.visualPreferences.accentColor), '#12abcd');
  await page.screenshot({ path: resolve(output, 'simulation-custom-color.png'), fullPage: true });
  await page.setViewportSize({ width: 1365, height: 850 });
  await page.goto('http://127.0.0.1:5193/viewer.html');
  await page.getByText('Connect with your host.').waitFor();
  await page.screenshot({ path: resolve(output, 'viewer.png'), fullPage: true });
  await page.setViewportSize({ width: 398, height: 790 });
  await page.screenshot({ path: resolve(output, 'viewer-mobile.png'), fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  process.stdout.write(`Visual QA: 7 screenshots, no page errors. ${output}\n`);
} finally { await browser?.close(); await server.close(); }
