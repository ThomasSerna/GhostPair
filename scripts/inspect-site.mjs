import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = resolve(root, 'docs');
const output = resolve(root, '.impeccable/review');
const base = '/GhostPair/';
const screenshots = !process.argv.includes('--check-only');
const viewports = [[1440, 1000, 'desktop'], [768, 1024, 'tablet'], [390, 844, 'mobile'], [375, 812], [320, 812]];
const choices = ['shared', 'host', 'guest'];
const labels = ['Shared view', 'Host a session', 'Join a session'];
const exampleFiles = ['remote-viewer.html', 'share-tab.html', 'connect-host.html'];
const errors = [];
const requests = new Set();

// Serve HTML unchanged: Vite's injected dev client would violate the authentic
// exports' CSP and make a production inspection report development-only errors.
const htmlFiles = new Set(['index.html', 'privacy.html', ...[...exampleFiles, 'shared-page.html'].map(file => `assets/previews/${file}`)]);
const server = await createServer({ configFile: false, root: docs, base, plugins: [{
  name: 'inspect-production-html',
  configureServer(vite) {
    vite.middlewares.use(async (request, response, next) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (!pathname.startsWith(base)) return next();
      const file = pathname.slice(base.length) || 'index.html';
      if (!htmlFiles.has(file)) return next();
      try {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(await readFile(resolve(docs, file)));
      } catch (error) { next(error); }
    });
  },
}], server: { host: '127.0.0.1', port: 0 } });
let browser;

async function launchBrowser() {
  const failures = [];
  for (const options of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try { return await chromium.launch({ ...options, headless: true }); }
    catch (error) { failures.push(`${options.channel ?? 'Playwright Chromium'}: ${error.message.split('\n')[0]}`); }
  }
  throw new Error(`No browser available. Install Playwright Chromium, Chrome or Edge.\n${failures.join('\n')}`);
}

async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(dimensions.page <= dimensions.viewport, `${label}: horizontal overflow (${dimensions.page}px > ${dimensions.viewport}px)`);
}

async function scrollToTop(page) {
  // An initial hash jump can keep native scroll anchoring active while the
  // entrance transforms run. Finish that transition before setting exact scroll.
  await page.waitForFunction(() => {
    const lines = [...document.querySelectorAll('.hero-line')];
    const art = document.querySelector('.hero-art');
    return lines.every(element => !element.style.transform) && (!art || Math.abs(new DOMMatrix(getComputedStyle(art).transform).a - 1) < 0.00001);
  });
  await settleFrames(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  try { await page.waitForFunction(() => scrollY < 1); }
  catch (error) {
    const state = await page.evaluate(() => ({ scrollY, viewport: innerWidth, hash: location.hash, active: document.activeElement?.id, top: document.documentElement.scrollTop }));
    throw new Error(`Could not return to the top: ${JSON.stringify(state)}`, { cause: error });
  }
}

async function settleFrames(page) {
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function inspectNavigation(page, width) {
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.skip-link').evaluate(element => element === document.activeElement), true, `${width}px: skip link is first in keyboard order`);
  assert.ok(await page.locator('.skip-link').evaluate(element => element.getBoundingClientRect().top >= 0), 'Focused skip link is visible');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'main');
  const navigation = page.getByRole('navigation', { name: 'Main navigation', includeHidden: true });
  for (const anchor of ['how-it-works', 'preview', 'install']) {
    assert.equal(await navigation.locator(`a[href="#${anchor}"]`).count(), 1);
    assert.equal(await page.locator(`#${anchor}`).count(), 1, `Navigation target ${anchor} exists`);
  }
  if (width <= 800) {
    const toggle = page.locator('.menu-toggle');
    assert.equal(await navigation.isVisible(), false, 'Mobile navigation starts closed');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.menu-toggle').getAttribute('aria-expanded') === 'true');
    assert.ok(await navigation.isVisible(), 'Keyboard opens mobile navigation');
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Escape closes navigation');
    assert.equal(await toggle.evaluate(element => element === document.activeElement), true, 'Escape returns focus to the toggle');
    await page.keyboard.press('Enter');
    await navigation.locator('a[href="#preview"]').click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'Following a mobile navigation link closes the menu');
    assert.equal(await navigation.isVisible(), false);
    await noOverflow(page, `${width}px: mobile menu`);
  } else {
    assert.ok(await navigation.isVisible(), 'Desktop navigation is visible');
  }
  for (const link of await page.locator('.github-link').all()) assert.equal(await link.getAttribute('href'), 'https://github.com/ThomasSerna/GhostPair');
  assert.equal(await page.getByRole('link', { name: 'Download GhostPair', exact: true }).getAttribute('href'), 'https://github.com/ThomasSerna/GhostPair/releases/latest');
}

async function inspectMotion(page, width) {
  await scrollToTop(page);
  const video = page.locator('.hero-scene video');
  const poster = page.locator('.hero-scene img');
  assert.equal(await page.locator('.hero-scene canvas').count(), 0, 'The visitor does not run the procedural canvas renderer');
  assert.equal(await page.locator('.motion-toggle, .hero-bottom').count(), 0, 'The removed hero status strip and pause control stay absent');
  await video.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const video = document.querySelector('.hero-scene video');
    return video && !video.paused && video.currentTime > 0;
  });
  assert.deepEqual(await video.evaluate(element => ({ autoplay: element.autoplay, muted: element.muted, loop: element.loop, playsInline: element.playsInline })),
    { autoplay: true, muted: true, loop: true, playsInline: true }, 'The prerecorded hero plays inline and loops without audio');
  const first = await video.evaluate(element => element.currentTime);
  await page.waitForFunction(time => document.querySelector('.hero-scene video').currentTime > time + 0.1, first, { timeout: 3000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.hero-scene img')).opacity === '0');
  assert.equal(await poster.evaluate(element => getComputedStyle(element).opacity), '0', 'Playback replaces the matching poster');
  assert.ok(Math.abs(await video.evaluate(element => element.duration) - 42) < 0.1, 'Hero animation preserves the 42-second loop');
  await video.evaluate(element => { element.currentTime = element.duration - 0.15; });
  await page.waitForFunction(() => {
    const video = document.querySelector('.hero-scene video');
    return !video.seeking && !video.paused && video.currentTime < 1;
  });

  // A synthetic visibility change exercises the same document.hidden listener
  // reliably in headless browsers, where bringing a tab forward is platform-dependent.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => document.querySelector('.hero-scene video').paused);
  const hiddenTime = await video.evaluate(element => element.currentTime);
  await page.waitForTimeout(150);
  assert.equal(await video.evaluate(element => element.currentTime), hiddenTime, 'An inactive tab stops video playback');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(time => !document.querySelector('.hero-scene video').paused && document.querySelector('.hero-scene video').currentTime > time, hiddenTime);

  await scrollToTop(page);
  await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.signal-path')).strokeDashoffset) > 900);
  const initialOffset = await page.locator('.signal-path').evaluate(element => parseFloat(getComputedStyle(element).strokeDashoffset));
  await page.locator('.connection-stage').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    window.scrollTo({ top: scrollY + bounds.bottom - innerHeight * 0.5, behavior: 'instant' });
  });
  await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.querySelector('.signal-path')).strokeDashoffset)) < 2, null, { timeout: 4000 });
  assert.ok(initialOffset > 900, 'The connection starts unfilled');
  const finalSymbols = await page.locator('.browser-symbol > .icon, .guest-cursor').evaluateAll(elements => elements.map(element => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
    filter: getComputedStyle(element).filter,
  })));
  const mint = await page.locator('.signal-path').evaluate(element => getComputedStyle(element).stroke);
  assert.equal(finalSymbols[0].color, mint, 'The Host symbol reaches the mint highlight');
  assert.equal(finalSymbols[1].color, mint, 'The Guest symbol reaches the mint highlight');
  assert.equal(finalSymbols[2].background, mint, 'The Guest cursor reaches the mint highlight');
  assert.ok(finalSymbols.every(symbol => symbol.filter === 'none'), 'Connection highlights do not add a blur filter');
  await noOverflow(page, `${width}px: animated connection`);

  await page.locator('#install').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.hero-scene video').paused);
  const offscreenTime = await video.evaluate(element => element.currentTime);
  await page.waitForTimeout(150);
  assert.equal(await video.evaluate(element => element.currentTime), offscreenTime, `${width}px: the offscreen video stops advancing`);
  await video.scrollIntoViewIfNeeded();
  await page.waitForFunction(time => !document.querySelector('.hero-scene video').paused && document.querySelector('.hero-scene video').currentTime > time, offscreenTime);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.hero-scene video').paused && getComputedStyle(document.querySelector('.hero-scene img')).opacity === '1');
  const reduced = await video.evaluate(element => element.currentTime);
  await page.waitForTimeout(150);
  assert.equal(await video.evaluate(element => element.currentTime), reduced, `${width}px: reduced motion displays a static hero`);
  assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).scrollBehavior), 'auto', 'Reduced motion disables smooth scrolling');
  assert.equal(await page.locator('.signal-path').evaluate(element => element.style.strokeDashoffset), '', 'Reduced motion removes the GSAP stroke animation');
  const reducedOffset = await page.locator('.signal-path').evaluate(element => getComputedStyle(element).strokeDashoffset);
  assert.equal(parseFloat(reducedOffset), 0, 'Reduced motion presents the completed connection');
  await page.locator('.connection-stage').scrollIntoViewIfNeeded();
  await settleFrames(page);
  assert.equal(await page.locator('.signal-path').evaluate(element => getComputedStyle(element).strokeDashoffset), reducedOffset, 'Reduced motion leaves the connection line unchanged by scrolling');
  for (const element of await page.locator('[data-reveal]').all()) assert.equal(await element.evaluate(node => getComputedStyle(node).opacity), '1', 'Reduced motion retains visible content');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

async function inspectHeroFallbacks(browser, url) {
  for (const scenario of ['reduced motion', 'missing video', 'playback rejected']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: scenario === 'reduced motion' ? 'reduce' : 'no-preference' });
    const videoRequests = [];
    const pageErrors = [];
    context.on('request', request => { if (/\.mp4(?:\?|$)/.test(request.url())) videoRequests.push(request.url()); });
    try {
      if (scenario === 'missing video') await context.route('**/*.mp4', route => route.abort());
      if (scenario === 'playback rejected') await context.addInitScript(() => {
        HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('Autoplay disabled for this inspection', 'NotAllowedError')); };
      });
      const page = await context.newPage();
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.locator('.hero-scene img').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const poster = document.querySelector('.hero-scene img');
        const video = document.querySelector('.hero-scene video');
        return poster?.complete && poster.naturalWidth > 0 && getComputedStyle(poster).opacity === '1' && (!video || video.paused);
      });
      await settleFrames(page);
      assert.deepEqual(pageErrors, [], `${scenario}: fallback does not raise an uncaught error`);
      if (scenario === 'reduced motion') assert.deepEqual(videoRequests, [], 'Initial reduced motion does not download the video');
      if (scenario === 'missing video') assert.ok(videoRequests.length > 0, 'Missing video case attempted the real asset');
      await noOverflow(page, `${scenario}: static hero`);
    } finally { await context.close(); }
  }
}

async function inspectPreviews(page, context, width, origin) {
  const shared = page.getByRole('radio', { name: labels[0], exact: true });
  assert.ok(await shared.isChecked(), 'Shared view is the initial preview');
  await shared.focus();
  for (const [index, choice] of [...choices, 'shared'].entries()) {
    await page.waitForFunction(name => document.getElementById(`preview-${name}`).checked, choice);
    for (const panel of choices) assert.equal(await page.locator(`#${panel}-preview`).isVisible(), panel === choice, `${width}px: ${choice} selection, ${panel} panel visibility`);
    await page.locator(`#${choice}-preview`).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('.preview-stage')].filter(stage => stage.getBoundingClientRect().width > 0).every(stage => {
      const frame = stage.querySelector('iframe');
      const stageBounds = stage.getBoundingClientRect();
      const frameBounds = frame.getBoundingClientRect();
      return Math.abs(stageBounds.width - frameBounds.width) < 1 && Math.abs(stageBounds.height - frameBounds.height) < 1;
    }));
    await noOverflow(page, `${width}px: ${choice} preview`);
    const frame = page.locator(`#${choice}-preview iframe`);
    assert.equal(await frame.getAttribute('sandbox'), 'allow-same-origin');
    assert.equal(await frame.getAttribute('tabindex'), '-1');
    if (index < choices.length) {
      const popupPromise = context.waitForEvent('page');
      await page.getByRole('link', { name: 'Open full-size example', exact: true }).click();
      const popup = await popupPromise;
      try {
        await popup.waitForLoadState('load');
        assert.equal(popup.url(), `${origin}${base}assets/previews/${exampleFiles[index]}`);
        assert.equal(await popup.locator('main').getAttribute('inert'), '', 'Full-size example remains inert');
        assert.equal(await popup.locator('body').getAttribute('role'), 'img', 'Product export has an accessible description');
      } finally { await popup.close(); }
    }
    await page.locator(`#preview-${choice}`).focus();
    if (index < choices.length) await page.keyboard.press('ArrowRight');
  }
  if (width <= 390) {
    for (const choice of ['host', 'guest', 'shared']) {
      await page.locator(`label[for="preview-${choice}"]`).click();
      assert.ok(await page.locator(`#preview-${choice}`).isChecked(), `${width}px: label selects ${choice}`);
      await noOverflow(page, `${width}px: ${choice} touch target`);
    }
  }
}

async function inspectModeDemo(page, width) {
  const note = page.getByRole('textbox', { name: 'Guest note', exact: true });
  const guestPacked = page.locator('#guest-pack');
  const hostNote = page.locator('.demo-host-value');
  const hostPacked = page.locator('.demo-host-checkbox');
  const guestPage = page.locator('.demo-guest');
  const hostPage = page.locator('.demo-host');
  const halos = guestPage.locator('.demo-click-halo');
  const save = page.getByRole('button', { name: 'Save plans', exact: true });
  const savedStatuses = page.locator('.demo-save-status');
  await guestPage.scrollIntoViewIfNeeded();
  assert.ok(await page.getByRole('radio', { name: 'Visual only', exact: true }).isChecked());
  await note.fill('A guest-only idea.');
  await guestPacked.check();
  assert.equal(await hostNote.textContent(), 'Bring a camera.', 'Visual typing leaves the original unchanged');
  assert.equal(await hostPacked.getAttribute('data-checked'), 'false', 'Visual checkbox edits leave the original unchanged');
  assert.equal(await halos.count(), 1, 'Clicking a Visual only checkbox adds one halo');
  const haloStyle = await halos.evaluate(element => {
    const style = getComputedStyle(element);
    const fill = style.backgroundColor;
    const channels = fill.match(/[\d.]+/g).map(Number);
    const srgb = fill.startsWith('color(srgb');
    return { width: style.width, height: style.height, border: style.borderTopWidth, accent: style.borderTopColor, fill: channels.map((value, index) => srgb && index < 3 ? Math.round(value * 255) : value), duration: style.animationDuration, iteration: style.animationIterationCount, pointerEvents: style.pointerEvents };
  });
  assert.deepEqual(haloStyle, { width: '30px', height: '30px', border: '2px', accent: 'rgb(120, 113, 232)', fill: [120, 113, 232, 0.12], duration: '0.5s', iteration: '1', pointerEvents: 'none' }, 'Click halo matches the extension and ends without a JavaScript rendering loop');
  await halos.waitFor({ state: 'detached' });

  await guestPage.locator('.demo-page-header').click();
  assert.equal(await halos.count(), 1, 'Visual clicks in the simulated header show a halo');
  await halos.waitFor({ state: 'detached' });
  if (width <= 390) {
    await guestPage.locator('.demo-page-header').tap();
    assert.equal(await halos.count(), 1, 'A touchscreen tap shows one Visual only halo');
    await halos.waitFor({ state: 'detached' });
  }
  await guestPage.click({ position: { x: 12, y: 60 } });
  assert.equal(await halos.count(), 1, 'Visual clicks in blank page space show a halo');
  await halos.waitFor({ state: 'detached' });
  await guestPage.locator('.demo-check').click();
  assert.equal(await halos.count(), 1, 'A label and its native input activation do not duplicate the halo');
  await halos.waitFor({ state: 'detached' });
  await guestPacked.check();
  await halos.waitFor({ state: 'detached' });
  await hostPage.locator('.demo-page-header').click();
  assert.equal(await page.locator('.demo-click-halo').count(), 0, 'Clicks outside the Guest preview do not create a halo');

  await save.click();
  assert.equal(await halos.count(), 1, 'Visual Save plans previews the click');
  assert.ok((await savedStatuses.allTextContents()).every(status => status.trim() === ''), 'Visual Save plans does not save either panel');
  await halos.waitFor({ state: 'detached' });
  await save.focus();
  await page.keyboard.press('Enter');
  assert.equal(await halos.count(), 1, 'The Visual only save control supports keyboard click feedback');
  assert.ok((await savedStatuses.allTextContents()).every(status => status.trim() === ''), 'Keyboard activation keeps Visual only edits local');
  await page.getByRole('radio', { name: 'Visual only', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.ok(await page.getByRole('radio', { name: 'Live control', exact: true }).isChecked());
  assert.equal(await page.locator('.demo-click-halo').count(), 0, 'Changing modes clears preview halos');
  assert.equal(await hostNote.textContent(), 'Bring a camera.', 'Changing modes alone does not apply preview text');
  assert.equal(await hostPacked.getAttribute('data-checked'), 'false', 'Changing modes alone does not apply preview selections');
  assert.ok((await savedStatuses.allTextContents()).every(status => status.trim() === ''), 'Changing modes does not submit pending preview changes');
  await note.fill('Bring a camera and a map.');
  assert.equal(await hostNote.textContent(), 'Bring a camera and a map.', 'A live edit updates the original');
  await guestPacked.uncheck();
  await guestPacked.check();
  assert.equal(await hostPacked.getAttribute('data-checked'), 'true', 'Live checkbox edits update the original');
  await save.focus();
  await page.keyboard.press('Enter');
  assert.equal(await guestPage.locator('.demo-save-status[role="status"]').textContent(), 'Plans saved', 'Live Save plans confirms the Guest action');
  assert.equal(await hostPage.locator('.demo-save-status[role="status"]').textContent(), 'Plans saved', 'Live Save plans confirms the original page action');
  assert.equal(await page.locator('.demo-click-halo').count(), 0, 'Live control uses the page controls without preview halos');
  await page.getByRole('button', { name: 'Reset demonstration', exact: true }).click();
  assert.ok(await page.getByRole('radio', { name: 'Visual only', exact: true }).isChecked());
  assert.equal(await note.inputValue(), 'Bring a camera.');
  assert.equal(await hostNote.textContent(), 'Bring a camera.');
  assert.equal(await guestPacked.isChecked(), false);
  assert.equal(await hostPacked.getAttribute('data-checked'), 'false');
  assert.ok((await savedStatuses.allTextContents()).every(status => status.trim() === ''), 'Reset clears both save confirmations');
  await guestPage.locator('.demo-page-header').click();
  await page.getByRole('button', { name: 'Reset demonstration', exact: true }).click();
  assert.equal(await page.locator('.demo-click-halo').count(), 0, 'Reset clears active click feedback');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await guestPage.locator('.demo-page-header').click();
  assert.equal(await halos.count(), 1, 'Reduced motion retains click feedback');
  const firstStatic = await halos.evaluate(element => ({ opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform }));
  await page.waitForTimeout(150);
  assert.deepEqual(await halos.evaluate(element => ({ opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform })), firstStatic, 'Reduced motion keeps click feedback static');
  await halos.waitFor({ state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

async function inspectLocalAssets(page, origin) {
  for (const frame of page.frames()) {
    if (frame.url() === 'about:blank') continue;
    const assets = await frame.evaluate(() => [...document.querySelectorAll('[src], [href]')].flatMap(element => ['src', 'href'].filter(attribute => element.hasAttribute(attribute)).map(attribute => new URL(element.getAttribute(attribute), document.baseURI).href)));
    for (const asset of new Set(assets)) {
      const local = new URL(asset);
      if (local.origin !== origin) continue;
      assert.ok(local.pathname.startsWith(base), `Asset escapes the GitHub Pages project path: ${asset}`);
      if (local.pathname.startsWith(`${base}@vite/`)) continue;
      const path = resolve(docs, decodeURIComponent(local.pathname.slice(base.length)) || 'index.html');
      assert.ok(path.startsWith(docs + sep), `Asset escapes docs: ${asset}`);
      await access(path);
    }
    assert.ok(await frame.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)), `Missing image in ${frame.url()}`);
  }
}

async function captureReview(page, width, name) {
  // Reduced motion gives review captures the same deterministic poster and
  // fully revealed connection that visitors requesting less motion receive.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.hero-scene img')).opacity === '1');
  for (const element of await page.locator('[data-reveal], .install-title').all()) await element.scrollIntoViewIfNeeded();
  await scrollToTop(page);
  await settleFrames(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  if (name === 'desktop' || name === 'mobile') {
    const bounds = await page.locator('.hero').boundingBox();
    await page.screenshot({ path: resolve(output, `${name}-hero.png`), clip: { x: 0, y: 0, width, height: Math.ceil(bounds.y + bounds.height) } });
  }
}

try {
  const generatedDirectory = resolve(docs, 'assets/landing');
  const scripts = (await readdir(generatedDirectory)).filter(file => file.endsWith('.js'));
  assert.ok(scripts.length, 'Run npm run build:landing before site QA');
  const gzipBytes = (await Promise.all(scripts.map(async file => gzipSync(await readFile(resolve(generatedDirectory, file))).length))).reduce((total, size) => total + size, 0);
  assert.ok(gzipBytes < 150 * 1024, `Landing JavaScript exceeds the 150 KiB gzip budget (${(gzipBytes / 1024).toFixed(1)} KiB)`);
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const url = origin + base;
  browser = await launchBrowser();
  await inspectHeroFallbacks(browser, url);
  if (screenshots) await mkdir(output, { recursive: true });
  for (const [width, height, name] of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'no-preference', hasTouch: width <= 390, isMobile: width <= 390 });
    context.on('page', page => {
      page.on('pageerror', error => errors.push(`${width}px: ${error.message}`));
      page.on('console', message => { if (message.type() === 'error') errors.push(`${width}px: ${message.text()}`); });
    });
    context.on('request', request => requests.add(request.url()));
    context.on('response', response => { if (response.url().startsWith(origin) && response.status() >= 400) errors.push(`${width}px: HTTP ${response.status()} ${response.url()}`); });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      // Progressive video requests may remain active after the page is usable.
      // The checks below await actual content, loaded images and video playback.
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { level: 1, name: 'Browse together.' }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await noOverflow(page, `${width}px: initial page`);
      await inspectNavigation(page, width);
      await inspectMotion(page, width);
      await inspectPreviews(page, context, width, origin);
      await inspectModeDemo(page, width);
      await inspectLocalAssets(page, origin);
      await noOverflow(page, `${width}px: completed interactions`);
      assert.deepEqual(errors, [], `${width}px: browser or resource errors`);
      if (screenshots && name) await captureReview(page, width, name);
    } finally { await context.close(); }
  }
  const fonts = [...requests].filter(url => /\.woff2(?:\?|$)/.test(url));
  assert.ok(fonts.length, 'The self-hosted display font was requested');
  assert.ok(fonts.every(url => url.startsWith(`${origin}${base}assets/landing/`)), 'All display fonts load from this site');
  for (const request of requests) {
    const asset = new URL(request);
    if (asset.origin === origin) assert.ok(asset.pathname.startsWith(base), `Request escapes the GitHub Pages base: ${request}`);
  }
  const privacy = await fetch(`${origin}${base}privacy.html`);
  assert.equal(privacy.status, 200, 'Existing privacy document is preserved');
  assert.equal(await privacy.text(), await readFile(resolve(docs, 'privacy.html'), 'utf8'));
  assert.deepEqual(errors, [], 'No browser or resource errors');
  process.stdout.write(`Site QA passed: 5 viewports, navigation and focus, keyboard/click previews, original product assets, interaction modes and save feedback, video playback/suspension/fallbacks, reduced motion, project-relative assets, and self-hosted fonts. JavaScript: ${(gzipBytes / 1024).toFixed(1)} KiB gzip.${screenshots ? ` Review captures: ${output}` : ''}\n`);
} finally {
  await browser?.close();
  await server.close();
}
