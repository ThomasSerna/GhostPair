import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
import { createServer } from '../../apps/signaling/dist/server.js';
import { artifactRoot, authorizeTab, callBackground as call, closeBrowser, copyTestExtension, launchExtension, poll, removeTestArtifact } from './helpers.mjs';
import { startStun } from './stun.mjs';

// Build the actual 0.6.6 sources, including its protocol package, without changing the current checkout.
const legacyCommit = '87c845ca88118d127b431cb12930122e2c92cdeb';
await mkdir(artifactRoot, { recursive: true });
const snapshot = await mkdtemp(resolve(artifactRoot, 'compatibility-legacy-'));
const extensions = [];
let stun;
const fixture = createHttpServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><meta charset="utf-8"><title>Compatibility fixture</title><style>body{margin:40px;font:24px sans-serif}button,input{display:block;font:inherit;margin:24px 0;padding:12px}</style><h1>GhostPair compatibility</h1><button id="target" onclick="count.textContent=String(++window.clicks)">Click target</button><output id="count">0</output><input id="text"><p id="clock"></p><script>window.clicks=0;setInterval(()=>clock.textContent=String(Date.now()),100)</script>');
});
const state = page => call(page, 'ui.status');
const waitState = (page, predicate, label) => poll(async () => {
  const current = await state(page);
  if (current.status === 'error' && !predicate(current)) throw new Error(`${label}: ${current.error ?? current.notification?.message ?? JSON.stringify(current)}`);
  return predicate(current) ? current : false;
}, label, 30000);
const results = [];
let verifiedSettings = false;

async function enableCompatibility(browser, settings) {
  const popup = await browser.context.newPage();
  try {
    await popup.goto(`chrome-extension://${browser.id}/popup.html`);
    await call(popup, 'ui.settings.save', { settings });
    await call(popup, 'ui.language.set', { preference: 'en' });
    await popup.getByRole('button', { name: 'Open settings', exact: true }).click();
    const checkbox = popup.getByRole('checkbox', { name: /Connect with GhostPair 0\.6\.6/ });
    assert.equal(await checkbox.isChecked(), false, 'compatibility is opt-in');
    await checkbox.check();
    await popup.getByRole('button', { name: 'Save', exact: true }).click();
    await waitState(popup, s => s.settings.legacyCompatibility === true, 'compatibility saved');
    await popup.reload();
    await popup.getByRole('button', { name: 'Open settings', exact: true }).click();
    assert.equal(await checkbox.isChecked(), true, 'compatibility survives reopening');
    await popup.setViewportSize({ width: 398, height: 1000 });
    for (const language of ['en', 'es']) {
      await call(popup, 'ui.language.set', { preference: language });
      await popup.waitForFunction(language => document.documentElement.lang === language, language);
      const label = language === 'es' ? /Conectar con GhostPair 0\.6\.6/ : /Connect with GhostPair 0\.6\.6/;
      assert.equal(await popup.getByRole('checkbox', { name: label }).isChecked(), true);
      assert.ok(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${language} connection settings fit the shipped 398px popup`);
      await popup.getByRole('checkbox', { name: label }).scrollIntoViewIfNeeded();
      await popup.locator('.connection-settings button[type="submit"]').scrollIntoViewIfNeeded();
      await popup.screenshot({ path: resolve(artifactRoot, `compatibility-settings-${language}.png`), fullPage: true });
    }
    await call(popup, 'ui.language.set', { preference: 'en' });
  } finally { await popup.close(); }
}

async function videoReady(viewer) {
  await poll(() => viewer.locator('video').evaluate(video => video.readyState >= 2 && video.videoWidth > 0).catch(() => false), 'decoded shared video', 30000);
}

async function clickRemote(source, viewer, selector) {
  await viewer.bringToFront();
  await poll(() => viewer.evaluate(() => !document.hidden), 'visible guest viewer');
  await videoReady(viewer);
  const point = await source.locator(selector).evaluate(element => {
    const box = element.getBoundingClientRect();
    return { x: (box.x + box.width / 2) / innerWidth, y: (box.y + box.height / 2) / innerHeight };
  });
  const video = await viewer.locator('video').boundingBox();
  assert.ok(video);
  await viewer.mouse.click(video.x + point.x * video.width, video.y + point.y * video.height);
}

try {
  const archive = resolve(snapshot, 'legacy.tar');
  execFileSync('git', ['archive', '--format=tar', '--output', archive, legacyCommit, 'apps/extension', 'packages/protocol', 'tsconfig.base.json'], { windowsHide: true });
  execFileSync('tar', ['-xf', archive, '-C', snapshot], { windowsHide: true });
  const legacyRoot = resolve(snapshot, 'apps/extension');
  const legacyProtocol = resolve(snapshot, 'packages/protocol/src/index.ts');
  assert.match(await readFile(legacyProtocol, 'utf8'), /export const PROTOCOL_VERSION = 4;/);
  await build({
    root: legacyRoot,
    configFile: resolve(legacyRoot, 'vite.config.ts'),
    resolve: { alias: { '@ghostpair/protocol': legacyProtocol } },
    build: { outDir: resolve(snapshot, 'built-extension') },
  });
  const legacy = await copyTestExtension('compatibility-old-', resolve(snapshot, 'built-extension'));
  extensions.push(legacy);
  const current = await copyTestExtension('compatibility-new-');
  extensions.push(current);
  stun = await startStun();
  await new Promise(done => fixture.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${fixture.address().port}`;
  for (const browserName of process.argv.slice(2).length ? process.argv.slice(2) : ['chrome']) {
    for (const [hostVersion, guestVersion] of [['0.6.6', '0.7.0'], ['0.7.0', '0.6.6'], ['0.7.0', '0.7.0'], ['0.6.6', '0.6.6']]) {
      let host, guest, signal;
      const pair = `${hostVersion}-host-${guestVersion}-guest`;
      try {
        host = await launchExtension(browserName, hostVersion === '0.6.6' ? legacy : current);
        guest = await launchExtension(browserName, guestVersion === '0.6.6' ? legacy : current, { nativeVisibility: true });
        const errors = [];
        for (const browser of [host, guest]) browser.context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        signal = createServer({ databasePath: ':memory:', port: 0 });
        const address = await signal.listen(0);
        const settings = { signalingUrl: `http://127.0.0.1:${address.port}`, stunUrls: [stun.url] };
        const mixed = hostVersion !== guestVersion;
        const hostUi = await host.context.newPage();
        await hostUi.goto(`chrome-extension://${host.id}/popup.html`);
        const viewer = await guest.context.newPage();
        await viewer.goto(`chrome-extension://${guest.id}/viewer.html`);
        for (const [browser, page, version] of [[host, hostUi, hostVersion], [guest, viewer, guestVersion]]) {
          assert.equal(await browser.worker.evaluate(() => chrome.runtime.getManifest().version), version);
          if (mixed && version === '0.7.0' && !verifiedSettings) {
            await enableCompatibility(browser, settings);
            verifiedSettings = true;
          } else await call(page, 'ui.settings.save', { settings: mixed && version === '0.7.0' ? { ...settings, legacyCompatibility: true } : settings });
          assert.equal((await state(page)).settings.legacyCompatibility === true, mixed && version === '0.7.0');
        }
        const source = await host.context.newPage();
        await source.goto(`${url}/${pair}`);
        await authorizeTab(host, source);
        await call(hostUi, 'ui.host.start', { password: 'Eight-42', clipboard: false });
        const waiting = await waitState(hostUi, s => s.status === 'waiting', 'host waiting');
        await viewer.bringToFront();
        await viewer.getByLabel('Connection code', { exact: true }).fill(waiting.deviceId);
        await viewer.getByLabel('Password', { exact: true }).fill('Eight-42');
        await viewer.getByRole('button', { name: 'Join session', exact: true }).click();
        await waitState(viewer, s => s.status === 'connected', 'guest connected');
        await waitState(hostUi, s => s.status === 'connected', 'host connected');
        await videoReady(viewer);
        await call(hostUi, 'ui.control.mode', { mode: 'live' });
        await waitState(viewer, s => s.controlMode === 'live', 'guest receives full control');
        await clickRemote(source, viewer, '#target');
        await poll(() => source.evaluate(() => window.clicks === 1), 'remote click changes source');
        await clickRemote(source, viewer, '#text');
        await viewer.keyboard.insertText('Compatibility á🙂');
        await poll(() => source.locator('#text').inputValue().then(value => value === 'Compatibility á🙂'), 'remote Unicode input changes source');
        await viewer.screenshot({ path: resolve(artifactRoot, `compatibility-${browserName}-${pair}.png`) });
        await call(hostUi, 'ui.stop');
        await waitState(viewer, s => s.status === 'idle', 'guest session ends');
        assert.equal(signal.stats.activeRooms, 0, 'session cleanup releases the room');
        assert.deepEqual(errors, []);
        const result = { browser: browserName, hostVersion, guestVersion, nativeVideo: true, remoteClick: true, remoteUnicode: true, cleanup: true };
        results.push(result);
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } finally { await signal?.close(); await closeBrowser(guest); await closeBrowser(host); }
    }
  }
  await writeFile(resolve(artifactRoot, 'compatibility-results.json'), JSON.stringify(results, null, 2));
} finally {
  await stun?.close();
  if (fixture.listening) await new Promise(done => fixture.close(done));
  for (const extension of extensions.reverse()) await removeTestArtifact(extension);
  await removeTestArtifact(snapshot);
}
