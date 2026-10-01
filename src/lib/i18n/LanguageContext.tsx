import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { translate } from '@/lib/i18n';
import {
  DEFAULT_LOCALE,
  LOCALE_CHOSEN_KEY,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  type Locale,
} from '@/lib/i18n/types';

export interface LanguageContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  hasChosen: boolean;
  markChosen: () => void;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function readInitialLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

function readChosen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LOCALE_CHOSEN_KEY) === '1';
  } catch {
    return false;
  }
}

function applyLocale(locale: Locale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale === 'ko' ? 'ko' : 'en';
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore persistence failure; UI still switches
  }
}

if (typeof document !== 'undefined') {
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    document.documentElement.lang = saved === 'en' ? 'en' : 'ko';
  } catch {
    document.documentElement.lang = 'ko';
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);
  const [hasChosen, setHasChosen] = useState<boolean>(readChosen);

  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  // Sync from Settings DB once it loads (DB is source of truth across restarts).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getSettings } = await import('@/lib/db/repositories/settingsRepo');
        const loaded = await getSettings();
        if (cancelled) return;
        const dbLocale = normalizeLocale(loaded.language);
        const localRaw =
          typeof window !== 'undefined'
            ? window.localStorage.getItem(LOCALE_STORAGE_KEY)
            : null;
        // If user already chose in this browser, local wins; otherwise adopt DB value.
        if (localRaw === 'ko' || localRaw === 'en') {
          if (normalizeLocale(localRaw) !== dbLocale) {
            const { updateSettings } = await import(
              '@/lib/db/repositories/settingsRepo'
            );
            await updateSettings({ language: normalizeLocale(localRaw) });
          }
          setLocaleState(normalizeLocale(localRaw));
        } else {
          setLocaleState(dbLocale);
          applyLocale(dbLocale);
        }
      } catch {
        // DB unavailable (e.g. tests); localStorage value stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    applyLocale(next);
    // Persist to DB (fire-and-forget; localStorage already updated).
    void (async () => {
      try {
        const { updateSettings } = await import('@/lib/db/repositories/settingsRepo');
        await updateSettings({ language: next });
      } catch {
        // ignore; local state + localStorage already reflect the choice
      }
    })();
  }, []);

  const markChosen = useCallback(() => {
    setHasChosen(true);
    try {
      window.localStorage.setItem(LOCALE_CHOSEN_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translate(locale, key, params),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, hasChosen, markChosen }),
    [locale, setLocale, t, hasChosen, markChosen],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}
