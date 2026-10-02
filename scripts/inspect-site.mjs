import assert from 'node:assert/strict';
import { access, mkdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = resolve(root, 'docs');
const output = resolve(root, '.impeccable/review');
const base = '/GhostPair/';
const screenshots = !process.argv.includes('--check-only');
const server = await createServer({ configFile: false, root: docs, base, server: { host: '127.0.0.1', port: 0 } });
let browser;

try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}${base}`;
  browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  if (screenshots) await mkdir(output, { recursive: true });

  for (const [width, height, name] of [[1440, 1000, 'desktop'], [768, 1024, 'tablet'], [390, 844, 'mobile'], [375, 812, null]]) {
    await page.setViewportSize({ width, height });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: horizontal overflow`);

    const choices = ['shared', 'host', 'guest'];
    const labels = ['Shared view', 'Host a session', 'Join a session'];
    for (const [index, choice] of choices.entries()) {
      assert.equal(await page.getByRole('radio', { name: labels[index], exact: true }).getAttribute('id'), `preview-${choice}`);
    }
    const shared = page.getByRole('radio', { name: labels[0], exact: true });
    assert.ok(await shared.isChecked(), 'Shared view is the default');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('#shared-preview').evaluate(el => getComputedStyle(el).animationName), 'none', 'Reduced motion disables preview reveals');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await shared.focus();

    for (const choice of ['shared', 'host', 'guest', 'shared']) {
      assert.ok(await page.locator(`#preview-${choice}`).isChecked(), `${width}px: ${choice} selected by keyboard`);
      for (const panel of choices) {
        assert.equal(await page.locator(`#${panel}-preview`).isVisible(), panel === choice, `${width}px: ${panel} panel visibility`);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: ${choice} preview horizontal overflow`);
      await page.waitForFunction(() => [...document.querySelectorAll('.preview-stage')].filter(stage => stage.getBoundingClientRect().width > 0).every(stage => {
        const frame = stage.querySelector('iframe');
        const stageRect = stage.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        return Math.abs(stageRect.width - frameRect.width) < 1 && frameRect.height <= stageRect.height + 1;
      }));
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('ArrowLeft');
    assert.ok(await shared.isChecked(), 'ArrowLeft restores the shared view');
    assert.ok(await page.locator('#shared-preview').isVisible());

    for (const frame of page.frames()) {
      const assets = await frame.evaluate(() => [...document.querySelectorAll('[src], [href]')].flatMap(element => ['src', 'href'].filter(attribute => element.hasAttribute(attribute)).map(attribute => new URL(element.getAttribute(attribute), document.baseURI).href)));
      for (const asset of new Set(assets)) {
        const local = new URL(asset);
        if (local.origin !== new URL(url).origin) continue;
        if (local.pathname === `${base}@vite/client`) continue;
        assert.ok(local.pathname.startsWith(base), `Asset escapes GitHub Pages project path: ${asset}`);
        const path = resolve(docs, decodeURIComponent(local.pathname.slice(base.length)) || 'index.html');
        assert.ok(path.startsWith(docs + sep), `Asset escapes docs: ${asset}`);
        await access(path);
      }
      assert.ok(await frame.evaluate(() => [...document.images].every(image => image.complete && image.naturalWidth > 0)), `${width}px: missing image in ${frame.url()}`);
    }
    assert.deepEqual(errors, [], `${width}px: browser errors`);
    if (screenshots && name) await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  }
  process.stdout.write(`Site QA passed: 4 viewports, native keyboard selection, preview scaling, local assets, and no browser errors.${screenshots ? ` Screenshots: ${output}` : ''}\n`);
} finally {
  await browser?.close();
  await server.close();
}
