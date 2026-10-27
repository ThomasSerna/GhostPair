import assert from 'node:assert/strict';
import { copyTestExtension, launchExtension, closeBrowser, removeTestArtifact, callBackground as call } from './helpers.mjs';

const extension = await copyTestExtension('language-extension-');
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'edge'];
try {
  for (const name of names) {
    for (const locale of ['en-US', 'es-CO']) {
      let browser;
      try {
        browser = await launchExtension(name, extension, { locale, nativeVisibility: locale === 'es-CO' });
        const browserLanguage = await browser.worker.evaluate(() => chrome.i18n.getUILanguage());
        const expected = locale.startsWith('es') ? 'es' : 'en';
        assert.ok(browserLanguage.startsWith(expected), `browser UI language follows ${locale}: ${browserLanguage}`);
        const popup = await browser.context.newPage(); await popup.goto(`chrome-extension://${browser.id}/popup.html`);
        const initial = await call(popup, 'ui.status');
        assert.equal(initial.languagePreference, 'auto'); assert.equal(initial.locale, expected);
        await popup.waitForFunction(language => document.documentElement.lang === language, expected);
        await popup.getByRole('button', { name: expected === 'es' ? 'Compartir mi pestaña' : 'Share my tab', exact: true }).waitFor();
        assert.equal(await popup.getByRole('dialog').count(), 0, 'first use has no language prompt');
        const viewer = await browser.context.newPage(); await viewer.goto(`chrome-extension://${browser.id}/viewer.html`);
        await viewer.waitForFunction(language => document.documentElement.lang === language, expected);
        await popup.bringToFront();
        await popup.getByRole('button', { name: expected === 'es' ? 'Abrir configuración' : 'Open settings' }).click();
        const manual = expected === 'es' ? 'en' : 'es';
        await popup.getByLabel(expected === 'es' ? 'Idioma' : 'Language', { exact: true }).selectOption(manual);
        await popup.waitForFunction(language => document.documentElement.lang === language, manual);
        await viewer.waitForFunction(language => document.documentElement.lang === language, manual);
        const changed = await call(popup, 'ui.status');
        assert.equal(changed.languagePreference, manual); assert.equal(changed.locale, manual);
        assert.equal(changed.deviceId, initial.deviceId);
        assert.deepEqual(changed.settings, initial.settings); assert.deepEqual(changed.visualPreferences, initial.visualPreferences);
        assert.equal(await browser.worker.evaluate(async () => (await chrome.storage.local.get('languagePreference')).languagePreference), manual);
        await popup.reload();
        await popup.waitForFunction(language => document.documentElement.lang === language, manual);
        await popup.getByRole('button', { name: manual === 'es' ? 'Abrir configuración' : 'Open settings' }).click();
        assert.equal(await popup.getByLabel(manual === 'es' ? 'Idioma' : 'Language', { exact: true }).inputValue(), manual, 'manual preference survives reopening');
        await popup.getByLabel(manual === 'es' ? 'Idioma' : 'Language', { exact: true }).selectOption('auto');
        await popup.waitForFunction(language => document.documentElement.lang === language, expected);
        await viewer.waitForFunction(language => document.documentElement.lang === language, expected);
        assert.equal((await call(popup, 'ui.status')).languagePreference, 'auto');
        assert.equal((await call(popup, 'ui.status')).locale, expected);
        assert.equal(await popup.getByLabel(expected === 'es' ? 'Idioma' : 'Language', { exact: true }).inputValue(), 'auto');
        assert.ok(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'language settings have no horizontal overflow');
        assert.equal(await popup.evaluate(() => chrome.runtime.getManifest().description.startsWith('Comparte')), expected === 'es', 'manifest metadata follows the browser language');
        process.stdout.write(`${JSON.stringify({ browser: name, browserLanguage, automatic: expected, manual, persistence: true, sharedViews: true, nativeVisibility: locale === 'es-CO' })}\n`);
      } finally { await closeBrowser(browser); }
    }
  }
} finally { await removeTestArtifact(extension); }
