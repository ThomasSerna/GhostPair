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
    const state = { role: null, status: 'idle', paused: false, controlEnabled: true, clipboardEnabled: false, remoteClipboardEnabled: false, tabs: [], generation: 0, settings: { signalingUrl: 'http://127.0.0.1:8787', stunUrls: ['stun:stun.example.com:3478'] } };
    const noEvent = { addListener() {}, removeListener() {} };
    globalThis.chrome = {
      runtime: { id: 'a'.repeat(32), onMessage: noEvent, sendMessage: async () => ({ ok: true, state }), getURL: p => `http://127.0.0.1:5193/${p}`, connect: () => ({ onMessage: noEvent, onDisconnect: noEvent, postMessage() {}, disconnect() {} }) },
      permissions: { request: async () => true }, tabs: { create: async () => ({}) },
    };
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5193/popup.html');
  await page.getByRole('button', { name: 'Iniciar sesión compartida' }).waitFor();
  await page.screenshot({ path: resolve(output, 'popup.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Conectarse' }).click();
  await page.screenshot({ path: resolve(output, 'join.png'), fullPage: true });
  await page.getByRole('button', { name: 'Abrir configuración' }).click();
  await page.screenshot({ path: resolve(output, 'settings.png'), fullPage: true });
  await page.setViewportSize({ width: 1365, height: 850 });
  await page.goto('http://127.0.0.1:5193/viewer.html');
  await page.getByText('La sesión ha terminado.').waitFor();
  await page.screenshot({ path: resolve(output, 'viewer.png'), fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  process.stdout.write(`Visual QA: 4 screenshots, no page errors. ${output}\n`);
} finally { await browser?.close(); await server.close(); }
