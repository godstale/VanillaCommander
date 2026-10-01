export interface Extraction {
  value: string;
  rule: string;
}

const THINK_BLOCK = /<(think|thinking)>[\s\S]*?<\/\1>/gi;
const ANSWER_LINE = /(?:정답|답|answer|ANSWER)\s*[:：]\s*(.+)$/im;
const PAREN_CHOICE = /\(([A-J])\)/;
const STANDALONE_LETTER = /(?:^|[\s("'])([A-J])(?=[\s).,"']|$)/g;
const BOXED = /\\boxed\{([^}]*)\}/;
const HASH4 = /####\s*(.+)$/m;
const NUMBER = /-?\d[\d,]*\.?\d*%?/g;

export function stripThinking(text: string): string {
  return text.replace(THINK_BLOCK, ' ').trim();
}

export function extractAnswerLine(text: string): Extraction | null {
  const m = ANSWER_LINE.exec(text);
  if (!m) return null;
  return { value: m[1].trim(), rule: 'answer_line' };
}

export function extractParenChoice(text: string): Extraction | null {
  const m = PAREN_CHOICE.exec(text);
  if (!m) return null;
  return { value: m[1], rule: 'paren' };
}

export function extractLastLetter(text: string, letters = 'ABCDEFGHIJ'): Extraction | null {
  let last: Extraction | null = null;
  let m: RegExpExecArray | null;
  STANDALONE_LETTER.lastIndex = 0;
  while ((m = STANDALONE_LETTER.exec(text)) !== null) {
    if (letters.includes(m[1])) last = { value: m[1], rule: 'last_letter' };
  }
  return last;
}

export function extractFirstLetter(text: string, letters = 'ABCDEFGHIJ'): Extraction | null {
  STANDALONE_LETTER.lastIndex = 0;
  const m = STANDALONE_LETTER.exec(text);
  if (!m || !letters.includes(m[1])) return null;
  return { value: m[1], rule: 'first_letter' };
}

export function extractBoxed(text: string): Extraction | null {
  const m = BOXED.exec(text);
  if (!m) return null;
  return { value: m[1].trim(), rule: 'boxed' };
}

export function extractHash4(text: string): Extraction | null {
  const m = HASH4.exec(text);
  if (!m) return null;
  return { value: m[1].trim(), rule: 'hash4' };
}

export function extractLastNumber(text: string): Extraction | null {
  NUMBER.lastIndex = 0;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = NUMBER.exec(text)) !== null) {
    last = m[0];
  }
  if (last === null) return null;
  return { value: last, rule: 'last_number' };
}

export type ChoiceExtractRule = 'answer_line' | 'paren' | 'last_letter' | 'first_letter';
export type NumericExtractRule = 'boxed' | 'answer_line' | 'hash4' | 'last_number';

export function letterFromExtraction(ext: Extraction): string | null {
  const lineLetter = /\(?([A-J])\)?\s*$/.exec(ext.value.trim());
  if (lineLetter) return lineLetter[1];
  const first = ext.value.trim().charAt(0);
  if (/[A-J]/.test(first)) return first;
  // circled digits ①-⑩ → A-J
  const circled = ext.value.trim().codePointAt(0);
  if (circled !== undefined && circled >= 0x2460 && circled <= 0x2469) {
    return String.fromCharCode(0x41 + circled - 0x2460);
  }
  return null;
}
