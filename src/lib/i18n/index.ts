import ko from './dictionaries/ko';
import en from './dictionaries/en';
import type { Dict } from './dictionaries/ko';
import type { Locale } from './types';

const tables: Record<Locale, Dict> = { ko, en };

export function getDictionary(locale: Locale): Dict {
  return tables[locale] ?? ko;
}

export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const table = getDictionary(locale);
  const fallback = getDictionary('ko');
  let template = table[key] ?? fallback[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      template = template.replaceAll(`{${k}}`, String(v));
    }
  }
  return template;
}

export type { Dict };
export { ko, en };
