export type Locale = 'ko' | 'en';

export const SUPPORTED_LOCALES: readonly Locale[] = ['ko', 'en'] as const;

export const DEFAULT_LOCALE: Locale = 'ko';

export const LOCALE_STORAGE_KEY = 'vanilla-commander-locale';
export const LOCALE_CHOSEN_KEY = 'vanilla-commander-locale-chosen';

export function isLocale(value: unknown): value is Locale {
  return value === 'ko' || value === 'en';
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
