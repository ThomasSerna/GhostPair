import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createServer } from 'vite';
import { launchHeadlessBrowser } from '../tests/browser/helpers.mjs';
import { inspectWebsitePages } from './inspect-website-pages.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = resolve(root, 'docs');
const output = resolve(root, '.impeccable/review');
const base = '/GhostPair/';
const screenshots = !process.argv.includes('--check-only');
const pagesOnly = process.argv.includes('--pages-only');
const viewports = [[1440, 1000, 'desktop'], [768, 1024, 'tablet'], [390, 844, 'mobile'], [375, 812], [320, 812]];
const choices = ['shared', 'host', 'guest'];
const labels = ['Shared view', 'Share a tab', 'Join a session'];
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
  assert.deepEqual(await navigation.getByRole('link', { includeHidden: true }).allTextContents(), ['Home', 'Installation', 'Explore'], 'The header has exactly three destinations');
  assert.equal(await navigation.getByRole('link', { name: 'Home', exact: true, includeHidden: true }).getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('.site-header .github-link, .site-header .header-download').count(), 0, 'Repository and download actions live in the page and footer');
  for (const anchor of ['how-it-works', 'preview']) {
    assert.equal(await page.locator(`#${anchor}`).count(), 1, `Navigation target ${anchor} exists`);
  }
  assert.equal(await navigation.getByRole('link', { name: 'Installation', exact: true, includeHidden: true }).getAttribute('href'), '?view=installation');
  assert.equal(await navigation.getByRole('link', { name: 'Explore', exact: true, includeHidden: true }).getAttribute('href'), '?view=explore');
  assert.equal(await page.locator('#install').count(), 1, 'The original installation section is preserved');
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
    await navigation.getByRole('link', { name: 'Home', exact: true }).click();
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
  const halos = hostPage.locator('.demo-click-halo');
  const textPreview = hostPage.locator('.demo-text-preview');
  const choicePreview = hostPage.locator('.demo-choice-preview');
  const buttonPreview = hostPage.locator('.demo-button-preview');
  const overlays = page.locator('.demo-text-preview, .demo-choice-preview, .demo-button-preview');
  const save = page.getByRole('button', { name: 'Save plans', exact: true });
  const reset = page.getByRole('button', { name: 'Reset demonstration', exact: true });
  const visualMode = page.getByRole('radio', { name: 'Preview changes', exact: true });
  const liveMode = page.getByRole('radio', { name: 'Full control', exact: true });
  const savedStatuses = page.locator('.demo-save-status');
  const assertMappedHalo = async (target, message) => {
    const mapping = await target.evaluate(element => {
      const input = element.getBoundingClientRect();
      const guest = document.querySelector('.demo-guest').getBoundingClientRect();
      const hostElement = document.querySelector('.demo-host');
      const host = hostElement.getBoundingClientRect();
      const halo = [...document.querySelectorAll('.demo-host .demo-click-halo')].at(-1);
      const haloStyle = getComputedStyle(halo);
      return {
        expectedX: ((input.left + input.width / 2 - guest.left) / guest.width) * host.width,
        expectedY: ((input.top + input.height / 2 - guest.top) / guest.height) * host.height,
        actualX: parseFloat(haloStyle.left) + 15 + hostElement.clientLeft,
        actualY: parseFloat(haloStyle.top) + 15 + hostElement.clientTop,
      };
    });
    assert.ok(Math.abs(mapping.actualX - mapping.expectedX) < 1 && Math.abs(mapping.actualY - mapping.expectedY) < 1, `${width}px: ${message}: ${JSON.stringify(mapping)}`);
  };
  const assertOriginal = async () => {
    assert.equal(await hostNote.textContent(), 'Bring a camera.', 'Visual typing leaves the original Host value unchanged');
    assert.equal(await hostPacked.getAttribute('data-checked'), 'false', 'Visual selection leaves the original Host checkbox unchanged');
    assert.ok((await savedStatuses.allTextContents()).every(status => status.trim() === ''), 'Visual Save plans does not submit either panel');
  };
  await guestPage.scrollIntoViewIfNeeded();
  assert.ok(await visualMode.isChecked());
  assert.equal(await page.getByRole('heading', { name: 'Guest input', exact: true }).count(), 1, 'Guest is identified as the source of remote input');
  assert.equal(await page.getByRole('heading', { name: 'Host’s shared page', exact: true }).count(), 1, 'Host is identified as the page receiving input');
  assert.equal(await page.locator('.demo-preview-timing').textContent(), 'Demo previews last 1 second. Preview duration is configurable.', 'The small timing copy describes this illustration without claiming a different extension default');
  await note.fill('A temporary guest idea.');
  await guestPacked.check();
  await assertOriginal();
  assert.equal(await textPreview.textContent(), 'A temporary guest idea.', 'Visual typing is shown as a Host overlay');
  assert.equal(await choicePreview.getAttribute('data-checked'), 'true', 'Visual selection is shown as a Host overlay');
  for (const [preview, original] of [[textPreview, hostNote], [choicePreview, hostPacked]]) {
    const previewBounds = await preview.boundingBox();
    const originalBounds = await original.boundingBox();
    assert.ok(['x', 'y', 'width', 'height'].every(dimension => Math.abs(previewBounds[dimension] - originalBounds[dimension]) < 1), `${width}px: passive previews sit directly above the original Host field`);
    assert.equal(await preview.evaluate(element => getComputedStyle(element).pointerEvents), 'none', 'Passive Host overlays cannot execute input');
  }
  assert.equal(await halos.count(), 0, 'Visual checkbox feedback uses the selection preview without a click halo');
  assert.equal(await guestPage.locator('.demo-click-halo, .demo-text-preview, .demo-choice-preview, .demo-button-preview').count(), 0, 'Guest inputs do not render Host preview effects');
  await save.click();
  assert.equal(await buttonPreview.count(), 1, 'Visual Save plans highlights the Host button without executing it');
  assert.equal(await halos.count(), 1, 'Visual Save plans places click feedback on the Host');
  await assertOriginal();
  await assertMappedHalo(save, 'the Guest click maps to the corresponding Host coordinates');
  const haloStyle = await halos.first().evaluate(element => {
    const style = getComputedStyle(element);
    const fill = style.backgroundColor;
    const channels = fill.match(/[\d.]+/g).map(Number);
    const srgb = fill.startsWith('color(srgb');
    return { width: style.width, height: style.height, border: style.borderTopWidth, accent: style.borderTopColor, fill: channels.map((value, index) => srgb && index < 3 ? Math.round(value * 255) : value), duration: style.animationDuration, iteration: style.animationIterationCount, pointerEvents: style.pointerEvents };
  });
  assert.deepEqual(haloStyle, { width: '30px', height: '30px', border: '2px', accent: 'rgb(120, 113, 232)', fill: [120, 113, 232, 0.12], duration: '1s', iteration: '1', pointerEvents: 'none' }, 'The Host halo uses the extension appearance and the requested one-second demonstration duration');
  await page.waitForFunction(() => document.querySelectorAll('.demo-click-halo, .demo-text-preview, .demo-choice-preview, .demo-button-preview').length === 0);
  assert.equal(await note.inputValue(), 'Bring a camera.', 'Expired visual text returns Guest input to the real Host value');
  assert.equal(await guestPacked.isChecked(), false, 'Expired visual selection returns Guest input to the real Host selection');

  const guestHeader = guestPage.locator('.demo-page-header');
  await guestHeader.click();
  assert.equal(await halos.count(), 1, 'Guest header clicks render feedback on the Host');
  await assertMappedHalo(guestHeader, 'header coordinates remain normalized across panel layouts');
  await reset.click();
  if (width <= 390) {
    await guestHeader.tap();
    assert.equal(await halos.count(), 1, 'A touchscreen tap sends one Host halo');
    assert.equal(await guestPage.locator('.demo-click-halo').count(), 0, 'Touch feedback stays off the Guest input panel');
    await assertMappedHalo(guestHeader, 'touch coordinates map to the Host');
    await reset.click();
  }
  await guestPage.click({ position: { x: 12, y: 60 } });
  assert.equal(await halos.count(), 1, 'Blank-space gestures still create Host feedback');
  await reset.click();
  await guestPage.locator('.demo-check').click();
  assert.equal(await choicePreview.count(), 1, 'A native label activation creates one selection preview');
  assert.equal(await halos.count(), 0, 'A Visual checkbox label does not also create a halo');
  await reset.click();
  await guestPacked.focus();
  await page.keyboard.press('Space');
  assert.equal(await choicePreview.getAttribute('data-checked'), 'true', 'Keyboard checkbox input previews the choice on the Host');
  assert.equal(await halos.count(), 0, 'Visual keyboard choices do not add a click halo');
  await reset.click();
  await hostPage.locator('.demo-page-header').click();
  assert.equal(await halos.count(), 0, 'Direct Host-panel clicks are not Guest gestures');
  await save.focus();
  await page.keyboard.press('Enter');
  assert.equal(await halos.count(), 1, 'Keyboard Save plans sends Host click feedback');
  assert.equal(await buttonPreview.count(), 1, 'Keyboard Save plans highlights the Host button');
  await assertMappedHalo(save, 'keyboard clicks use the corresponding Host control center');
  await assertOriginal();
  await note.fill('Discard this pending note.');
  await guestPacked.check();
  await visualMode.focus();
  await page.keyboard.press('ArrowRight');
  assert.ok(await liveMode.isChecked());
  assert.equal(await page.locator('.demo-click-halo').count(), 0, 'Changing modes clears preview halos');
  assert.equal(await overlays.count(), 0, 'Changing modes clears all passive previews');
  assert.equal(await note.inputValue(), 'Bring a camera.', 'Changing modes discards pending Guest visual text');
  assert.equal(await guestPacked.isChecked(), false, 'Changing modes discards pending Guest visual selection');
  await assertOriginal();
  await note.fill('Bring a camera and a map.');
  assert.equal(await hostNote.textContent(), 'Bring a camera and a map.', 'Live typing immediately updates the real Host value');
  assert.equal(await textPreview.count(), 0, 'Live typing does not create a passive text overlay');
  await guestPacked.check();
  assert.equal(await hostPacked.getAttribute('data-checked'), 'true', 'Live selection immediately updates the real Host checkbox');
  assert.equal(await choicePreview.count(), 0, 'Live selection does not create a passive selection overlay');
  assert.equal(await halos.count(), 1, 'Live Guest choices still send click feedback to the Host');
  await assertMappedHalo(guestPacked, 'live selection coordinates map to the Host');
  await save.focus();
  await page.keyboard.press('Enter');
  assert.equal(await guestPage.locator('.demo-save-status[role="status"]').textContent(), 'Plans saved', 'Live Save plans confirms the Guest action');
  assert.equal(await hostPage.locator('.demo-save-status[role="status"]').textContent(), 'Plans saved', 'Live Save plans confirms the original page action');
  assert.equal(await guestPage.locator('.demo-click-halo').count(), 0, 'Live click feedback stays on the Host');
  assert.equal(await buttonPreview.count(), 0, 'Live Save plans executes directly');
  await assertMappedHalo(save, 'live keyboard Save coordinates map to the Host');
  await page.locator('label[for="mode-visual"]').click();
  assert.equal(await note.inputValue(), 'Bring a camera and a map.', 'Returning to Visual mode preserves the real live value');
  assert.equal(await guestPacked.isChecked(), true, 'Returning to Visual mode preserves the real live selection');
  await note.fill('An unsaved visual overlay.');
  assert.ok((await savedStatuses.allTextContents()).every(status => status.trim() === 'Plans saved'), 'A visual preview cannot erase the real saved confirmation');
  await page.locator('label[for="mode-live"]').click();
  assert.ok((await savedStatuses.allTextContents()).every(status => status.trim() === 'Plans saved'), 'Returning to Live preserves the same real save state in both panels');
  await reset.click();
  assert.ok(await visualMode.isChecked());
  assert.equal(await note.inputValue(), 'Bring a camera.');
  assert.equal(await hostNote.textContent(), 'Bring a camera.');
  assert.equal(await guestPacked.isChecked(), false);
  assert.equal(await hostPacked.getAttribute('data-checked'), 'false');
  assert.ok((await savedStatuses.allTextContents()).every(status => status.trim() === ''), 'Reset clears both save confirmations');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await guestHeader.click();
  assert.equal(await halos.count(), 1, 'Reduced motion retains Host click feedback');
  const firstStatic = await halos.first().evaluate(element => ({ opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform }));
  await page.waitForTimeout(150);
  assert.deepEqual(await halos.first().evaluate(element => ({ opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform })), firstStatic, 'Reduced motion keeps Host click feedback static');
  await halos.waitFor({ state: 'detached' });

  // Stagger actions to observe independent expiry with a generous margin on
  // both sides of the one-second lifetime, without changing browser time.
  await note.fill('First visual draft.');
  await page.waitForTimeout(300);
  await guestPacked.check();
  await page.waitForTimeout(300);
  await note.fill('Renewed visual draft.');
  assert.equal(await choicePreview.count(), 1, 'Renewing text leaves an active choice preview intact');
  await page.waitForTimeout(800);
  assert.equal(await textPreview.textContent(), 'Renewed visual draft.', 'Typing renews its own expiry beyond the original deadline');
  assert.equal(await choicePreview.count(), 0, 'Selection expires after its own action');
  assert.equal(await guestPacked.isChecked(), false, 'The choice expiry restores the real Host selection');
  await textPreview.waitFor({ state: 'detached' });
  assert.equal(await note.inputValue(), 'Bring a camera.', 'Text expiry restores the real Host value');

  await save.click();
  await page.waitForTimeout(300);
  await save.click();
  await page.waitForTimeout(800);
  assert.equal(await buttonPreview.count(), 1, 'Repeated Save input renews the Host pressed-state preview');
  assert.equal(await halos.count(), 1, 'Each click halo expires independently of a renewed button preview');
  await assertOriginal();
  await page.waitForFunction(() => document.querySelectorAll('.demo-click-halo, .demo-button-preview').length === 0);

  await guestHeader.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    for (let index = 0; index < 20; index += 1) {
      const options = { bubbles: true, pointerId: index + 1, isPrimary: true, button: 0, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 };
      element.dispatchEvent(new PointerEvent('pointerdown', options));
      element.dispatchEvent(new PointerEvent('pointerup', options));
    }
  });
  assert.equal(await halos.count(), 12, 'Rapid Guest gestures keep Host feedback bounded to twelve halos');
  await page.waitForFunction(() => document.querySelectorAll('.demo-click-halo').length === 0);
  await note.fill('Reset this visual text.');
  await guestPacked.check();
  await save.click();
  await reset.click();
  assert.equal(await overlays.count(), 0, 'Reset clears active text, choice and button overlays');
  assert.equal(await halos.count(), 0, 'Reset clears active Host click feedback');
  await page.waitForTimeout(1100);
  assert.equal(await note.inputValue(), 'Bring a camera.', 'Cleared expiry timers cannot overwrite the reset state');
  await assertOriginal();
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
  // Start the capture with this preference already active. Rapid media changes
  // during the interaction checks can otherwise race the video's playing event.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1, name: 'Browse together.' }).waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.hero-scene img')).opacity === '1');
  for (const element of await page.locator('[data-reveal], .install-title').all()) await element.scrollIntoViewIfNeeded();
  await scrollToTop(page);
  await settleFrames(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  if (name === 'desktop' || name === 'mobile') {
    const bounds = await page.locator('.hero').boundingBox();
    await page.screenshot({ path: resolve(output, `${name}-hero.png`), clip: { x: 0, y: 0, width, height: Math.ceil(bounds.y + bounds.height) } });
    await page.locator('#preview-host').evaluate(element => element.click());
    await settleFrames(page);
    await page.locator('.preview-switch').screenshot({ path: resolve(output, `${name}-preview-switch.png`) });
    for (const choice of choices) {
      await page.locator(`#preview-${choice}`).evaluate(element => element.click());
      await settleFrames(page);
      await page.locator('.product-preview').screenshot({ path: resolve(output, `${name}-preview-${choice}.png`) });
    }
    try {
      const note = page.getByRole('textbox', { name: 'Guest note', exact: true });
      const checkbox = page.locator('#guest-pack');
      const save = page.getByRole('button', { name: 'Save plans', exact: true });
      await note.fill('Bring a camera and a map.');
      await checkbox.check();
      await save.click();
      await page.locator('.mode-demo').screenshot({ path: resolve(output, `${name}-mode-visual.png`), animations: 'allow' });
      await page.locator('label[for="mode-live"]').click();
      await note.fill('Bring a camera and a map.');
      await checkbox.check();
      await save.click();
      await page.locator('.mode-demo').screenshot({ path: resolve(output, `${name}-mode-live.png`), animations: 'allow' });
    } finally {
      await page.getByRole('button', { name: 'Reset demonstration', exact: true }).click();
    }
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
  browser = await launchHeadlessBrowser();
  if (!pagesOnly) await inspectHeroFallbacks(browser, url);
  if (screenshots) await mkdir(output, { recursive: true });
  for (const [width, height, name] of pagesOnly ? [] : viewports) {
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
  await inspectWebsitePages({ browser, url, origin, docs, output, screenshots });
  const fonts = [...requests].filter(url => /\.woff2(?:\?|$)/.test(url));
  if (!pagesOnly) assert.ok(fonts.length, 'The self-hosted display font was requested');
  assert.ok(fonts.every(url => url.startsWith(`${origin}${base}assets/landing/`)), 'All display fonts load from this site');
  for (const request of requests) {
    const asset = new URL(request);
    if (asset.origin === origin) assert.ok(asset.pathname.startsWith(base), `Request escapes the GitHub Pages base: ${request}`);
  }
  const privacy = await fetch(`${origin}${base}privacy.html`);
  assert.equal(privacy.status, 200, 'Existing privacy document is preserved');
  assert.equal(await privacy.text(), await readFile(resolve(docs, 'privacy.html'), 'utf8'));
  assert.deepEqual(errors, [], 'No browser or resource errors');
  process.stdout.write(`${pagesOnly ? 'Website page QA passed: 5 viewports, installation guide, local guided demo, query navigation and focus, permission and interaction states, reduced motion, and project-relative assets.' : 'Site QA passed: 5 viewports, installation guide, local guided demo, query navigation and focus, keyboard/click previews, original product assets, interaction modes and save feedback, video playback/suspension/fallbacks, reduced motion, project-relative assets, and self-hosted fonts.'} JavaScript: ${(gzipBytes / 1024).toFixed(1)} KiB gzip.${screenshots ? ` Review captures: ${output}` : ''}\n`);
} finally {
  await browser?.close();
  await server.close();
}
