import type { LanguagePreference, Locale } from '@ghostpair/protocol';

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'auto' || value === 'en' || value === 'es';
}

export function resolveLocale(preference: LanguagePreference, browserLanguage?: string): Locale {
  if (preference !== 'auto') return preference;
  const language = browserLanguage ?? (globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.navigator?.language || 'en');
  return /^es(?:[-_]|$)/i.test(language.trim()) ? 'es' : 'en';
}

export function browserLocale(): Locale { return resolveLocale('auto'); }
