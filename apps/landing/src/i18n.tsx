import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { spanish } from './messages';
export type Locale = 'en' | 'es';
export type Preference = 'auto' | Locale;
export const languageKey = 'ghostpair.website.language';
export const validPreference = (value: unknown): value is Preference => value === 'auto' || value === 'en' || value === 'es';
export function resolveLocale(preference: Preference, browserLanguage: string): Locale {
  return preference === 'auto' ? (/^es(?:[-_]|$)/i.test(browserLanguage) ? 'es' : 'en') : preference;
}
export function translate(locale: Locale, message: string, values: Record<string, string | number> = {}): string {
  const content = message.trim();
  const translated = locale === 'es' && Object.hasOwn(spanish, content) ? spanish[content as keyof typeof spanish] : content;
  return (message.slice(0, message.indexOf(content)) + translated + message.slice(message.indexOf(content) + content.length)).replace(/\{(\w+)\}/g, (placeholder, key: string) => String(values[key] ?? placeholder));
}
const LanguageContext = createContext({ preference: 'auto' as Preference, locale: 'en' as Locale, browserLocale: 'en' as Locale, error: '', setPreference: (_value: Preference) => {}, t: (message: string, _values?: Record<string, string | number>) => message });
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [preference, setValue] = useState<Preference>(() => {
    try { const saved = localStorage.getItem(languageKey); return validPreference(saved) ? saved : 'auto'; } catch { return 'auto'; }
  });
  const [browserLanguage, setBrowserLanguage] = useState(() => navigator.language);
  const [error, setError] = useState('');
  const browserLocale = resolveLocale('auto', browserLanguage);
  const locale = resolveLocale(preference, browserLanguage);
  const t = useCallback((message: string, values?: Record<string, string | number>) => translate(locale, message, values), [locale]);
  useLayoutEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    const languageChanged = () => setBrowserLanguage(navigator.language);
    const stored = (event: StorageEvent) => { if (event.key === languageKey || event.key === null) { setValue(validPreference(event.newValue) ? event.newValue : 'auto'); setError(''); } };
    window.addEventListener('languagechange', languageChanged); window.addEventListener('storage', stored);
    return () => { window.removeEventListener('languagechange', languageChanged); window.removeEventListener('storage', stored); };
  }, []);
  function setPreference(value: Preference) {
    if (!validPreference(value)) return;
    try { localStorage.setItem(languageKey, value); setValue(value); setError(''); }
    catch { setError('Could not save the language. Try again.'); }
  }
  return <LanguageContext value={{ preference, locale, browserLocale, setPreference, error, t }}>{children}</LanguageContext>;
}
export function useLanguage() { return useContext(LanguageContext); }
export function useTranslation() { return useLanguage().t; }
