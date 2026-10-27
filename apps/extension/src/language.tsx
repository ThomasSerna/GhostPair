import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { Locale } from '@ghostpair/protocol';
import { translator } from './messages';

const LanguageContext = createContext<Locale>('en');

export function LanguageProvider({ locale, title = 'GhostPair', children }: { locale: Locale; title?: string; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = title;
  }, [locale, title]);
  return <LanguageContext value={locale}>{children}</LanguageContext>;
}

export function useLocale() { return useContext(LanguageContext); }
export function useTranslation() { return translator(useLocale()); }
