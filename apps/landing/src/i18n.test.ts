import { expect, it } from 'vitest';
import { resolveLocale, translate, validPreference } from './i18n';
import { spanish } from './messages';
it('detects regional Spanish, honors manual preferences and falls back to English', () => {
  for (const language of ['es', 'es-CO', 'es-ES']) expect(resolveLocale('auto', language)).toBe('es');
  for (const language of ['en-US', 'fr', '']) expect(resolveLocale('auto', language)).toBe('en');
  expect(resolveLocale('en', 'es')).toBe('en'); expect(resolveLocale('es', 'en')).toBe('es');
  expect(validPreference(null)).toBe(false); expect(validPreference('es-CO')).toBe(false);
});
it('preserves sentence spacing, user values and translation placeholders', () => {
  expect(translate('es', ' and ')).toBe(' y ');
  expect(translate('es', 'Close {title} tab {id}', { title: 'A < B {title}', id: 3 })).toBe('Cerrar pestaña 3: A < B {title}');
  expect(translate('en', 'Home')).toBe('Home');
  for (const [source, target] of Object.entries(spanish)) {
    expect(target.trim()).not.toBe('');
    expect([...target.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort()).toEqual([...source.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort());
  }
});
