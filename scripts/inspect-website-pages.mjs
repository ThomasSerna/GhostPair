import assert from 'node:assert/strict';
import { access, mkdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const viewports = [[1440, 1000, 'desktop'], [768, 1024], [390, 844, 'mobile'], [375, 812], [320, 812]];

function screenUrl(url, view, hash = '') {
  const target = new URL(url);
  target.searchParams.set('view', view);
  target.hash = hash;
  return target.href;
}

async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(dimensions.page <= dimensions.viewport, `${label}: horizontal overflow (${dimensions.page}px > ${dimensions.viewport}px)`);
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

async function assertLocalAssets(page, origin, docs, base) {
  const assets = await page.evaluate(() => [...document.querySelectorAll('[src], [href]')].flatMap(element => ['src', 'href']
    .filter(attribute => element.hasAttribute(attribute))
    .map(attribute => new URL(element.getAttribute(attribute), document.baseURI).href)));
  for (const asset of new Set(assets)) {
    const local = new URL(asset);
    if (local.origin !== origin) continue;
    assert.ok(local.pathname.startsWith(base), `Website screen asset escapes the GitHub Pages base: ${asset}`);
    const path = resolve(docs, decodeURIComponent(local.pathname.slice(base.length)) || 'index.html');
    assert.ok(path.startsWith(docs + sep), `Website screen asset escapes docs: ${asset}`);
    await access(path);
  }
  assert.ok(await page.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)), `Website screen contains a missing image: ${page.url()}`);
}

async function installCapabilityGuard(context) {
  // Guide copy actions may write a URL to the clipboard. The simulator must
  // never read the real clipboard, capture a tab, pair browsers, or ask consent.
  await context.addInitScript(() => {
    const calls = [];
    Object.defineProperty(window, '__websiteCapabilityCalls', { value: calls });
    const forbidden = name => function () {
      calls.push(name);
      throw new Error(`A website demonstration attempted ${name}`);
    };
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebSocket']) {
      if (name in window) Object.defineProperty(window, name, { configurable: true, value: forbidden(name) });
    }
    for (const name of ['getDisplayMedia', 'getUserMedia']) {
      if (navigator.mediaDevices && name in navigator.mediaDevices) {
        Object.defineProperty(navigator.mediaDevices, name, { configurable: true, value: forbidden(name) });
      }
    }
    for (const name of ['read', 'readText']) {
      if (navigator.clipboard && name in navigator.clipboard) {
        Object.defineProperty(navigator.clipboard, name, { configurable: true, value: forbidden(`clipboard.${name}`) });
      }
    }
    if (navigator.clipboard && 'writeText' in navigator.clipboard) {
      const write = navigator.clipboard.writeText.bind(navigator.clipboard);
      Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value(text) {
        if (new URLSearchParams(location.search).get('view') === 'explore') return forbidden('clipboard.writeText')();
        return write(text);
      } });
    }
    if ('Notification' in window) Object.defineProperty(Notification, 'requestPermission', { configurable: true, value: forbidden('Notification.requestPermission') });
  });
}

async function assertLocalDemonstration(page, requests, origin, label) {
  assert.deepEqual(await page.evaluate(() => window.__websiteCapabilityCalls), [], `${label}: no browser capture, clipboard read, permissions, or real connection`);
  assert.equal(await page.locator('.hero-scene, canvas, video').count(), 0, `${label}: the home media does not load on new screens`);
  for (const request of requests) {
    const target = new URL(request);
    assert.equal(target.origin, origin, `${label}: an interactive demonstration makes no external request (${request})`);
    assert.ok(!/\.(?:mp4|webm)(?:\?|$)/.test(request), `${label}: the home video is not downloaded`);
  }
}

async function inspectSkipAndMenu(page, width) {
  await page.keyboard.press('Tab');
  assert.ok(await page.locator('.skip-link').evaluate(element => element === document.activeElement), `${width}px: screen skip link is first in keyboard order`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'main');
  const nav = page.getByRole('navigation', { name: 'Main navigation', includeHidden: true });
  const toggle = page.locator('.menu-toggle');
  if (await toggle.isVisible()) {
    assert.equal(await nav.isVisible(), false, `${width}px: screen mobile navigation starts closed`);
    await toggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.ok(await nav.isVisible());
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.ok(await toggle.evaluate(element => element === document.activeElement), `${width}px: Escape returns screen menu focus`);
  } else {
    assert.ok(await nav.isVisible(), `${width}px: screen desktop navigation is visible`);
  }
}

async function navigateFromHeader(page, name) {
  const toggle = page.locator('.menu-toggle');
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true }).click();
  await settle(page);
  assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false', 'A destination closes the website navigation');
}

async function capture(page, output, view, name) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settle(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await settle(page);
  await page.screenshot({ path: resolve(output, `${view}-${name}.png`), fullPage: true });
  if (view === 'explore') await page.getByTestId('explore-lab').screenshot({ path: resolve(output, `${view}-${name}-lab.png`) });
}

async function waitForScreen(page, view) {
  await page.waitForURL(target => target.searchParams.get('view') === view);
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1, `${view}: one primary heading`);
  assert.equal(await page.locator('main#main').count(), 1, `${view}: one main landmark`);
  assert.equal(await page.getByRole('navigation', { name: 'Main navigation', includeHidden: true })
    .getByRole('link', { name: view === 'installation' ? 'Installation' : 'Explore', exact: true, includeHidden: true })
    .getAttribute('aria-current'), 'page', `${view}: navigation identifies the current screen`);
  await settle(page);
}

async function inspectRoutes(page, url, currentView, width) {
  const otherView = currentView === 'installation' ? 'explore' : 'installation';
  await navigateFromHeader(page, otherView === 'installation' ? 'Installation' : 'Explore');
  await waitForScreen(page, otherView);
  await noOverflow(page, `${width}px: route destination`);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await waitForScreen(page, currentView);
  await page.goForward({ waitUntil: 'domcontentloaded' });
  await waitForScreen(page, otherView);
  await page.locator('.site-header .brand').click();
  await page.getByRole('heading', { level: 1, name: 'Browse together.' }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('view'), false, 'Brand returns to the existing home screen');
  await page.waitForFunction(() => [...document.querySelectorAll('.hero-line')].every(element => !element.style.transform)
    && Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('.hero-art')).transform).a - 1) < .00001);
  for (const anchor of ['how-it-works', 'preview', 'install']) {
    const legacy = new URL(url);
    legacy.hash = anchor;
    await page.goto(legacy.href, { waitUntil: 'domcontentloaded' });
    await page.locator(`#${anchor}`).waitFor();
    assert.equal(await page.locator(`#${anchor}`).count(), 1, `Existing #${anchor} home deep link is preserved`);
    try {
      await page.waitForFunction(id => {
        const element = document.getElementById(id);
        const margin = parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
        const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
        const target = Math.min(Math.max(0, element.getBoundingClientRect().top + scrollY - margin - padding), document.documentElement.scrollHeight - innerHeight);
        const observation = window.__ghostpairAnchorScroll ??= { id, y: scrollY, since: performance.now() };
        if (observation.id !== id || observation.y !== scrollY || Math.abs(scrollY - target) >= 2) {
          observation.id = id;
          observation.y = scrollY;
          observation.since = performance.now();
        }
        return Math.abs(scrollY - target) < 2 && performance.now() - observation.since >= 120;
      }, anchor);
    } catch (error) {
      const state = await page.evaluate(id => ({ hash: location.hash, scroll: scrollY, viewport: innerHeight, bounds: document.getElementById(id)?.getBoundingClientRect().toJSON() }), anchor);
      throw new Error(`${width}px: home #${anchor} is outside the viewport: ${JSON.stringify(state)}`, { cause: error });
    }
  }
  await page.goto(screenUrl(url, 'unknown'), { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1, name: 'Browse together.' }).waitFor();
  await noOverflow(page, `${width}px: unknown screen falls back to home`);
}

async function assertStatus(scene, pattern, message) {
  assert.match((await scene.locator('[role="status"]').allTextContents()).join(' '), pattern, message);
}

async function inspectInstallation(page, width) {
  const install = page.locator('#install-extension .guide-scene');
  assert.ok(await install.getByRole('radio', { name: 'Chrome', exact: true }).isChecked(), 'The installation example starts with Chrome');
  assert.match(await install.locator('.guide-release-file').textContent(), /ghostpair-chrome-<version>\.zip/);
  await install.getByRole('radio', { name: 'Edge', exact: true }).check();
  assert.match(await install.locator('.guide-release-file').textContent(), /ghostpair-edge-<version>\.zip/, 'Browser choice selects the actual extension package pattern');
  await install.getByRole('button', { name: 'Practice choosing this ZIP' }).click();
  await install.getByRole('button', { name: 'Practice extracting the ZIP' }).click();
  assert.match(await install.locator('.guide-folder-block').textContent(), /manifest\.json/, 'The extracted folder contains the extension manifest');
  await install.getByRole('button', { name: 'Continue to extensions' }).click();
  const load = install.getByRole('button', { name: 'Load unpacked', exact: true });
  assert.ok(await load.isDisabled(), 'Developer mode gates loading the example extension');
  await install.getByRole('checkbox', { name: 'Developer mode', exact: true }).check();
  await load.click();
  await assertStatus(install, /folder containing manifest\.json/, 'Choosing the ZIP folder explains how to recover');
  await install.getByRole('combobox', { name: 'Folder to load', exact: true }).selectOption('manifest');
  await load.click();
  assert.ok(await install.getByRole('heading', { name: 'GhostPair is ready.', exact: true }).isVisible(), 'The installation walkthrough reaches a ready state');
  await install.getByRole('button', { name: 'Reset', exact: true }).click();
  await install.getByRole('radio', { name: 'Chrome', exact: true }).check();

  const settings = page.locator('#connection-settings .guide-scene');
  await settings.getByRole('radio', { name: /^Custom server/ }).check();
  const server = settings.getByRole('textbox', { name: 'Connection server', exact: true });
  const stun = settings.getByRole('textbox', { name: 'STUN servers', exact: true });
  const save = settings.getByRole('button', { name: 'Save', exact: true });
  await server.fill('https://user:secret@pair.example.org?private=1');
  await save.click();
  await assertStatus(settings, /Remove credentials, query parameters and fragments/, 'Custom settings reject embedded secrets');
  await server.fill('https://pair.example.org/');
  await stun.fill('turn:pair.example.org:3478');
  await save.click();
  await assertStatus(settings, /one to five STUN servers/, 'A TURN URL is not presented as supported STUN configuration');
  await stun.fill('stun:pair.example.org:3478\nstun:stun.l.google.com:19302');
  await save.click();
  await assertStatus(settings, /Saved in this example: https:\/\/pair\.example\.org\./, 'A valid configuration saves locally with the normalized endpoint');
  await settings.getByRole('button', { name: 'Try with a session active', exact: true }).click();
  assert.ok(await server.isDisabled() && await stun.isDisabled() && await save.isDisabled(), 'An active session prevents changing the connection settings');
  await settings.getByRole('button', { name: 'End example session', exact: true }).click();
  assert.equal(await server.isDisabled(), false, 'Ending the example session enables settings again');
  await settings.getByRole('button', { name: 'Reset', exact: true }).click();
  assert.ok(await settings.getByRole('radio', { name: /^GhostPair server/ }).isChecked(), 'Reset restores the production preset');

  const connection = page.locator('#first-session .guide-scene');
  await connection.getByRole('button', { name: 'Start sharing' }).click();
  await assertStatus(connection, /Confirm what you want to share/, 'A first session requires explicit host consent');
  const hostPassword = connection.getByLabel('Session password', { exact: true });
  await hostPassword.fill('short');
  await connection.getByRole('checkbox', { name: /^I allow the person/ }).check();
  await connection.getByRole('button', { name: 'Start sharing' }).click();
  await assertStatus(connection, /between 8 and 256 characters/, 'The guide reflects the session-password length requirement');
  await hostPassword.fill('Together-demo-42');
  await connection.getByRole('button', { name: 'Start sharing' }).click();
  await connection.getByRole('combobox', { name: 'Example active tab', exact: true }).selectOption('internal');
  await connection.getByRole('button', { name: 'Allow this example tab', exact: true }).click();
  await assertStatus(connection, /Internal browser pages cannot be shared/, 'Unsupported tabs cannot be authorized in the demonstration');
  await connection.getByRole('combobox', { name: 'Example active tab', exact: true }).selectOption('regular');
  await connection.getByRole('button', { name: 'Allow this example tab', exact: true }).click();
  await connection.getByRole('button', { name: 'Fill example invitation' }).click();
  const guestPassword = connection.getByLabel('Session password', { exact: true });
  await guestPassword.fill('Incorrect-demo-42');
  await connection.getByRole('button', { name: 'Join session', exact: true }).click();
  await assertStatus(connection, /password is incorrect/, 'An incorrect guest password produces a recoverable error');
  assert.equal(await guestPassword.inputValue(), '', 'The guest password clears after an unsuccessful attempt');
  await connection.getByRole('button', { name: 'Fill example invitation' }).click();
  await connection.getByRole('button', { name: 'Join session', exact: true }).click();
  assert.ok(await connection.getByRole('heading', { name: 'Connected, together.', exact: true }).isVisible());
  await assertStatus(connection, /starts in Preview changes/, 'A successful first session starts in preview mode');
  await connection.getByRole('button', { name: 'End example session', exact: true }).click();

  const hosting = page.locator('#self-hosting .guide-scene');
  const domain = hosting.getByRole('textbox', { name: 'Public domain', exact: true });
  await domain.fill('https://pair.example.org/path');
  await hosting.getByRole('button', { name: 'Continue to configuration' }).click();
  await assertStatus(hosting, /public hostname, without https:\/\//, 'The self-hosting guide rejects a URL where a DNS hostname is needed');
  await domain.fill('pair.example.org');
  await hosting.getByRole('button', { name: 'Continue to configuration' }).click();
  await assertStatus(hosting, /Confirm the example DNS record/, 'The walkthrough requires the DNS preparation step');
  await hosting.getByRole('checkbox', { name: 'Practice confirming DNS points to this VPS', exact: true }).check();
  await hosting.getByRole('button', { name: 'Continue to configuration' }).click();
  const environment = (await hosting.locator('.guide-command pre').allTextContents()).join('\n');
  assert.match(environment, /SIGNAL_DOMAIN=pair\.example\.org/);
  assert.match(environment, /VITE_SIGNALING_URL=https:\/\/pair\.example\.org/);
  assert.match(environment, /VITE_STUN_URLS=stun:pair\.example\.org:3478/, 'Generated configuration consistently uses the chosen public domain');
  assert.ok(await hosting.getByRole('button', { name: 'Continue to startup' }).isDisabled());
  await hosting.getByRole('checkbox', { name: 'Practice merging these entries without replacing existing values', exact: true }).check();
  await hosting.getByRole('button', { name: 'Continue to startup' }).click();
  assert.ok(await hosting.getByRole('button', { name: 'Practice starting services', exact: true }).isDisabled());
  await hosting.getByRole('checkbox', { name: 'Practice opening TCP 80/443 and UDP/TCP 3478 in the VPS firewall', exact: true }).check();
  await hosting.getByRole('button', { name: 'Practice starting services', exact: true }).click();
  assert.match((await hosting.locator('.guide-command pre').allTextContents()).join('\n'), /https:\/\/pair\.example\.org\/health[\s\S]*https:\/\/pair\.example\.org\/ready/);
  const network = hosting.getByRole('combobox', { name: 'Example network', exact: true });
  await network.selectOption('storage');
  await hosting.getByRole('button', { name: 'Run example checks', exact: true }).click();
  await assertStatus(hosting, /\/ready: 503/, 'Unavailable identity storage blocks readiness');
  assert.ok(await hosting.getByRole('button', { name: 'Continue to both browsers' }).isDisabled());
  await network.selectOption('restricted');
  await hosting.getByRole('button', { name: 'Run example checks', exact: true }).click();
  await assertStatus(hosting, /STUN is not a relay/, 'Healthy signaling does not imply a viable peer route');
  await network.selectOption('direct');
  await hosting.getByRole('button', { name: 'Run example checks', exact: true }).click();
  await hosting.getByRole('button', { name: 'Continue to both browsers' }).click();
  await hosting.getByRole('checkbox', { name: 'Host settings saved', exact: true }).check();
  assert.equal((await hosting.locator('[role="status"]').allTextContents()).some(text => text.includes('Both example browsers are configured')), false);
  await hosting.getByRole('checkbox', { name: 'Guest settings saved', exact: true }).check();
  await assertStatus(hosting, /Both example browsers are configured/, 'Both participants need the same self-hosted configuration');
  await hosting.getByRole('button', { name: 'Reset', exact: true }).click();

  const help = page.locator('#updates-help .guide-scene');
  assert.ok(await help.getByRole('button', { name: 'Reload host extension', exact: true }).isDisabled());
  await help.getByRole('button', { name: 'Practice replacing the files', exact: true }).click();
  await help.getByRole('button', { name: 'Reload host extension', exact: true }).click();
  await help.getByRole('button', { name: 'Reload guest extension', exact: true }).click();
  await assertStatus(help, /Reloading preserves saved settings and identities/, 'Updating the loaded folder preserves the saved installation');
  await help.getByRole('combobox', { name: 'Try a troubleshooting scenario', exact: true }).selectOption('network');
  assert.match(await help.textContent(), /no TURN relay or automatic reconnection/, 'Troubleshooting distinguishes pairing from video transport');
  await help.getByRole('button', { name: 'Check the server’s /health and /ready endpoints', exact: true }).click();
  await help.getByRole('button', { name: 'Try a network with a direct route and reconnect explicitly', exact: true }).click();
  await assertStatus(help, /End the failed attempt, then join again/);
  await help.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('navigation', { name: 'Installation chapters' }).locator('a[href="#self-hosting"]').click();
  await page.waitForURL(target => target.hash === '#self-hosting');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForScreen(page, 'installation');
  await page.waitForFunction(() => {
    const bounds = document.getElementById('self-hosting').getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < innerHeight;
  });
  await noOverflow(page, `${width}px: installation walkthroughs`);
}

async function perspective(page, side) {
  const control = page.locator('.ex-perspective-switch');
  if (await control.isVisible()) {
    const button = control.getByRole('button', { name: side === 'host' ? 'Host' : 'Guest', exact: true });
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  }
}

async function setSharedScroll(page, side, value) {
  await page.getByRole('slider', { name: `${side} shared page scroll`, exact: true }).evaluate((input, position) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(position));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await assertSharedScroll(page, side, value);
}

async function assertSharedScroll(page, side, value) {
  await page.waitForFunction(({ side, value }) => {
    const scroller = document.querySelector(`[data-testid="${side}-page-scroll"]`);
    return scroller?.clientHeight > 0 && Math.abs(scroller.scrollTop - (scroller.scrollHeight - scroller.clientHeight) * value / 100) <= 2;
  }, { side, value });
}

async function inspectExplore(page, width) {
  const host = page.getByTestId('host-view');
  const mode = page.getByTestId('interaction-mode');
  const name = page.getByTestId('guest-name');
  const hostName = page.getByTestId('host-name');
  const feedback = page.getByTestId('demo-message');
  assert.equal(await mode.inputValue(), 'preview', 'The local simulator starts in Preview changes');
  await name.fill('A temporary guest idea.');
  assert.equal(await hostName.getAttribute('data-original'), 'Alex', 'A preview preserves the host’s original field');
  assert.equal(await hostName.inputValue(), 'A temporary guest idea.', 'Both participants see the same preview');
  await page.waitForFunction(() => document.querySelector('[data-testid="guest-name"]').value === 'Alex');
  assert.equal(await hostName.inputValue(), 'Alex', 'An expired text preview restores the original value in both views');

  await perspective(page, 'host');
  const preferences = host.locator('.ex-feedback').first();
  await preferences.locator('summary').click();
  await preferences.getByRole('combobox', { name: 'Text preview lifetime', exact: true }).selectOption('persistent');
  await perspective(page, 'guest');
  await name.fill('A persistent suggestion.');
  assert.equal(await hostName.getAttribute('data-original'), 'Alex');
  await perspective(page, 'host');
  const editName = page.getByTestId('edit-preview-name');
  await editName.fill('A host suggestion.');
  assert.equal(await hostName.inputValue(), 'A host suggestion.', 'The host can edit a guest text preview');
  const editor = host.locator('.ex-preview-editor');
  await editor.getByRole('combobox', { name: 'Preview destination', exact: true }).selectOption('notes');
  await editor.locator('.ex-edit-row').filter({ has: editName }).getByRole('button', { name: 'Copy', exact: true }).click();
  assert.match(await page.getByTestId('guest-notes').inputValue(), /A host suggestion\./, 'Keyboard and touch controls can copy preview text into another field');
  assert.equal(await page.getByTestId('host-notes').getAttribute('data-original'), 'Find a quiet place by the water.', 'Copying preview text does not change the original destination');
  await perspective(page, 'guest');
  await page.getByTestId('guest-password').fill('A private example reminder');
  assert.equal(await page.getByTestId('host-password').getAttribute('type'), 'password', 'Password previews stay masked');
  await perspective(page, 'host');
  assert.equal(await editor.locator('.ex-edit-row').filter({ has: page.getByTestId('edit-preview-password') }).getByRole('button').count(), 0, 'Password preview text cannot be moved or copied');
  await mode.selectOption('full');
  assert.equal(await editName.count(), 0, 'Changing interaction mode clears uncommitted previews');
  assert.equal(await name.inputValue(), 'Alex');
  await perspective(page, 'guest');
  await name.fill('Taylor');
  await page.getByTestId('guest-notify').check();
  assert.equal(await hostName.getAttribute('data-original'), 'Taylor', 'Full control commits the guest edit to the original shared page');
  assert.ok(await page.getByTestId('host-notify').isChecked(), 'Full control changes the actual checkbox state');
  await page.getByTestId('guest-submit').click();
  assert.match(await page.getByTestId('host-plan-saved').textContent(), /Plan saved/, 'Full control submits the example form');
  await perspective(page, 'host');
  await mode.selectOption('preview');
  await perspective(page, 'guest');
  await page.getByTestId('guest-address').fill('https://example.ghostpair.test/notes');
  await page.getByTestId('guest-address').press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-testid="host-address"]').value === 'https://example.ghostpair.test/notes');
  assert.equal(await page.getByTestId('host-address').inputValue(), 'https://example.ghostpair.test/notes', 'Navigation changes the shared page even in Preview changes');
  assert.equal(await hostName.getAttribute('data-original'), 'Alex', 'Navigation loads the next example page’s real initial fields');

  await page.getByTestId('guest-new-tab').click();
  assert.ok(await page.getByTestId('guest-withheld').isVisible(), 'A guest-opened tab is withheld until the host approves it');
  await perspective(page, 'host');
  await page.getByTestId('share-active-tab').click();
  assert.equal(await page.getByTestId('guest-withheld').count(), 0, 'Host approval makes the active tab available');
  assert.match(await host.locator('.ex-controls-heading').textContent(), /2\/5 tabs approved/);
  if (width === 1440) {
    for (let approved = 2; approved < 5; approved += 1) {
      await page.getByTestId('guest-new-tab').click();
      await page.getByTestId('share-active-tab').click();
    }
    await page.getByTestId('guest-new-tab').click();
    await page.getByTestId('share-active-tab').click();
    assert.match(await feedback.textContent(), /Five tabs are already approved/, 'The sixth tab cannot bypass the approved-tab limit');
    assert.ok(await page.getByTestId('guest-withheld').isVisible());
    await host.locator('.ex-browser-tab').first().locator('button').first().click();
    await host.getByRole('button', { name: 'Stop sharing tab', exact: true }).click();
    await host.locator('.ex-browser-tab').last().locator('button').first().click();
    await page.getByTestId('share-active-tab').click();
    assert.equal(await page.getByTestId('guest-withheld').count(), 0, 'Releasing an approved tab makes room for another');
  }
  await perspective(page, 'guest');
  await setSharedScroll(page, 'guest', 75);
  await perspective(page, 'host');
  await assertSharedScroll(page, 'host', 75);
  await setSharedScroll(page, 'host', 30);
  await perspective(page, 'guest');
  await assertSharedScroll(page, 'guest', 30);
  await perspective(page, 'host');
  await page.getByTestId('pause-session').click();
  assert.match(await page.getByTestId('guest-withheld').textContent(), /A moment to pause/, 'Pause suspends the guest’s shared view');
  assert.ok(await page.getByTestId('guest-new-tab').isDisabled(), 'Guest tab management stops while sharing is paused');
  await setSharedScroll(page, 'host', 85);
  await page.getByTestId('pause-session').click();
  assert.equal(await page.getByTestId('guest-withheld').count(), 0, 'Resume restores the active approved view');
  await perspective(page, 'guest');
  await assertSharedScroll(page, 'guest', 85);
  await perspective(page, 'host');
  await page.getByTestId('allow-control').uncheck();
  assert.ok(await name.isDisabled(), 'Withdrawing page interaction disables guest input');
  assert.equal(await page.getByTestId('guest-withheld').count(), 0, 'Withdrawing control retains the view of the approved tab');
  await page.getByTestId('allow-control').check();
  assert.equal(await name.isDisabled(), false);
  await host.getByRole('button', { name: 'Stop sharing tab', exact: true }).click();
  assert.equal(await page.getByTestId('guest-withheld').count(), 1, 'Releasing the active tab withdraws its guest view');
  await setSharedScroll(page, 'host', 35);
  await page.getByTestId('share-active-tab').click();
  await perspective(page, 'guest');
  await assertSharedScroll(page, 'guest', 35);
  await perspective(page, 'host');
  await host.getByRole('button', { name: 'End session', exact: true }).click();
  assert.match(await page.getByTestId('guest-withheld').textContent(), /session has ended/);
  assert.ok(await mode.isDisabled(), 'An ended session cannot accept page-control changes');
  await page.getByTestId('reset-demo').click();
  assert.equal(await mode.inputValue(), 'preview');
  assert.equal(await hostName.getAttribute('data-original'), 'Alex');
  assert.match(await host.locator('.ex-controls-heading').textContent(), /1\/5 tabs approved/, 'Reset returns to one connected, approved example tab');

  const hostBuffer = page.getByTestId('host-buffer').locator('p');
  const guestBuffer = page.getByTestId('guest-buffer').locator('p');
  const originalGuestBuffer = await guestBuffer.textContent();
  await page.getByTestId('host-clipboard').check();
  await page.getByRole('textbox', { name: 'host next example clipboard text', exact: true }).fill('A host-only example.');
  await page.getByTestId('host-copy').click();
  assert.equal(await guestBuffer.textContent(), originalGuestBuffer, 'One clipboard opt-in does not share text');
  await page.getByTestId('guest-clipboard').check();
  assert.equal(await guestBuffer.textContent(), originalGuestBuffer, 'Enabling both clipboards does not send old contents');
  await page.getByRole('textbox', { name: 'host next example clipboard text', exact: true }).fill('New shared example text.');
  await page.getByTestId('host-copy').click();
  assert.equal(await hostBuffer.textContent(), 'New shared example text.');
  assert.equal(await guestBuffer.textContent(), 'New shared example text.', 'New local clipboard text synchronizes after both people opt in');
  await perspective(page, 'host');
  await page.getByTestId('pause-session').click();
  await page.getByRole('textbox', { name: 'host next example clipboard text', exact: true }).fill('A paused local copy.');
  await page.getByTestId('host-copy').click();
  assert.equal(await hostBuffer.textContent(), 'A paused local copy.');
  assert.equal(await guestBuffer.textContent(), 'New shared example text.', 'Pause also suspends clipboard synchronization');
  await page.getByTestId('pause-session').click();
  await page.getByRole('textbox', { name: 'guest next example clipboard text', exact: true }).fill('A new guest copy.');
  await page.getByTestId('guest-copy').click();
  assert.equal(await hostBuffer.textContent(), 'A new guest copy.', 'Clipboard synchronization works in both directions');
  await page.getByTestId('guest-clipboard').uncheck();
  await page.getByRole('textbox', { name: 'host next example clipboard text', exact: true }).fill('A private host copy.');
  await page.getByTestId('host-copy').click();
  assert.equal(await guestBuffer.textContent(), 'A new guest copy.', 'Either participant can withdraw clipboard sharing');
  await page.getByTestId('reset-demo').click();
  assert.equal(await page.getByTestId('host-clipboard').isChecked(), false);
  assert.equal(await page.getByTestId('guest-clipboard').isChecked(), false);

  await page.locator('.ex-chapter-nav').getByRole('button', { name: '01 / Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Share this tab', exact: true }).click();
  assert.match(await feedback.textContent(), /Confirm what you want to share/, 'The guided lab also requires host consent');
  await page.getByTestId('share-consent').check();
  await page.getByRole('button', { name: 'Share this tab', exact: true }).click();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  assert.match(await feedback.textContent(), /Capture permission was declined/, 'The simulated capture request can be declined');
  await page.getByRole('button', { name: 'Share this tab', exact: true }).click();
  await page.getByRole('button', { name: 'Allow example capture', exact: true }).click();
  await page.getByTestId('join-password').fill('An incorrect example password');
  await page.getByRole('button', { name: 'Join example session' }).click();
  assert.match(await feedback.textContent(), /password does not match/, 'The guided session checks the example password');
  await page.getByTestId('join-password').fill(await page.locator('.ex-waiting strong').textContent());
  await page.getByRole('button', { name: 'Join example session' }).click();
  assert.equal(await page.getByTestId('interaction-mode').inputValue(), 'preview', 'Joining a new guided session defaults to Preview changes');
  await page.locator('.ex-chapter-nav').getByRole('button', { name: '07 / Host controls', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForScreen(page, 'explore');
  assert.ok(await page.locator('.ex-chapter-nav').getByRole('button', { name: '07 / Host controls', exact: true }).getAttribute('aria-pressed') === 'true', 'Explore chapter deep links survive a refresh');
  await page.locator('.ex-chapter-nav').getByRole('button', { name: 'Free exploration', exact: true }).click();
  await page.getByTestId('reset-demo').click();
  await perspective(page, 'guest');
  await noOverflow(page, `${width}px: complete local simulator flows`);
}

export async function inspectWebsitePages({ browser, url, origin, docs, output, screenshots }) {
  const base = new URL(url).pathname;
  if (screenshots) await mkdir(output, { recursive: true });
  for (const [width, height, name] of viewports) {
    for (const view of ['installation', 'explore']) {
      const errors = [];
      const requests = new Set();
      const serviceRequests = [];
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'no-preference', hasTouch: width <= 390, isMobile: width <= 390 });
      await installCapabilityGuard(context);
      await context.route('**/*', route => {
        const request = route.request();
        if (new URL(request.url()).origin !== origin) return route.abort();
        return route.continue();
      });
      context.on('request', request => {
        requests.add(request.url());
        if (['xhr', 'fetch'].includes(request.resourceType())) serviceRequests.push(request.url());
      });
      context.on('response', response => {
        if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
      });
      context.on('page', page => {
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        await page.goto(screenUrl(url, view), { waitUntil: 'domcontentloaded' });
        await waitForScreen(page, view);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForScreen(page, view);
        await noOverflow(page, `${width}px: ${view} direct load and refresh`);
        await inspectSkipAndMenu(page, width);
        if (view === 'installation') await inspectInstallation(page, width);
        else await inspectExplore(page, width);
        await assertLocalAssets(page, origin, docs, base);
        await noOverflow(page, `${width}px: ${view} completed interactions`);
        await assertLocalDemonstration(page, requests, origin, `${width}px: ${view}`);
        assert.deepEqual(serviceRequests, [], `${view}: examples do not call a backend or signaling service`);
        assert.deepEqual(errors, [], `${width}px: ${view} browser and resource errors`);
        if (screenshots && name) await capture(page, output, view, name);
        if (view === 'installation') await inspectRoutes(page, url, view, width);
        assert.deepEqual(errors, [], `${width}px: ${view} navigation errors`);
      } finally {
        await context.close();
      }
    }
  }
}
