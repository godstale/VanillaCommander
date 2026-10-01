import {
  fail,
  registerChecker,
  strArg,
  type CheckerOutcome,
} from '../registry';
import { countScripts } from '../textUtils';

const LANGUAGE_SCRIPT: Record<string, 'hangul' | 'latin' | 'han' | 'japanese' | 'cyrillic' | 'arabic' | 'devanagari' | 'thai' | 'greek' | 'hebrew'> = {
  en: 'latin',
  fr: 'latin',
  de: 'latin',
  es: 'latin',
  it: 'latin',
  pt: 'latin',
  nl: 'latin',
  ko: 'hangul',
  zh: 'han',
  ja: 'japanese',
  ru: 'cyrillic',
  uk: 'cyrillic',
  bg: 'cyrillic',
  ar: 'arabic',
  hi: 'devanagari',
  th: 'thai',
  el: 'greek',
  he: 'hebrew',
};

const THRESHOLD = 0.6;

export function responseLanguage(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const language = strArg(kwargs, 'language');
  if (language === undefined || language.length === 0) {
    return fail('invalid kwargs: language string required');
  }
  const script = LANGUAGE_SCRIPT[language.toLowerCase()];
  if (script === undefined) {
    return fail(`unsupported language "${language}" for script-ratio heuristic`);
  }
  const counts = countScripts(text);
  if (counts.totalLetters === 0) {
    return fail('empty response: no letters for script-ratio heuristic');
  }
  const matched =
    script === 'japanese'
      ? counts.han + counts.kana
      : counts[script];
  const ratio = matched / counts.totalLetters;
  const pass = ratio >= THRESHOLD;
  return {
    pass,
    detail:
      `script-ratio heuristic: ${script} ratio ${ratio.toFixed(2)} ` +
      `(threshold ${THRESHOLD}, language ${language})`,
  };
}

registerChecker('language:response_language', responseLanguage);
