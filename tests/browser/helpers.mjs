import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';

export const artifactRoot = resolve('tests/browser/.artifacts');
export const browsers = {
  chrome: process.env.GHOSTPAIR_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  edge: process.env.GHOSTPAIR_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
};

export async function removeTestArtifact(profile) {
  const target = resolve(profile);
  const within = relative(artifactRoot, target);
  if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('Refusing to delete a profile outside the test artifact directory.');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

export async function closeBrowser(launched) {
  if (!launched) return;
  if (launched.nativeProcess) {
    await launched.cdp.send('Browser.close').catch(() => undefined);
    await stopNative(launched.nativeProcess);
  }
  await launched.context.close();
  await removeTestArtifact(launched.profile);
}

async function stopNative(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill(), 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

/** Only launches new test profiles. Never connects to an existing browser. */
export async function launchExtension(name, extensionPath, { nativeVisibility = false } = {}) {
  await mkdir(artifactRoot, { recursive: true });
  const profile = await mkdtemp(resolve(artifactRoot, `${name}-profile-`));
  // A fresh Edge profile can otherwise sign in automatically using Windows.
  // These preferences belong only to this disposable test profile.
  await mkdir(resolve(profile, 'Default'));
  await writeFile(resolve(profile, 'Default/Preferences'), JSON.stringify({ signin: { allowed: false, allowed_on_next_startup: false } }));
  let nativeProcess, context;
  if (nativeVisibility) {
    // connectOverCDP(noDefaults) is the public API for retaining native focus and
    // visibility. Normal Playwright launch forces focus on every attached page.
    nativeProcess = spawn(browsers[name], [...(process.env.GHOSTPAIR_HEADED === '1' ? [] : ['--headless=new']), '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--disable-sync', '--disable-background-networking', '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', '--window-size=1100,860', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    let launchError; nativeProcess.once('error', error => { launchError = error; });
    try {
      const port = await poll(async () => {
        if (launchError) throw launchError;
        const text = await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
        // Edge can relaunch itself through its compatibility layer, exiting the
        // bootstrap process successfully before the replacement writes this file.
        if (!text && nativeProcess.exitCode !== null && nativeProcess.exitCode !== 0) throw new Error(`Isolated browser exited before CDP was available (${nativeProcess.exitCode}).`);
        return Number(text.split('\n')[0]) || false;
      }, 'isolated native browser endpoint');
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
      context = browser.contexts()[0];
    } catch (error) { nativeProcess.kill(); await removeTestArtifact(profile); throw error; }
  } else context = await chromium.launchPersistentContext(profile, {
    executablePath: browsers[name],
    headless: process.env.GHOSTPAIR_HEADED !== '1',
    // Native viewport dimensions must agree with the captured tab's geometry.
    viewport: null,
    // Visual inspection does not opt into Playwright's automation-only toolbar banner.
    // Native capture and extension debugging indicators keep their normal behavior.
    ignoreDefaultArgs: ['--disable-extensions', ...(process.env.GHOSTPAIR_INSPECT === '1' ? ['--enable-automation'] : [])],
    // CDP's official test-only install API requires this in an isolated process.
    // No flag suppresses the browser's debugger warning or sharing indicators.
    args: ['--enable-unsafe-extension-debugging', '--window-size=1100,860'],
  });
  try {
    context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(30000);
    const cdp = await context.browser().newBrowserCDPSession();
    const version = await cdp.send('Browser.getVersion');
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve(extensionPath) });
    const worker = context.serviceWorkers().find((entry) => entry.url().startsWith(`chrome-extension://${id}/`))
      ?? await context.waitForEvent('serviceworker', {
        predicate: (entry) => entry.url().startsWith(`chrome-extension://${id}/`),
        timeout: 15000,
      });
    return { context, cdp, worker, id, version: version.product, profile, nativeProcess };
  } catch (error) {
    await context.close();
    if (nativeProcess) await stopNative(nativeProcess);
    await removeTestArtifact(profile);
    throw error;
  }
}

export async function poll(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}

export async function resizePage(browser, page, width, height) {
  const { targetInfos } = await browser.cdp.send('Target.getTargets');
  const target = targetInfos.find(target => target.type === 'page' && target.url === page.url());
  if (!target) throw new Error('Test page has no browser target');
  const { windowId } = await browser.cdp.send('Browser.getWindowForTarget', { targetId: target.targetId });
  for (let attempt = 0; attempt < 6; attempt++) {
    const { bounds } = await browser.cdp.send('Browser.getWindowBounds', { windowId });
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    if (Math.abs(width - viewport.width) <= 1 && Math.abs(height - viewport.height) <= 1) return;
    await browser.cdp.send('Browser.setWindowBounds', { windowId, bounds: {
      width: bounds.width + width - viewport.width,
      height: bounds.height + height - viewport.height,
    } });
    // Visible Windows frames may settle in more than one layout pass.
    await new Promise(done => setTimeout(done, 250));
  }
  const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  throw new Error(`Native viewport did not reach ${width}x${height}: ${JSON.stringify(actual)}`);
}
