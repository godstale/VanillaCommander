const HANGUL_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/u;
const LATIN_RE = /[A-Za-z\u00C0-\u00FF\u0100-\u024F]/u;
const HAN_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
const KANA_RE = /[\u3040-\u309F\u30A0-\u30FF\uFF61-\uFF9F]/u;
const CYRILLIC_RE = /[\u0400-\u04FF\u0500-\u052F]/u;
const ARABIC_RE = /[\u0600-\u06FF]/u;
const DEVANAGARI_RE = /[\u0900-\u097F]/u;
const THAI_RE = /[\u0E00-\u0E7F]/u;
const GREEK_RE = /[\u0370-\u03FF]/u;
const HEBREW_RE = /[\u0590-\u05FF]/u;
const LETTER_RE = /\p{L}/u;

export type ScriptKey =
  | 'hangul'
  | 'latin'
  | 'han'
  | 'kana'
  | 'cyrillic'
  | 'arabic'
  | 'devanagari'
  | 'thai'
  | 'greek'
  | 'hebrew'
  | 'other';

export interface ScriptCounts {
  hangul: number;
  latin: number;
  han: number;
  kana: number;
  cyrillic: number;
  arabic: number;
  devanagari: number;
  thai: number;
  greek: number;
  hebrew: number;
  other: number;
  totalLetters: number;
}

function emptyCounts(): ScriptCounts {
  return {
    hangul: 0,
    latin: 0,
    han: 0,
    kana: 0,
    cyrillic: 0,
    arabic: 0,
    devanagari: 0,
    thai: 0,
    greek: 0,
    hebrew: 0,
    other: 0,
    totalLetters: 0,
  };
}

export function classifyScript(char: string): ScriptKey | null {
  if (HANGUL_RE.test(char)) return 'hangul';
  if (LATIN_RE.test(char)) return 'latin';
  if (HAN_RE.test(char)) return 'han';
  if (KANA_RE.test(char)) return 'kana';
  if (CYRILLIC_RE.test(char)) return 'cyrillic';
  if (ARABIC_RE.test(char)) return 'arabic';
  if (DEVANAGARI_RE.test(char)) return 'devanagari';
  if (THAI_RE.test(char)) return 'thai';
  if (GREEK_RE.test(char)) return 'greek';
  if (HEBREW_RE.test(char)) return 'hebrew';
  if (LETTER_RE.test(char)) return 'other';
  return null;
}

export function countScripts(text: string): ScriptCounts {
  const counts = emptyCounts();
  for (const char of text) {
    const key = classifyScript(char);
    if (key === null) continue;
    counts[key] += 1;
    counts.totalLetters += 1;
  }
  return counts;
}

export function scriptRatio(text: string, script: ScriptKey): number {
  const counts = countScripts(text);
  if (counts.totalLetters === 0) return 0;
  return counts[script] / counts.totalLetters;
}

export function countWords(text: string): number {
  const tokens = text.split(/\s+/).filter((token) => token.length > 0);
  return tokens.length;
}

const SENTENCE_SPLIT_RE = /[.!?…。！？]+\s*|\n+/u;

export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
}

export function countSentences(text: string): number {
  return splitSentences(text).length;
}

const FENCED_CODE_RE = /```[\s\S]*?```/g;

export function splitParagraphs(text: string): string[] {
  const withoutCode = text.replace(FENCED_CODE_RE, '');
  return withoutCode
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const NON_LETTER_EDGE_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function tokenizeWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.replace(NON_LETTER_EDGE_RE, ''))
    .filter((token) => token.length > 0);
}

export function countCapitalWords(text: string): number {
  let count = 0;
  for (const token of tokenizeWords(text)) {
    if (!/[\p{Lu}]/u.test(token)) continue;
    if (/[\p{Ll}]/u.test(token)) continue;
    count += 1;
  }
  return count;
}

export function isAllUpperEnglish(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (!/[A-Z]/.test(trimmed)) return false;
  return !/[a-z]/.test(trimmed);
}

export function isAllLowerEnglish(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (!/[a-z]/.test(trimmed)) return false;
  return !/[A-Z]/.test(trimmed);
}

export function stripFirstLine(text: string): string {
  const index = text.indexOf('\n');
  return index === -1 ? '' : text.slice(index + 1);
}

export function stripLastLine(text: string): string {
  const index = text.lastIndexOf('\n');
  return index === -1 ? '' : text.slice(0, index);
}

export function removeAsterisks(text: string): string {
  return text.replace(/\*/g, '');
}
