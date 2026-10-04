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
  const headerLinks = page.getByRole('navigation', { name: 'Main navigation', includeHidden: true }).getByRole('link', { includeHidden: true });
  assert.deepEqual(await headerLinks.allTextContents(), ['Home', 'Installation', 'Explore'], `${view}: exactly three header destinations`);
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

async function inspectInstallation(page, width) {
  const install = page.locator('#install-extension');
  assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Install GhostPair');
  assert.equal(await page.locator('.guide-scene').count(), 0, 'Installation has no practice scenes');
  assert.equal(await page.locator('main input').count(), 2, 'Only the browser selector remains in the guide');
  const steps = install.locator('ol.guide-install-steps > li');
  assert.equal(await steps.count(), 5, 'The installation process is numbered');
  for (const step of await steps.all()) assert.ok(await step.isVisible(), 'All installation steps are readable without completing an exercise');
  for (const pattern of [/permanent/i, /Developer mode/, /Load unpacked/, /manifest\.json/]) assert.match(await install.textContent(), pattern);
  assert.match(await page.locator('#connection-settings').textContent(), /ghostpair\.onrender\.com/, 'The download uses the production server');

  const chrome = install.getByRole('radio', { name: 'Chrome', exact: true });
  const edge = install.getByRole('radio', { name: 'Edge', exact: true });
  assert.ok(await chrome.isChecked(), 'Installation defaults to Chrome');
  assert.match(await install.locator('.guide-release-file').textContent(), /ghostpair-chrome-<version>\.zip/);
  assert.equal(await install.locator('.guide-browser-address > code').textContent(), 'chrome://extensions');
  await edge.focus();
  await page.keyboard.press('Space');
  assert.ok(await edge.isChecked(), 'The browser selector supports the keyboard');
  assert.match(await install.locator('.guide-release-file').textContent(), /ghostpair-edge-<version>\.zip/);
  assert.equal(await install.locator('.guide-browser-address > code').textContent(), 'edge://extensions');

  // Only explicit guide copy actions can write; rejected copying still exposes selectable text.
  await page.evaluate(() => {
    window.__websiteOriginalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator.clipboard, 'writeText');
    window.__websiteWrites = [];
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, writable: true, value: async value => { window.__websiteWrites.push(value); } });
  });
  try {
    const copy = install.getByRole('button', { name: 'Copy address', exact: true });
    const copyRegion = copy.locator('..');
    await copy.click();
    assert.deepEqual(await page.evaluate(() => window.__websiteWrites), ['edge://extensions']);
    await copyRegion.getByRole('status').filter({ hasText: 'Copied' }).waitFor();
    assert.equal(await copy.getAttribute('aria-label'), 'Copy address', 'Copy feedback preserves its accessible name');
    await chrome.check();
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard unavailable for this test'); }; });
    await copy.click();
    const manual = install.getByRole('textbox', { name: 'Copy address manually', exact: true });
    await manual.waitFor();
    assert.equal(await manual.inputValue(), 'chrome://extensions', 'Manual copying uses the selected browser address');
    assert.ok(await manual.evaluate(element => element.readOnly));
    await manual.focus();
    assert.ok(await manual.evaluate(element => element.selectionStart === 0 && element.selectionEnd === element.value.length), 'Manual copy selects the complete value');
    assert.match(await copyRegion.textContent(), /Copy unavailable\. Select the text below\./);
    await page.evaluate(() => { navigator.clipboard.writeText = async value => { window.__websiteWrites.push(value); }; });

    const advanced = page.locator('details#custom-server-settings, details#self-hosting, details#troubleshooting');
    assert.equal(await advanced.count(), 3, 'Advanced instructions use native disclosures');
    for (const details of await advanced.all()) assert.equal(await details.evaluate(element => element.open), false, 'Advanced instructions start collapsed');
    for (const pattern of [/Host/, /Guest/, /Connection code/, /Session password/, /Preview changes/]) assert.match(await page.locator('#first-session').textContent(), pattern);
    assert.ok(await page.locator('#updates-help').isVisible(), 'Update instructions stay visible');
    assert.match(await page.locator('#updates-help').textContent(), /Reload/);

    await page.getByRole('navigation', { name: 'Installation chapters' }).locator('a[href="#self-hosting"]').click();
    await page.waitForURL(target => target.hash === '#self-hosting');
    const hosting = page.locator('details#self-hosting');
    await page.waitForFunction(() => document.getElementById('self-hosting').open);
    for (const pattern of [/Docker/, /SQLite/, /PostgreSQL/, /Render/, /80/, /443/, /3478/, /\/health/, /\/ready/, /backup|back up/i]) assert.match(await hosting.textContent(), pattern);
    const commands = (await hosting.locator('pre').allTextContents()).join('\n');
    for (const pattern of [/SIGNAL_DOMAIN=pair\.example\.org/, /VITE_SIGNALING_URL=https:\/\/pair\.example\.org/, /VITE_STUN_URLS=stun:pair\.example\.org:3478/]) assert.match(commands, pattern);
    await hosting.getByRole('button', { name: 'Copy command', exact: true }).first().click();
    assert.ok((await page.evaluate(() => window.__websiteWrites)).at(-1)?.length > 0, 'A command copy writes displayed instructions');
    await noOverflow(page, `${width}px: expanded self hosting instructions`);
  } finally {
    await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', window.__websiteOriginalClipboardDescriptor); });
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForScreen(page, 'installation');
  assert.ok(await page.locator('details#self-hosting').evaluate(element => element.open), 'The self-hosting deep link opens its disclosure after refresh');
  await page.waitForFunction(() => {
    const bounds = document.getElementById('self-hosting').getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < innerHeight;
  });
  await page.locator('details#self-hosting > summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('details#self-hosting').evaluate(element => element.open), false, 'Disclosures support keyboard toggling');
  await noOverflow(page, `${width}px: installation document`);
}

async function perspective(page, side) {
  const control = page.locator('.ex-perspective-switch');
  if (await control.isVisible()) {
    const button = control.getByRole('button', { name: side === 'host' ? 'Host' : 'Guest', exact: true });
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  }
}

async function setSharedScroll(page, side, value) {
  await page.getByTestId(`${side}-page-scroll`).evaluate((scroller, position) => {
    if (scroller.scrollHeight <= scroller.clientHeight) throw new Error('The shared page must support natural scrolling');
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * position / 100;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  }, value);
  await assertSharedScroll(page, side, value);
}

async function assertSharedScroll(page, side, value) {
  await page.waitForFunction(({ side, value }) => {
    const scroller = document.querySelector(`[data-testid="${side}-page-scroll"]`);
    return scroller?.clientHeight > 0 && Math.abs(scroller.scrollTop - (scroller.scrollHeight - scroller.clientHeight) * value / 100) <= 2;
  }, { side, value });
}

async function assertVisibleInViewport(page, selector, label) {
  try {
    await page.waitForFunction(target => {
      const element = document.querySelector(target);
      if (!element) return false;
      const bounds = element.getBoundingClientRect();
      const header = document.querySelector('.site-header');
      const top = header && ['fixed', 'sticky'].includes(getComputedStyle(header).position) ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
      return bounds.width > 0 && bounds.height > 0 && bounds.top >= top - 1 && bounds.bottom <= innerHeight + 1;
    }, selector);
  } catch (error) {
    const state = await page.evaluate(target => ({ bounds: document.querySelector(target)?.getBoundingClientRect().toJSON(), viewport: innerHeight, scroll: scrollY }), selector);
    throw new Error(`${label}: the highlighted control is outside the visible viewport: ${JSON.stringify(state)}`, { cause: error });
  }
}

async function assertInitialSampleControls(page, width) {
  // Geometry reads precede every demo action, so Playwright cannot conceal clipping by scrolling to a control.
  const geometry = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="guest-page-scroll"]');
    const bounds = scroller.getBoundingClientRect();
    return {
      scroll: scroller.scrollTop,
      top: bounds.top + scroller.clientTop,
      bottom: bounds.top + scroller.clientTop + scroller.clientHeight,
      controls: ['guest-notify', 'guest-submit'].map(id => ({ id, bounds: document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().toJSON() })),
    };
  });
  assert.equal(geometry.scroll, 0, `${width}px: the sample opens at its natural top`);
  for (const { id, bounds } of geometry.controls) {
    assert.ok(bounds.width > 0 && bounds.height > 0 && bounds.top >= geometry.top - 1 && bounds.bottom <= geometry.bottom + 1, `${width}px: ${id} is fully discoverable in the initial sample viewport (${JSON.stringify(bounds)})`);
  }
}

async function sessionSnapshot(page) {
  return page.evaluate(() => {
    const test = name => document.querySelector(`[data-testid="${name}"]`);
    return {
      notes: test('host-notes')?.getAttribute('data-original'),
      checked: test('host-notify')?.checked,
      saved: Boolean(test('host-plan-saved')),
      address: test('host-address')?.value,
      mode: test('interaction-mode')?.value,
      control: test('allow-control')?.checked,
      pause: test('pause-session')?.textContent,
      tabs: [...document.querySelectorAll('[data-testid="host-view"] .ex-browser-tab')].map(tab => ({ text: tab.textContent, active: tab.querySelector('button')?.getAttribute('aria-pressed') })),
    };
  });
}

async function inspectTour(page, width) {
  const tour = page.getByTestId('tour-step');
  assert.equal(await tour.getAttribute('data-step'), '1', 'The optional tour starts at its first moment');
  assert.ok(await page.getByTestId('tour-previous').isDisabled());
  if (await page.locator('.ex-perspective-switch').isVisible()) {
    assert.ok(await page.getByTestId('guest-view').isVisible(), 'Mobile starts in the guest perspective');
    assert.equal(await page.getByTestId('host-view').isVisible(), false);
  }
  const initial = await sessionSnapshot(page);
  await page.getByTestId('tour-next').focus();
  await page.keyboard.press('Enter');
  assert.equal(await tour.getAttribute('data-step'), '2');
  assert.deepEqual(await sessionSnapshot(page), initial, 'Tour navigation preserves the session, original fields and approvals');
  if (await page.locator('.ex-perspective-switch').isVisible()) assert.ok(await page.getByTestId('host-view').isVisible(), 'The mode moment reveals host controls on mobile');
  assert.ok(await page.getByTestId('interaction-mode').locator('..').evaluate(element => element.classList.contains('ex-tour-target')), 'The mode moment highlights its actual control');
  await assertVisibleInViewport(page, '[data-testid="interaction-mode"]', `${width}px: mode tour moment`);
  await page.getByTestId('tour-next').click();
  assert.equal(await tour.getAttribute('data-step'), '3');
  assert.ok(await page.getByTestId('tour-next').isDisabled(), 'The tour ends after three moments');
  assert.deepEqual(await sessionSnapshot(page), initial);
  await page.getByTestId('tour-show-host').click();
  assert.ok(await page.getByTestId('host-view').isVisible(), 'The tab moment can reveal host approval');
  await assertVisibleInViewport(page, '.ex-shared-tab-row', `${width}px: host approval tour moment`);
  assert.deepEqual(await sessionSnapshot(page), initial);
  await page.getByTestId('tour-previous').click();
  assert.equal(await tour.getAttribute('data-step'), '2');
  await page.getByTestId('tour-previous').click();
  assert.equal(await tour.getAttribute('data-step'), '1');
  await page.getByTestId('close-tour').click();
  assert.equal(await tour.count(), 0, 'The tour can be dismissed for free interaction');
  await page.getByTestId('open-tour').click();
  assert.equal(await tour.getAttribute('data-step'), '1', 'The tour can be reopened');
  await page.getByTestId('close-tour').click();
  await perspective(page, 'guest');
  await noOverflow(page, `${width}px: short tour`);
}

async function inspectExplore(page, width, url) {
  const host = page.getByTestId('host-view');
  const mode = page.getByTestId('interaction-mode');
  const guestNotes = page.getByTestId('guest-notes');
  const hostNotes = page.getByTestId('host-notes');
  const feedback = page.getByTestId('demo-message');
  const original = 'Find a quiet place by the water.';
  assert.equal(await mode.inputValue(), 'preview', 'The demo starts connected in Preview changes');
  assert.equal(await page.getByTestId('guest-withheld').count(), 0);
  assert.equal(await page.locator('.ex-chapter-nav, .ex-preview-editor, .ex-feedback, .ex-clipboard, .ex-limits, .ex-connect-grid').count(), 0, 'The demo omits the old practice chapters and advanced modules');
  assert.equal(await guestNotes.inputValue(), original);
  assert.equal(await page.getByTestId('guest-notify').isChecked(), false);
  await assertInitialSampleControls(page, width);
  await inspectTour(page, width);

  await guestNotes.fill('A temporary guest idea.');
  assert.equal(await hostNotes.getAttribute('data-original'), original, 'A preview preserves the original note');
  assert.equal(await hostNotes.inputValue(), 'A temporary guest idea.', 'Both people see the same preview');
  await page.waitForFunction(expected => document.querySelector('[data-testid="guest-notes"]').value === expected, original);
  assert.equal(await hostNotes.inputValue(), original, 'The half-second preview restores both views');
  await page.getByTestId('guest-notify').check();
  assert.ok(await page.getByTestId('host-notify').isChecked(), 'Checkbox proposals appear in both views');
  await page.waitForFunction(() => !document.querySelector('[data-testid="guest-notify"]').checked);
  assert.equal(await page.getByTestId('host-notify').isChecked(), false, 'An expired checkbox proposal restores its original state');
  await page.getByTestId('guest-submit').click();
  assert.equal(await page.getByTestId('host-plan-saved').count(), 0, 'A preview does not submit the form');
  await page.waitForFunction(() => !document.querySelector('[data-testid="guest-submit"]').classList.contains('ex-has-preview'));

  await guestNotes.fill('Do not commit this suggestion.');
  await perspective(page, 'host');
  await mode.selectOption('full');
  assert.equal(await hostNotes.getAttribute('data-original'), original, 'Changing mode never commits an existing suggestion');
  assert.equal(await guestNotes.inputValue(), original, 'Mode changes clear uncommitted previews');
  await perspective(page, 'guest');
  await guestNotes.fill('Meet by the lake at nine.');
  await page.getByTestId('guest-notify').check();
  assert.equal(await hostNotes.getAttribute('data-original'), 'Meet by the lake at nine.', 'Full control commits the guest note');
  assert.ok(await page.getByTestId('host-notify').isChecked(), 'Full control commits the checkbox');
  await page.getByTestId('guest-submit').click();
  assert.match(await page.getByTestId('host-plan-saved').textContent(), /Plan saved/, 'Full control saves without removed fields');

  const edited = await sessionSnapshot(page);
  await page.getByTestId('open-tour').click();
  assert.match(await page.getByTestId('tour-step').textContent(), /Full control is on/, 'Guidance reflects the preserved interaction mode');
  await page.getByTestId('tour-next').click();
  assert.deepEqual(await sessionSnapshot(page), edited, 'Reopening and advancing guidance preserves a saved page');
  await page.getByTestId('tour-next').click();
  assert.deepEqual(await sessionSnapshot(page), edited);
  await page.getByTestId('close-tour').click();
  await perspective(page, 'host');
  await mode.selectOption('preview');
  await perspective(page, 'guest');
  await page.getByTestId('guest-address').fill('https://example.ghostpair.test/notes');
  await page.getByTestId('guest-address').press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-testid="host-address"]').value === 'https://example.ghostpair.test/notes');
  assert.equal(await hostNotes.getAttribute('data-original'), original, 'Navigation loads the next page’s original fields');
  await page.getByRole('button', { name: 'guest go back', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="guest-address"]').value === 'https://example.ghostpair.test/trip');
  assert.equal(await page.getByTestId('guest-address').inputValue(), 'https://example.ghostpair.test/trip');
  await page.getByRole('button', { name: 'guest go forward', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="guest-address"]').value === 'https://example.ghostpair.test/notes');
  assert.equal(await page.getByTestId('guest-address').inputValue(), 'https://example.ghostpair.test/notes');
  await page.getByRole('button', { name: 'guest reload example page', exact: true }).click();
  assert.equal(await page.getByTestId('host-plan-saved').count(), 0, 'Reload resets the sample without an external request');

  await page.getByTestId('guest-new-tab').click();
  assert.ok(await page.getByTestId('guest-withheld').isVisible(), 'Each new tab requires host approval');
  // The tab strip renders the new active tab before each BrowserFrame's effect
  // updates its controlled address. Await that actual transition before using
  // the DOM as the baseline for strict tour/session preservation checks.
  await page.waitForFunction(address => ['host', 'guest'].every(side => document.querySelector(`[data-testid="${side}-address"]`)?.value === address), 'https://example.ghostpair.test/checklist');
  const awaitingApproval = await sessionSnapshot(page);
  await page.getByTestId('open-tour').click();
  await page.getByTestId('tour-show-host').click();
  assert.ok(await page.getByTestId('share-active-tab').evaluate(element => element.classList.contains('ex-tour-target')), 'The tab moment highlights the pending approval action');
  await assertVisibleInViewport(page, '[data-testid="share-active-tab"]', `${width}px: pending tab approval`);
  assert.deepEqual(await sessionSnapshot(page), awaitingApproval, 'Showing approval changes guidance without approving the pending tab');
  await page.getByTestId('close-tour').click();
  await page.getByTestId('share-active-tab').click();
  assert.equal(await page.getByTestId('guest-withheld').count(), 0, 'Host approval shares the active tab');
  assert.match(await host.locator('.ex-controls-heading').textContent(), /2\/5 tabs approved/);
  if (width === 1440) {
    for (let approved = 2; approved < 5; approved += 1) {
      await page.getByTestId('guest-new-tab').click();
      await page.getByTestId('share-active-tab').click();
    }
    await page.getByTestId('guest-new-tab').click();
    await page.getByTestId('share-active-tab').click();
    assert.match(await feedback.textContent(), /Five tabs are already approved/, 'The approval limit remains enforced');
    assert.ok(await page.getByTestId('guest-withheld').isVisible());
    await host.locator('.ex-browser-tab').first().locator('button').first().click();
    await host.getByRole('button', { name: 'Stop sharing tab', exact: true }).click();
    await host.locator('.ex-browser-tab').last().locator('button').first().click();
    await page.getByTestId('share-active-tab').click();
    assert.equal(await page.getByTestId('guest-withheld').count(), 0, 'Releasing a tab makes room for another');
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
  assert.match(await page.getByTestId('guest-withheld').textContent(), /A moment to pause/);
  assert.ok(await page.getByTestId('guest-new-tab').isDisabled(), 'Guest tab actions stop during a pause');
  await setSharedScroll(page, 'host', 85);
  await page.getByTestId('pause-session').click();
  assert.equal(await page.getByTestId('guest-withheld').count(), 0, 'Resume restores the approved view');
  await perspective(page, 'guest');
  await assertSharedScroll(page, 'guest', 85);
  await perspective(page, 'host');
  await page.getByTestId('allow-control').uncheck();
  assert.ok(await guestNotes.isDisabled(), 'Withdrawing interaction disables guest input');
  assert.equal(await page.getByTestId('guest-withheld').count(), 0, 'View remains available when control is withdrawn');
  await page.getByTestId('allow-control').check();
  assert.equal(await guestNotes.isDisabled(), false);
  await host.getByRole('button', { name: 'Stop sharing tab', exact: true }).click();
  assert.equal(await page.getByTestId('guest-withheld').count(), 1);
  await setSharedScroll(page, 'host', 35);
  await page.getByTestId('share-active-tab').click();
  await perspective(page, 'guest');
  await assertSharedScroll(page, 'guest', 35);
  await perspective(page, 'host');
  await host.getByRole('button', { name: 'End session', exact: true }).click();
  assert.match(await page.getByTestId('guest-withheld').textContent(), /session has ended/);
  assert.ok(await mode.isDisabled(), 'Ended sessions cannot change modes');
  await page.getByTestId('reset-demo').click();
  assert.equal(await mode.inputValue(), 'preview');
  assert.equal(await hostNotes.getAttribute('data-original'), original);
  assert.equal(await page.getByTestId('host-notify').isChecked(), false);
  assert.match(await host.locator('.ex-controls-heading').textContent(), /1\/5 tabs approved/);
  assert.equal(await page.getByTestId('tour-step').count(), 0, 'Reset keeps a dismissed tour closed');
  await page.getByTestId('open-tour').click();
  assert.equal(await page.getByTestId('tour-step').getAttribute('data-step'), '3', 'Reset preserves the current tour moment');
  await page.getByTestId('reset-demo').click();
  assert.equal(await page.getByTestId('tour-step').getAttribute('data-step'), '3', 'Reset keeps an open tour at its selected moment');

  for (const [hash, expected] of [['modes', '2'], ['tabs', '3'], ['connect', '1'], ['feedback', '1'], ['preview', '1'], ['clipboard', '1'], ['host', '1'], ['limits', '1'], ['free', '1']]) {
    await page.goto(screenUrl(url, 'explore', hash), { waitUntil: 'domcontentloaded' });
    await waitForScreen(page, 'explore');
    assert.equal(await page.getByTestId('tour-step').getAttribute('data-step'), expected, `Legacy #${hash} opens its compact tour moment`);
    assert.equal(await page.getByTestId('interaction-mode').inputValue(), 'preview', 'Deep links choose guidance without changing the session');
  }
  await page.goto(screenUrl(url, 'explore', 'tabs'), { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForScreen(page, 'explore');
  assert.equal(await page.getByTestId('tour-step').getAttribute('data-step'), '3', 'The tabs deep link survives refresh');
  await page.goto(screenUrl(url, 'explore'), { waitUntil: 'domcontentloaded' });
  await waitForScreen(page, 'explore');
  assert.equal(await page.getByTestId('tour-step').getAttribute('data-step'), '1', 'Review captures show the intended arrival state');
  await perspective(page, 'guest');
  await noOverflow(page, `${width}px: compact demo interactions`);
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
        else await inspectExplore(page, width, url);
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
