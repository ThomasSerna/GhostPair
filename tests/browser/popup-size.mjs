import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from '../../apps/signaling/dist/server.js';
import { artifactRoot, closeBrowser, launchExtension, poll, removeTestArtifact } from './helpers.mjs';

// Unlike the mocked UI and session suites, this opens the actual toolbar action.
// Never set a viewport or resize the popup: Chromium must size it from its CSS.
// The native popup needs a monitor's full work area. Headless Chromium limits
// action popups to its 600px virtual screen and adds an unrelated outer scrollbar.
process.env.GHOSTPAIR_HEADED ??= '1';
const recordBug = process.argv.includes('--record-bug');
const names = process.argv.slice(2).filter(value => !value.startsWith('--'));
const results = [];
await mkdir(artifactRoot, { recursive: true });
const extension = await mkdtemp(resolve(artifactRoot, 'popup-size-extension-'));
await cp(resolve('dist/extension'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
// Grant only this disposable copy, so native permission dialogs do not obscure
// the popup size test. Session permission-denial behavior has a separate suite.
manifest.host_permissions = ['http://*/*', 'https://*/*'];
await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
const fixture = httpServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><title>Shared popup fixture</title><h1>Shared popup fixture</h1>');
});
await new Promise(done => fixture.listen(0, '127.0.0.1', done));
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`;

async function geometry(page) {
  return page.evaluate(() => {
    const box = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, html: box('html'), body: box('body'), root: box('#root'), popup: box('.popup'), panel: box('.session-panel'), footer: box('.session-footer') };
  });
}

async function attachPopup(browser) {
  // Toolbar popups are `other` targets, deliberately excluded from Playwright's
  // tab inventory. Attach through public CDP rather than opening popup.html in
  // a tab, which would conceal native auto-size regressions.
  const target = await poll(async () => {
    const { targetInfos } = await browser.cdp.send('Target.getTargets');
    return targetInfos.find(info => info.url === `chrome-extension://${browser.id}/popup.html`) ?? targetInfos.find(info => info.type === 'other' && info.url === '');
  }, 'native toolbar popup target');
  const { sessionId } = await browser.cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let commandId = 0;
  const pending = new Map();
  const listener = event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (!message.id) return;
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    if (message.error) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
  };
  browser.cdp.on('Target.receivedMessageFromTarget', listener);
  async function send(method, params = {}) {
    const id = ++commandId;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Popup CDP command timed out: ${method}`)); }, 15000);
      pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    });
    try { await browser.cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }); }
    catch (error) { pending.get(id)?.reject(error); pending.delete(id); }
    return response;
  }
  const popup = {
    async evaluate(fn, argument) {
      const result = await send('Runtime.evaluate', { expression: `(${fn.toString()})(${JSON.stringify(argument) ?? ''})`, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
      return result.result?.value;
    },
    async screenshot({ path }) { const { data } = await send('Page.captureScreenshot'); await writeFile(path, Buffer.from(data, 'base64')); },
    async close() { browser.cdp.off('Target.receivedMessageFromTarget', listener); await browser.cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined); },
    async scroll(selector) {
      await popup.evaluate(selector => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Popup element missing: ${selector}`);
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }, selector);
      await popup.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    },
    async click(selector) {
      await popup.scroll(selector);
      const point = await popup.evaluate(selector => {
        const element = document.querySelector(selector);
        if (element.disabled) throw new Error(`Popup element disabled: ${selector}`);
        const rect = element.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, selector);
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
      await popup.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    },
    async fill(selector, value) { await popup.click(selector); await send('Input.insertText', { text: value }); },
  };
  return popup;
}

async function capture(page, name) {
  const dimensions = await geometry(page);
  await page.screenshot({ path: resolve(artifactRoot, `popup-native-${name}.png`), animations: 'disabled' });
  return dimensions;
}

async function checkSize(page, name, label) {
  try { await poll(async () => (await geometry(page)).viewport.width === 398, `${label}: native width`, 5000); }
  catch (error) { console.error(JSON.stringify({ browser: name, label, dimensions: await capture(page, `${name}-${label}-failed`) })); throw error; }
  const dimensions = await capture(page, `${name}-${label}`);
  assert.equal(dimensions.viewport.width, 398, `${label}: toolbar popup width`);
  assert.equal(dimensions.popup.width, 398, `${label}: popup content width`);
  assert.ok(dimensions.viewport.height >= 420 && dimensions.viewport.height <= 600, `${label}: toolbar popup height ${dimensions.viewport.height}`);
  assert.ok(dimensions.html.scrollHeight <= dimensions.viewport.height + 1, `${label}: scrolling must stay inside popup content`);
  for (const [element, box] of Object.entries(dimensions)) {
    if (element === 'viewport' || !box) continue;
    assert.ok(box.scrollWidth <= box.clientWidth, `${label}: ${element} has horizontal overflow ${JSON.stringify(box)}`);
  }
  if (dimensions.panel && dimensions.footer) {
    assert.ok(dimensions.panel.bottom <= dimensions.footer.top + 1, `${label}: session footer overlaps scrolling content`);
    assert.ok(dimensions.footer.bottom <= dimensions.viewport.height + 1, `${label}: session footer is outside native viewport`);
  }
  return { label, ...dimensions };
}

async function checkFocusVisible(popup, selector, label) {
  await popup.scroll(selector);
  const focused = await popup.evaluate(selector => {
    const element = document.querySelector(selector); element.focus();
    const rect = element.getBoundingClientRect(), panel = document.querySelector('.session-panel')?.getBoundingClientRect();
    return { focused: document.activeElement === element, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, boundaryTop: panel?.top ?? 0, boundaryBottom: panel?.bottom ?? innerHeight, width: innerWidth };
  }, selector);
  assert.ok(focused.focused, `${label}: control receives focus`);
  assert.ok(focused.top >= focused.boundaryTop && focused.bottom <= focused.boundaryBottom, `${label}: focused control is vertically visible ${JSON.stringify(focused)}`);
  assert.ok(focused.left >= 0 && focused.right <= focused.width, `${label}: focused control is horizontally visible`);
}

async function call(page, type, fields = {}) {
  const reply = await page.evaluate(({ type, fields }) => chrome.runtime.sendMessage({ target: 'background', type, ...fields }), { type, fields });
  assert.ok(reply?.ok, `${type}: ${reply?.error}`);
  return reply.state;
}

try {
  for (const name of names.length ? names : ['chrome', 'edge']) {
    let browser, signal, popup;
    try {
      browser = await launchExtension(name, extension, { nativeVisibility: true });
      const tab = await browser.context.newPage(); await tab.goto(fixtureUrl); await tab.bringToFront();
      const { targetInfos } = await browser.cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
      const target = targetInfos.find(info => info.url === fixtureUrl + '/');
      assert.ok(target, 'fixture tab target');
      await browser.cdp.send('Extensions.triggerAction', { id: browser.id, targetId: target.targetId });
      popup = await attachPopup(browser);
      await poll(() => popup.evaluate(() => location.href).then(url => url === `chrome-extension://${browser.id}/popup.html`), 'toolbar target loads extension popup');
      await poll(() => popup.evaluate(() => !!document.querySelector('.session-choices button:not(:disabled)')), 'popup UI ready');
      if (recordBug) {
        const dimensions = await capture(popup, `${name}-before-fix`);
        results.push({ browser: browser.version, dimensions });
        console.log(JSON.stringify(results.at(-1)));
        continue;
      }
      const layouts = [await checkSize(popup, name, 'home')];
      await popup.click('.session-choices .primary');
      layouts.push(await checkSize(popup, name, 'share'));
      await popup.click('.back-button');
      await popup.click('[aria-label="Open settings"]');
      await popup.click('.server-option input[value="custom"]');
      layouts.push(await checkSize(popup, name, 'custom'));
      await popup.scroll('.connection-settings button[type="submit"]');
      await checkFocusVisible(popup, '.connection-settings button[type="submit"]', 'custom Save');
      layouts.push(await checkSize(popup, name, 'custom-save'));
      signal = createServer({ databasePath: ':memory:', port: 0 });
      const address = await signal.listen(0);
      await call(popup, 'ui.settings.save', { settings: { signalingUrl: `http://127.0.0.1:${address.port}`, stunUrls: ['stun:stun.l.google.com:19302'] } });
      await popup.click('[aria-label="Close settings"]');
      await popup.click('.session-choices .primary');
      await popup.fill('input[type="password"]', 'Eight-42');
      await popup.click('.consent input');
      await popup.click('.share-setup button[type="submit"]');
      await poll(async () => (await call(popup, 'ui.status')).status === 'waiting', 'real sharing session', 30000);
      layouts.push(await checkSize(popup, name, 'host'));
      await popup.click('.session-panel .advanced-options>summary');
      await popup.scroll('.interaction-feedback .check');
      layouts.push(await checkSize(popup, name, 'host-feedback'));
      await popup.scroll('.interaction-feedback>.secondary');
      await checkFocusVisible(popup, '.interaction-feedback>.secondary', 'Clear previews');
      layouts.push(await checkSize(popup, name, 'host-feedback-bottom'));
      const footerVisible = await popup.evaluate(() => {
        const button = document.querySelector('.session-actions .danger'); button.focus();
        const rect = button.getBoundingClientRect(); return document.activeElement === button && rect.top >= 0 && rect.bottom <= innerHeight;
      });
      assert.ok(footerVisible, 'End session stays visible and focusable with expanded feedback');
      await popup.click('.session-actions .danger');
      results.push({ browser: browser.version, nativeToolbarPopup: true, layouts });
      console.log(JSON.stringify({ browser: browser.version, nativeToolbarPopup: true, layouts: layouts.map(({ label, viewport }) => ({ label, ...viewport })), horizontalOverflow: false, focusedControlsVisible: true }));
    } finally {
      await popup?.close();
      await closeBrowser(browser);
      if (signal) await signal.close();
    }
  }
  await writeFile(resolve(artifactRoot, recordBug ? 'popup-native-before-fix.json' : 'popup-native-size.json'), JSON.stringify(results, null, 2));
} finally {
  await new Promise(done => fixture.close(done));
  await removeTestArtifact(extension);
}
