import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// UI behavior and visual QA use mocked Chrome APIs. Native browser suites verify capture/WebRTC.
const output = resolve('tests/browser/.artifacts/ui');
const checkOnly = process.argv.includes('--check-only');
const official = { signalingUrl: 'https://ghostpair.onrender.com', stunUrls: ['stun:stun.l.google.com:19302'] };
const code = '0123456789abcdef0123456789abcdef';
const manifest = JSON.parse(readFileSync('apps/extension/public/manifest.json', 'utf8'));
const server = await createServer({ root: resolve('apps/extension'), optimizeDeps: { entries: ['popup.html', 'viewer.html'] }, server: { host: '127.0.0.1', port: 5193, strictPort: true } });
let browser, checks = 0, screenshots = 0;
const equal = (...args) => { checks++; assert.equal(...args); };
const deepEqual = (...args) => { checks++; assert.deepEqual(...args); };
const ok = (...args) => { checks++; assert.ok(...args); };
const errors = [];

function mockChrome({ manifest, official, code }) {
  const scenario = new URLSearchParams(location.search).get('scenario');
  const state = {
    role: null, status: 'idle', deviceId: code, paused: false, controlEnabled: true, controlMode: 'visual', controlRevision: 0,
    visualPreferences: { notices: false, clickAnimations: true, showInteractions: true, showHostPanel: true, text: { duration: 'temporary', seconds: 0.5 }, other: { duration: 'temporary', seconds: 0.5 }, accentColor: '#7871e8' },
    clipboardEnabled: false, remoteClipboardEnabled: false, tabs: [], generation: 0, settings: structuredClone(official),
  };
  const tab = (id, authorized = true, active = id === 1) => ({ id, title: ['Weekend plans', 'Shared notes', 'Trip details', 'Packing list', 'Map'][id - 1] ?? 'Another page', url: `https://example.com/page-${id}`, supported: true, active, authorized, ...(authorized ? { captureState: 'ready' } : {}) });
  if (['host', 'empty', 'five', 'capture', 'unsupported', 'paused', 'guest'].includes(scenario)) {
    state.role = scenario === 'guest' ? 'guest' : 'host'; state.status = ['empty', 'capture', 'unsupported'].includes(scenario) ? 'waiting' : scenario === 'paused' ? 'paused' : 'connected';
    state.paused = scenario === 'paused'; state.sessionId = 'mock-session'; state.tabs = [tab(1)]; state.activeTabId = 1;
    if (scenario === 'empty') state.tabs = [tab(1, false)];
    if (scenario === 'five') { state.tabs = [...Array.from({ length: 5 }, (_, i) => tab(i + 1, true, false)), tab(6, false, true)]; state.activeTabId = 6; }
    if (scenario === 'capture') { state.tabs = [{ ...tab(1, true, false), captureState: 'pending' }, { ...tab(2, true, false), captureState: 'unavailable' }, tab(3, false, true)]; state.activeTabId = 3; }
    if (scenario === 'unsupported') state.tabs = [{ ...tab(1, false), supported: false, title: 'Browser settings', url: 'chrome://settings' }];
  }
  if (scenario === 'dev') state.settings = { signalingUrl: 'http://127.0.0.1:8787', stunUrls: ['stun:127.0.0.1:3478'] };
  const event = () => { const listeners = new Set(); return { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener), emit: message => { for (const listener of listeners) listener(message); } }; };
  const runtimeMessages = event(), ports = [];
  const broadcast = () => { const message = { type: 'state', state: structuredClone(state) }; runtimeMessages.emit(message); for (const port of ports) port.onMessage.emit(message); };
  const mock = {
    calls: [], permissionRequests: [], permissions: 'allow', pendingPermission: null, viewerOpens: 0, copiedText: '', clearCount: 0,
    pendingStatuses: [],
    update: patch => { Object.assign(state, structuredClone(patch)); broadcast(); },
    resolveStatus: () => { const finish = mock.pendingStatuses.shift(); if (!finish) throw new Error('No status response is pending.'); finish(); },
    resolvePermission: granted => { const finish = mock.pendingPermission; mock.pendingPermission = null; if (!finish) throw new Error('No permission request is pending.'); finish(granted); },
    portMessage: message => { for (const port of ports) port.onMessage.emit(message); },
    disconnectPort: () => { const port = ports.at(-1); port.disconnect(); port.onDisconnect.emit(); },
  };
  globalThis.uiState = state; globalThis.uiMock = mock;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { mock.copiedText = text; }, readText: async () => mock.copiedText } });
  globalThis.chrome = {
    runtime: {
      id: 'a'.repeat(32), getManifest: () => manifest, getURL: path => `http://127.0.0.1:5193/${path}`, onMessage: runtimeMessages,
      connect: () => { const port = { onMessage: event(), onDisconnect: event(), postMessage() {}, disconnect() { ports.splice(ports.indexOf(port), 1); } }; ports.push(port); return port; },
      sendMessage: async message => {
        mock.calls.push(structuredClone(message));
        switch (message.type) {
          case 'ui.status':
            if (scenario === 'status-race') {
              const response = { ok: true, state: structuredClone(state), text: '' };
              return new Promise(finish => mock.pendingStatuses.push(() => finish(response)));
            }
            break;
          case 'ui.settings.save':
            if (!['idle', 'error'].includes(state.status)) return { ok: false, error: 'End the session before changing connection settings.' };
            state.settings = structuredClone(message.settings); state.deviceId = state.settings.signalingUrl === official.signalingUrl ? code : 'fedcba9876543210fedcba9876543210'; break;
          case 'ui.host.start': Object.assign(state, { role: 'host', status: 'waiting', sessionId: 'mock-session', paused: false, clipboardEnabled: message.clipboard, tabs: [tab(1)], activeTabId: 1 }); break;
          case 'ui.host.authorize': state.tabs = state.tabs.map(item => item.id === state.activeTabId ? { ...item, authorized: true, captureState: 'ready' } : item); break;
          case 'ui.host.release': state.tabs = state.tabs.map(item => item.id === message.tabId ? { ...item, authorized: false, captureState: undefined } : item); break;
          case 'ui.guest.start': Object.assign(state, { role: 'guest', status: 'connecting', sessionId: 'mock-session', deviceId: message.deviceId, clipboardEnabled: message.clipboard }); break;
          case 'ui.control.mode': state.controlMode = message.mode; state.controlRevision++; break;
          case 'ui.control': state.controlEnabled = message.enabled; break;
          case 'ui.pause': state.paused = message.paused; state.status = message.paused ? 'paused' : 'connected'; break;
          case 'ui.clipboard': state.clipboardEnabled = message.enabled; break;
          case 'ui.visual.preferences': state.visualPreferences = structuredClone(message.preferences); break;
          case 'ui.visual.clear': mock.clearCount++; break;
          case 'ui.viewer.open': mock.viewerOpens++; break;
          case 'ui.notification.dismiss': state.notification = undefined; break;
          case 'ui.stop': Object.assign(state, { role: null, status: 'idle', paused: false, sessionId: undefined, tabs: [], activeTabId: undefined, clipboardEnabled: false }); break;
        }
        if (message.type !== 'ui.status') broadcast();
        return { ok: true, state: structuredClone(state), text: '' };
      },
    },
    permissions: { request: async request => { mock.permissionRequests.push(structuredClone(request)); if (mock.permissions === 'delay') return new Promise(finish => { mock.pendingPermission = finish; }); return mock.permissions !== 'deny'; } },
    tabs: { create: async () => ({}) },
  };
}

async function open(context, path = 'popup', scenario = '', size = { width: 398, height: 600 }) {
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize(size); await page.goto(`http://127.0.0.1:5193/${path}.html${scenario ? `?scenario=${scenario}` : ''}`);
  await page.waitForFunction(() => globalThis.uiMock?.calls.some(call => call.type === 'ui.status'));
  await page.locator('main').waitFor(); return page;
}
const calls = (page, type) => page.evaluate(type => uiMock.calls.filter(call => call.type === type), type);
const set = (page, patch) => page.evaluate(patch => uiMock.update(patch), patch);
const permission = (page, value) => page.evaluate(value => { uiMock.permissions = value; }, value);
const resolvePermission = (page, value) => page.evaluate(value => uiMock.resolvePermission(value), value);
const waitPermission = page => page.waitForFunction(() => Boolean(uiMock.pendingPermission));
const feedback = page => page.getByText('Advanced options', { exact: true }).click();
async function settings(page) { await page.getByRole('button', { name: 'Open settings' }).click(); await page.getByRole('group', { name: 'Connection', exact: true }).waitFor(); }
async function custom(page, url = 'https://pair.example.com/', stun = 'stun:one.example.com:3478,\nstuns:two.example.com:5349') {
  await page.getByRole('radio', { name: 'Custom server', exact: false }).check();
  await page.getByLabel('Connection server', { exact: true }).fill(url); await page.getByLabel('STUN servers', { exact: false }).fill(stun);
}
async function startForm(page) {
  await page.getByRole('button', { name: 'Share my tab', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill('Example-42'); await page.getByLabel('I allow the person', { exact: false }).check();
}
async function snapshot(page, name, scroll = 'top') {
  await page.evaluate(scroll => {
    if (scroll === 'focus') return;
    document.activeElement?.blur();
    const scroller = document.querySelector('.session-popup .session-panel') ?? document.querySelector('.popup');
    if (!scroller) return;
    if (scroll === 'middle') {
      const feedback = scroller.querySelector('.interaction-feedback');
      scroller.scrollTop += feedback ? feedback.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12 : (scroller.scrollHeight - scroller.clientHeight) / 2;
    } else scroller.scrollTop = scroll === 'bottom' ? scroller.scrollHeight : 0;
  }, scroll);
  await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' }); screenshots++;
}
async function keyboardFeedback(page, verify = false) {
  await page.getByLabel('Custom color', { exact: true }).focus();
  for (const [role, name] of [['checkbox', 'Show page controls'], ['checkbox', 'Visual notices'], ['button', 'Clear previews']]) {
    await page.keyboard.press('Tab');
    if (!verify) continue;
    const control = page.getByRole(role, { name, exact: false });
    equal(await control.evaluate(element => element === document.activeElement), true, `Keyboard reaches ${name}`);
    ok(await control.evaluate(element => {
      const box = element.getBoundingClientRect(), panel = document.querySelector('.session-panel').getBoundingClientRect(), footer = document.querySelector('.session-footer').getBoundingClientRect();
      return box.top >= panel.top && box.bottom <= panel.bottom + 1 && box.bottom <= footer.top + 1;
    }), `${name} remains visible above the reserved session footer`);
  }
}

try {
  await server.listen(); browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  const context = await browser.newContext(); context.setDefaultTimeout(5000); await context.addInitScript(mockChrome, { manifest, official, code });

  for (const path of ['popup', 'viewer']) {
    const delayed = await open(context, path, 'status-race', path === 'viewer' ? { width: 1365, height: 850 } : undefined);
    equal(await delayed.evaluate(() => uiMock.pendingStatuses.length), 1, `${path} holds its initial status response`);
    await set(delayed, { role: path === 'popup' ? 'host' : 'guest', status: 'paused', paused: true, controlEnabled: false, controlMode: 'live', controlRevision: 1, generation: 17, sessionId: 'newer-session' });
    await delayed.getByText('Session paused', { exact: true }).waitFor();
    await delayed.evaluate(async () => { uiMock.resolveStatus(); await new Promise(finish => requestAnimationFrame(() => requestAnimationFrame(finish))); });
    equal(await delayed.getByText('Session paused', { exact: true }).count(), 1, `${path} keeps newer paused state after its delayed initial snapshot`);
    if (path === 'popup') {
      equal(await delayed.getByLabel('Let them control the page', { exact: true }).isChecked(), false, 'Popup keeps newer control withdrawal');
      equal(await delayed.getByLabel('Interaction mode', { exact: false }).inputValue(), 'live', 'Popup keeps newer interaction mode');
    } else {
      equal(await delayed.getByRole('heading', { name: 'The session is paused.', exact: true }).count(), 1, 'Viewer keeps its paused view');
      equal(await delayed.getByText('Control mode', { exact: true }).count(), 1, 'Viewer keeps newer interaction mode');
      equal(await delayed.getByRole('button', { name: 'Open tab', exact: true }).isDisabled(), true, 'Viewer keeps newer control withdrawal');
    }
    await delayed.close();
  }

  const replacedPort = await open(context, 'viewer', 'status-race', { width: 1365, height: 850 });
  await replacedPort.evaluate(() => uiMock.disconnectPort());
  await set(replacedPort, { role: 'guest', status: 'paused', paused: true, controlEnabled: false, controlMode: 'live', controlRevision: 1, generation: 17, sessionId: 'replacement-session' });
  await replacedPort.waitForFunction(() => uiMock.pendingStatuses.length === 2);
  await replacedPort.evaluate(async () => { uiMock.resolveStatus(); await new Promise(finish => requestAnimationFrame(() => requestAnimationFrame(finish))); });
  equal(await replacedPort.getByText('Loading GhostPair…', { exact: true }).count(), 1, 'A replaced viewer port cannot apply its delayed snapshot');
  equal(await replacedPort.getByRole('button', { name: 'Join session', exact: true }).count(), 0, 'An old port cannot restore a stale idle form');
  await replacedPort.evaluate(() => uiMock.resolveStatus());
  await replacedPort.getByText('Session paused', { exact: true }).waitFor();
  equal(await replacedPort.getByText('Control mode', { exact: true }).count(), 1, 'The current viewer port can still use its initial snapshot');
  await replacedPort.close();

  const home = await open(context);
  await home.getByRole('button', { name: 'Share my tab', exact: true }).waitFor();
  equal(await home.locator('#share-code').count(), 0, 'Home keeps the connection code in the sharing setup');
  equal(await home.getByLabel('Password', { exact: true }).count(), 0, 'Home offers intent before credentials');
  equal(await home.getByRole('button', { name: 'Join a session', exact: true }).count(), 1);
  await home.keyboard.press('Tab'); equal(await home.getByRole('button', { name: 'Open settings' }).evaluate(element => element === document.activeElement), true);
  await home.keyboard.press('Tab'); equal(await home.getByRole('button', { name: 'Share my tab', exact: true }).evaluate(element => element === document.activeElement), true);
  ok(await home.getByRole('button', { name: 'Share my tab', exact: true }).evaluate(element => parseFloat(getComputedStyle(element).outlineWidth) > 0), 'Keyboard focus is visible');
  await home.keyboard.press('Enter'); await home.getByLabel('Password', { exact: true }).waitFor();
  equal(await home.getByLabel('Password', { exact: true }).evaluate(element => element === document.activeElement), true, 'Share form focuses the password');
  const connectionCode = home.locator('.share-setup #share-code');
  equal(await connectionCode.innerText(), 'Your connection code: 0123 4567 89AB CDEF 0123 4567 89AB CDEF', 'Sharing setup displays the current shareable code');
  ok(await connectionCode.evaluate(element => {
    const codeBox = element.getBoundingClientRect(), introBox = document.querySelector('.share-setup>.muted').getBoundingClientRect(), formBox = document.querySelector('.share-setup form').getBoundingClientRect();
    return codeBox.top >= introBox.bottom && codeBox.bottom <= formBox.top && parseFloat(getComputedStyle(element).fontSize) <= 12 && element.scrollWidth <= element.clientWidth && codeBox.right <= innerWidth;
  }), 'Small connection-code text fits below the sharing intro and above the password form');
  await set(home, { deviceId: null });
  equal(await connectionCode.innerText(), 'Your connection code: Generated when you share', 'Missing identity uses a preparation hint without a stale code');
  await set(home, { deviceId: code });
  equal(await home.getByLabel('Share clipboard', { exact: false }).isChecked(), false);
  equal(await home.getByLabel('I allow the person', { exact: false }).evaluate(element => element.required), true);
  await home.getByLabel('Password', { exact: true }).fill('Example-42'); await home.getByLabel('I allow the person', { exact: false }).check();
  await home.getByRole('button', { name: 'Back', exact: true }).click();
  await home.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Share my tab');
  await home.getByRole('button', { name: 'Share my tab', exact: true }).click();
  equal(await home.getByLabel('Password', { exact: true }).inputValue(), ''); equal(await home.getByLabel('I allow the person', { exact: false }).isChecked(), false);
  await home.getByLabel('Password', { exact: true }).fill('Example-42'); await home.getByRole('button', { name: 'Share this tab', exact: true }).click();
  equal((await calls(home, 'ui.host.start')).length, 0, 'Consent blocks session creation');
  await home.getByLabel('I allow the person', { exact: false }).check(); await permission(home, 'deny');
  await home.getByRole('button', { name: 'Share this tab', exact: true }).click(); await home.getByRole('alert').waitFor();
  equal(await home.getByLabel('Password', { exact: true }).inputValue(), ''); equal((await calls(home, 'ui.host.start')).length, 0, 'Denied permissions do not start a session');
  await home.getByRole('button', { name: 'Dismiss error' }).click(); await permission(home, 'allow');
  await home.getByLabel('Password', { exact: true }).fill('Example-42'); await home.getByRole('button', { name: 'Share this tab', exact: true }).click();
  await home.getByText('Waiting for someone to join', { exact: true }).waitFor();
  equal((await calls(home, 'ui.host.start'))[0].clipboard, false); equal(await home.getByRole('button', { name: 'Pause session', exact: true }).count(), 0);
  deepEqual(await home.evaluate(() => uiMock.permissionRequests.at(-1)), { origins: ['http://*/*', 'https://*/*'] });
  await home.getByRole('button', { name: 'End session', exact: true }).click();
  await home.getByRole('button', { name: 'Back', exact: true }).click(); await home.getByRole('button', { name: 'Join a session', exact: true }).click();
  equal(await home.evaluate(() => uiMock.viewerOpens), 1); equal(await home.evaluate(() => uiState.role), null, 'Join opens the viewer without starting a session');

  const editor = await open(context); await settings(editor);
  equal(await editor.getByRole('radio', { name: 'GhostPair server', exact: false }).isChecked(), true);
  equal(await editor.getByLabel('Connection server', { exact: true }).count(), 0); equal(await editor.getByLabel('STUN servers', { exact: false }).count(), 0);
  ok(!(await editor.locator('body').innerText()).includes(official.signalingUrl), 'Official endpoint is hidden');
  await custom(editor); deepEqual(await editor.evaluate(() => uiState.settings), official, 'Changing radios and fields only edits the draft');
  await editor.getByLabel('Connection server', { exact: true }).fill('http://public.example.com'); await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await editor.getByRole('alert').filter({ hasText: 'Use HTTPS' }).waitFor(); equal((await calls(editor, 'ui.settings.save')).length, 0);
  await custom(editor, 'https://pair.example.com/', 'https://bad.example.com'); await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await editor.getByRole('alert').filter({ hasText: 'STUN' }).waitFor(); equal((await calls(editor, 'ui.settings.save')).length, 0);
  await custom(editor); await permission(editor, 'delay'); await editor.getByRole('button', { name: 'Save', exact: true }).click(); await waitPermission(editor);
  equal(await editor.locator('.connection-settings').getAttribute('aria-busy'), 'true'); equal(await editor.getByRole('radio', { name: 'Custom server', exact: false }).isDisabled(), true);
  equal(await editor.getByLabel('Connection server', { exact: true }).isDisabled(), true); equal(await editor.getByRole('button', { name: 'Close settings' }).isDisabled(), true);
  deepEqual(await editor.evaluate(() => uiState.settings), official); await resolvePermission(editor, true);
  await editor.getByRole('button', { name: 'Open settings' }).waitFor();
  deepEqual(await editor.evaluate(() => uiState.settings), { signalingUrl: 'https://pair.example.com', stunUrls: ['stun:one.example.com:3478', 'stuns:two.example.com:5349'] });
  await editor.getByRole('button', { name: 'Share my tab', exact: true }).click();
  equal(await editor.locator('.share-setup #share-code').innerText(), 'Your connection code: FEDC BA98 7654 3210 FEDC BA98 7654 3210', 'Sharing setup updates its connection code when the saved server changes');
  await editor.getByRole('button', { name: 'Back', exact: true }).click();
  await settings(editor); equal(await editor.getByRole('radio', { name: 'Custom server', exact: false }).isChecked(), true);
  await editor.getByRole('radio', { name: 'GhostPair server', exact: false }).check(); equal(await editor.getByLabel('STUN servers', { exact: false }).count(), 0);
  equal(await editor.evaluate(() => uiState.settings.signalingUrl), 'https://pair.example.com', 'Returning to the official option is a draft until Save');
  await permission(editor, 'allow'); await editor.getByRole('button', { name: 'Save', exact: true }).click(); await editor.getByRole('button', { name: 'Open settings' }).waitFor();
  deepEqual(await editor.evaluate(() => uiState.settings), official); equal(await editor.evaluate(() => uiState.deviceId), code);
  await editor.getByRole('button', { name: 'Share my tab', exact: true }).click();
  equal(await editor.locator('.share-setup #share-code').innerText(), 'Your connection code: 0123 4567 89AB CDEF 0123 4567 89AB CDEF', 'Returning to the official server restores its code');
  await editor.getByRole('button', { name: 'Back', exact: true }).click();

  const race = await open(context); await settings(race); await custom(race); await permission(race, 'delay');
  await race.getByRole('button', { name: 'Save', exact: true }).click(); await waitPermission(race);
  await set(race, { role: 'host', status: 'waiting' }); await resolvePermission(race, true);
  await race.getByRole('alert').filter({ hasText: 'End the session' }).waitFor();
  equal((await calls(race, 'ui.settings.save')).length, 0, 'A session starting during permissions prevents settings writes');
  equal(await race.getByRole('radio', { name: 'GhostPair server', exact: false }).isDisabled(), true);
  equal(await race.getByRole('button', { name: 'Close settings' }).isEnabled(), true, 'Settings remain closable after a session starts');
  await race.getByRole('button', { name: 'Close settings' }).click(); await race.getByRole('button', { name: 'End session', exact: true }).waitFor();
  const dev = await open(context, 'popup', 'dev'); await settings(dev); equal(await dev.getByRole('radio', { name: 'Custom server', exact: false }).isChecked(), true);
  equal(await dev.getByLabel('Connection server', { exact: true }).inputValue(), 'http://127.0.0.1:8787');
  const guestEditor = await open(context); await settings(guestEditor); await guestEditor.getByText('Interaction feedback', { exact: true }).click();
  await set(guestEditor, { role: 'guest', status: 'connected' }); equal(await guestEditor.getByLabel('Show page controls', { exact: false }).isDisabled(), true, 'Joining while settings are open cannot edit sharing preferences');
  await guestEditor.getByRole('button', { name: 'Close settings' }).click(); await guestEditor.getByRole('button', { name: 'Leave session', exact: true }).waitFor();

  const host = await open(context, 'popup', 'host'); await host.getByText('Connected', { exact: true }).waitFor();
  ok(await host.evaluate(() => {
    const panel = document.querySelector('.session-panel').getBoundingClientRect(), actions = document.querySelector('.session-actions').getBoundingClientRect(), popup = document.querySelector('.popup').getBoundingClientRect();
    return panel.bottom <= actions.top && actions.bottom <= popup.bottom;
  }), 'Scrollable session content and persistent actions occupy separate areas');
  equal(await host.getByRole('button', { name: 'Open settings' }).isDisabled(), true); equal(await host.getByLabel('Show page controls', { exact: false }).isVisible(), false);
  await host.getByRole('button', { name: 'Copy code', exact: true }).click(); await host.getByRole('button', { name: 'Copied', exact: true }).waitFor();
  equal(await host.evaluate(() => uiMock.copiedText), code);
  await host.getByLabel('Let them control the page', { exact: true }).uncheck(); equal(await host.evaluate(() => uiState.controlEnabled), false);
  await host.getByLabel('Let them control the page', { exact: true }).check(); await feedback(host);
  equal(await host.getByLabel('Show their actions', { exact: false }).isChecked(), true); equal(await host.getByLabel('Visual notices', { exact: false }).isChecked(), false);
  for (const label of ['Show their actions', 'Show where they click', 'Show page controls']) {
    await host.getByLabel(label, { exact: false }).uncheck(); equal(await host.getByLabel(label, { exact: false }).isChecked(), false);
    await host.getByLabel(label, { exact: false }).check(); equal(await host.getByLabel(label, { exact: false }).isChecked(), true);
  }
  const text = host.getByRole('group', { name: 'Text previews', exact: true }), other = host.getByRole('group', { name: 'Other previews', exact: true });
  for (const group of [text, other]) {
    equal(await group.getByRole('combobox').inputValue(), 'temporary');
    const seconds = group.getByLabel('Seconds without activity', { exact: false });
    equal(await seconds.inputValue(), '0.5');
    deepEqual(await seconds.evaluate(element => [element.min, element.max, element.step]), ['0.1', '10', '0.1'], 'Preview duration exposes the supported range');
  }
  for (const invalid of ['0', '0.25', '10.1', '11', '']) {
    await text.getByLabel('Seconds without activity', { exact: false }).fill(invalid); await text.getByLabel('Seconds without activity', { exact: false }).blur();
    equal(await text.getByLabel('Seconds without activity', { exact: false }).inputValue(), '0.5');
  }
  await other.getByLabel('Seconds without activity', { exact: false }).fill('10'); await other.getByLabel('Seconds without activity', { exact: false }).blur();
  equal(await host.evaluate(() => uiState.visualPreferences.other.seconds), 10, 'The maximum preview lifetime saves automatically');
  equal(await host.evaluate(() => uiState.visualPreferences.text.seconds), 0.5, 'Other duration changes preserve text duration');
  await other.getByRole('combobox').selectOption('persistent');
  equal(await other.getByLabel('Seconds without activity', { exact: false }).count(), 0, 'Until cleared hides the temporary lifetime');
  equal(await host.evaluate(() => uiState.visualPreferences.other.duration), 'persistent', 'Until cleared saves automatically');
  for (const [name, hex] of [['Blue', '#3b82f6'], ['Green', '#22c55e'], ['Orange', '#f97316'], ['Pink', '#ec4899'], ['Purple', '#7871e8']]) {
    await host.getByLabel(name, { exact: true }).check(); equal(await host.evaluate(() => uiState.visualPreferences.accentColor), hex);
  }
  await host.getByLabel('Custom color', { exact: true }).fill('#12abcd'); equal(await host.evaluate(() => uiState.visualPreferences.accentColor), '#12abcd');
  await host.getByLabel('Visual notices', { exact: false }).check(); equal(await host.evaluate(() => uiState.visualPreferences.notices), true);
  await keyboardFeedback(host, true);
  await host.getByRole('button', { name: 'Clear previews', exact: true }).click(); equal(await host.evaluate(() => uiMock.clearCount), 1);
  await host.getByLabel('Interaction mode', { exact: false }).selectOption('live'); equal(await host.getByRole('button', { name: 'Clear previews', exact: true }).isDisabled(), true);
  await host.getByLabel('Interaction mode', { exact: false }).selectOption('visual'); equal(await host.getByRole('button', { name: 'Clear previews', exact: true }).isDisabled(), false);
  await host.getByLabel('Share clipboard', { exact: false }).check(); deepEqual(await host.evaluate(() => uiMock.permissionRequests.at(-1).permissions), ['clipboardRead', 'clipboardWrite']);
  equal(await host.evaluate(() => uiState.clipboardEnabled), true); await host.getByLabel('Share clipboard', { exact: false }).uncheck();
  await host.getByRole('button', { name: 'Pause session', exact: true }).click(); await host.getByText('Session paused', { exact: true }).waitFor();
  equal(await host.getByRole('button', { name: 'Resume session', exact: true }).count(), 1); await host.getByRole('button', { name: 'Resume session', exact: true }).click();
  await host.getByRole('button', { name: 'Stop sharing Weekend plans', exact: true }).click(); equal(await host.getByRole('button', { name: 'Share this tab', exact: true }).isDisabled(), false);
  await host.getByRole('button', { name: 'Share this tab', exact: true }).click(); equal(await host.evaluate(() => uiState.tabs[0].authorized), true);
  const empty = await open(context, 'popup', 'empty'); await empty.getByText('No tabs shared yet.', { exact: false }).waitFor(); equal(await empty.getByRole('button', { name: 'Share this tab', exact: true }).isDisabled(), false);
  const five = await open(context, 'popup', 'five'); await five.getByText('5/5', { exact: true }).waitFor(); equal(await five.getByRole('button', { name: 'Share this tab', exact: true }).isDisabled(), true);
  await five.getByRole('button', { name: 'Stop sharing Weekend plans', exact: true }).click(); equal(await five.getByRole('button', { name: 'Share this tab', exact: true }).isDisabled(), false);
  const capture = await open(context, 'popup', 'capture'); await capture.getByText('Getting ready…', { exact: true }).waitFor(); equal(await capture.getByText("This tab can't be shared", { exact: true }).count(), 1);
  const unsupported = await open(context, 'popup', 'unsupported'); await unsupported.getByText("This tab can't be shared. Open a regular web page.", { exact: true }).waitFor(); equal(await unsupported.getByRole('button', { name: 'Share this tab', exact: true }).isDisabled(), true);
  const guest = await open(context, 'popup', 'guest'); await guest.getByRole('button', { name: 'Open shared view', exact: true }).click(); equal(await guest.evaluate(() => uiMock.viewerOpens), 1);
  equal(await guest.getByLabel('Interaction mode', { exact: false }).count(), 0); await guest.getByRole('button', { name: 'Leave session', exact: true }).click(); await guest.getByRole('button', { name: 'Share my tab', exact: true }).waitFor();

  const viewer = await open(context, 'viewer', '', { width: 1365, height: 850 }); await viewer.getByRole('button', { name: 'Join session', exact: true }).waitFor();
  equal(await viewer.getByLabel('Share clipboard', { exact: false }).isChecked(), false); equal(await viewer.getByLabel('STUN servers', { exact: false }).count(), 0);
  await viewer.getByLabel('Connection code', { exact: true }).fill('not-a-code'); await viewer.getByLabel('Password', { exact: true }).fill('Example-42'); await viewer.getByRole('button', { name: 'Join session', exact: true }).click();
  await viewer.getByRole('alert').filter({ hasText: '32-character' }).waitFor(); equal(await viewer.getByLabel('Password', { exact: true }).inputValue(), ''); equal((await calls(viewer, 'ui.guest.start')).length, 0);
  await viewer.getByRole('button', { name: 'Dismiss error' }).click();
  await viewer.getByText('Advanced connection settings', { exact: true }).click(); await custom(viewer); await permission(viewer, 'delay');
  await viewer.getByRole('button', { name: 'Save', exact: true }).click(); await waitPermission(viewer); equal(await viewer.getByRole('button', { name: 'Join session', exact: true }).isDisabled(), true);
  equal(await viewer.getByLabel('Connection code', { exact: true }).isDisabled(), true); await resolvePermission(viewer, false); await viewer.getByRole('alert').waitFor(); equal((await calls(viewer, 'ui.settings.save')).length, 0);
  await viewer.getByRole('button', { name: 'Dismiss error' }).click(); await viewer.getByText('Advanced connection settings', { exact: true }).click();
  await viewer.getByLabel('Connection code', { exact: true }).fill('0123 4567 89AB CDEF 0123 4567 89AB CDEF'); await viewer.getByLabel('Password', { exact: true }).fill('Example-42');
  await permission(viewer, 'delay'); await viewer.getByRole('button', { name: 'Join session', exact: true }).click(); await waitPermission(viewer);
  await viewer.getByRole('button', { name: 'Cancel connection', exact: true }).click(); await resolvePermission(viewer, true);
  await viewer.getByLabel('Password', { exact: true }).waitFor(); equal(await viewer.getByLabel('Password', { exact: true }).inputValue(), ''); equal((await calls(viewer, 'ui.guest.start')).length, 0, 'Cancel prevents a delayed join');
  await permission(viewer, 'allow'); await viewer.getByLabel('Password', { exact: true }).fill('Example-42'); await viewer.getByRole('button', { name: 'Join session', exact: true }).click();
  await viewer.getByRole('button', { name: 'Cancel connection', exact: true }).waitFor(); equal((await calls(viewer, 'ui.guest.start'))[0].deviceId, code);
  await set(viewer, { role: 'guest', status: 'connected', tabs: [{ id: 1, title: 'Weekend plans', url: 'https://example.com/plans', active: true, supported: true, authorized: true }], activeTabId: 1 });
  await viewer.getByText('Preview mode', { exact: true }).waitFor(); equal(await viewer.getByText('Clipboard sharing off', { exact: true }).count(), 1);
  equal(await viewer.getByText('Waiting for the shared view to load.', { exact: true }).count(), 1, 'An approved tab waiting for video does not request permission again');
  await set(viewer, { tabs: [{ id: 1, title: 'Weekend plans', url: 'https://example.com/plans', active: true, supported: true, authorized: false }] });
  await viewer.getByText('The person sharing needs to allow this tab before you can see it.', { exact: true }).waitFor();
  equal(await viewer.getByText('Waiting for permission', { exact: false }).count(), 1);
  await set(viewer, { tabs: [{ id: 1, title: 'Weekend plans', url: 'https://example.com/plans', active: true, supported: true, authorized: true }] });
  ok(!/Direct P2P|39 ms|\b(host|guest|simulation)\b/i.test(await viewer.locator('body').innerText()), 'Viewer removes technical session labels');
  equal(await viewer.getByLabel('Remote keyboard input', { exact: true }).isDisabled(), true, 'Input waits for an actual video frame');
  await set(viewer, { controlMode: 'live', clipboardEnabled: true, remoteClipboardEnabled: true }); await viewer.getByText('Control mode', { exact: true }).waitFor(); equal(await viewer.getByText('Clipboard sharing on', { exact: true }).count(), 1);
  await set(viewer, { status: 'paused', paused: true, controlEnabled: false }); await viewer.getByRole('heading', { name: 'The session is paused.', exact: true }).waitFor(); equal(await viewer.getByText('View only', { exact: true }).count(), 1);
  await viewer.getByRole('button', { name: 'Leave session', exact: true }).click(); await viewer.getByLabel('Connection code', { exact: true }).waitFor();
  equal(await viewer.getByLabel('Connection code', { exact: true }).inputValue(), code); equal(await viewer.getByLabel('Password', { exact: true }).inputValue(), '');
  await viewer.setViewportSize({ width: 398, height: 790 }); ok(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Narrow join form has no horizontal overflow');
  const narrow = await open(context, 'viewer', 'guest', { width: 398, height: 790 }); await narrow.getByText('Preview mode', { exact: true }).waitFor();
  ok(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Narrow viewer has no horizontal overflow');
  await context.close();

  if (!checkOnly) {
    mkdirSync(output, { recursive: true }); const gallery = await browser.newContext(); await gallery.addInitScript(mockChrome, { manifest, official, code });
    const page = await open(gallery); await snapshot(page, 'popup-home'); await startForm(page); await snapshot(page, 'popup-share'); await page.close();
    const settingsPage = await open(gallery); await settings(settingsPage); await snapshot(settingsPage, 'settings-ghostpair'); await custom(settingsPage); await snapshot(settingsPage, 'settings-custom'); await snapshot(settingsPage, 'settings-custom-bottom', 'bottom'); await settingsPage.close();
    for (const scenario of ['host', 'empty', 'five', 'capture', 'unsupported', 'paused', 'guest']) {
      const page = await open(gallery, 'popup', scenario); await page.locator('.status').waitFor(); await snapshot(page, `popup-${scenario}`);
      if (scenario === 'host') {
        await snapshot(page, 'popup-host-controls', 'bottom');
        await feedback(page); await snapshot(page, 'popup-feedback-top'); await snapshot(page, 'popup-feedback-middle', 'middle');
        await keyboardFeedback(page); await snapshot(page, 'popup-feedback-focus', 'focus'); await snapshot(page, 'popup-feedback-bottom', 'bottom');
      }
      await page.close();
    }
    for (const scenario of ['', 'guest']) {
      const page = await open(gallery, 'viewer', scenario, { width: 1365, height: 850 }); await page.locator('.status').waitFor(); await snapshot(page, scenario ? 'viewer-active' : 'viewer-join');
      await page.setViewportSize({ width: 398, height: 790 }); await snapshot(page, scenario ? 'viewer-active-narrow' : 'viewer-join-narrow'); await page.close();
    }
    await gallery.close();
  }
  deepEqual(errors, [], 'No browser page errors');
  process.stdout.write(`UI QA: ${checks} assertions passed; ${screenshots} screenshots${checkOnly ? ' (check only)' : ` in ${output}`}\n`);
} finally { await browser?.close(); await server.close(); }
