import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserLocale, isLanguagePreference, resolveLocale } from './locale';

afterEach(() => vi.unstubAllGlobals());

describe('extension language resolution', () => {
  it.each([['es', 'es'], ['es-CO', 'es'], ['es-ES', 'es'], ['ES-mx', 'es'], ['en', 'en'], ['en-US', 'en'], ['fr-FR', 'en'], ['', 'en']])('resolves browser UI %s to %s', (language, expected) => {
    expect(resolveLocale('auto', language)).toBe(expected);
  });

  it('uses the browser UI language rather than web content preferences', () => {
    vi.stubGlobal('chrome', { i18n: { getUILanguage: () => 'es-CO' } });
    vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });
    expect(browserLocale()).toBe('es');
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('es', 'en-US')).toBe('es');
    expect(resolveLocale('auto')).toBe('es');
  });

  it('falls back to navigator only when the UI language is unavailable', () => {
    vi.stubGlobal('chrome', {});
    vi.stubGlobal('navigator', { language: 'es-ES' });
    expect(browserLocale()).toBe('es');
    vi.stubGlobal('chrome', { i18n: { getUILanguage: () => 'fr-FR' } });
    expect(browserLocale()).toBe('en');
    vi.stubGlobal('chrome', { i18n: { getUILanguage: () => '' } });
    expect(browserLocale()).toBe('es');
    vi.stubGlobal('navigator', undefined);
    expect(browserLocale()).toBe('en');
  });

  it('accepts only supported preferences', () => {
    for (const preference of ['auto', 'en', 'es']) expect(isLanguagePreference(preference)).toBe(true);
    for (const preference of [undefined, null, 'es-CO', 'fr', '', {}, 1]) expect(isLanguagePreference(preference)).toBe(false);
  });
});
