import {
  checkRelation,
  fail,
  numArg,
  registerChecker,
  relationArg,
  strArg,
  strArrayArg,
  type CheckerOutcome,
} from '../registry';

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return count;
    count += 1;
    from = index + needle.length;
  }
}

export function keywordsExistence(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const keywords = strArrayArg(kwargs, 'keywords');
  if (keywords === undefined || keywords.length === 0) {
    return fail('invalid kwargs: keywords string[] required');
  }
  const lowered = text.toLowerCase();
  const missing = keywords.filter(
    (keyword) => !lowered.includes(keyword.toLowerCase()),
  );
  if (missing.length > 0) {
    return { pass: false, detail: `missing keywords: ${missing.join(', ')}` };
  }
  return { pass: true, detail: `all ${keywords.length} keywords present` };
}

export function keywordsFrequency(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const keyword = strArg(kwargs, 'keyword');
  const frequency = numArg(kwargs, 'frequency');
  const relation = relationArg(kwargs, 'relation');
  if (keyword === undefined || frequency === undefined || relation === undefined) {
    return fail('invalid kwargs: keyword, frequency, relation required');
  }
  const count = countOccurrences(text.toLowerCase(), keyword.toLowerCase());
  const pass = checkRelation(count, frequency, relation);
  return {
    pass,
    detail: `keyword occurs ${count}x, expected ${relation} ${frequency}x`,
  };
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function forbiddenWords(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const words = strArrayArg(kwargs, 'forbidden_words');
  if (words === undefined || words.length === 0) {
    return fail('invalid kwargs: forbidden_words string[] required');
  }
  const found = words.filter((word) => {
    if (/^\w+$/.test(word)) {
      return new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(text);
    }
    return text.toLowerCase().includes(word.toLowerCase());
  });
  if (found.length > 0) {
    return { pass: false, detail: `forbidden words found: ${found.join(', ')}` };
  }
  return { pass: true, detail: 'no forbidden words found' };
}

export function letterFrequency(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const letter = strArg(kwargs, 'letter');
  const frequency = numArg(kwargs, 'let_frequency');
  const relation = relationArg(kwargs, 'let_relation');
  if (
    letter === undefined ||
    letter.length === 0 ||
    frequency === undefined ||
    relation === undefined
  ) {
    return fail('invalid kwargs: letter, let_frequency, let_relation required');
  }
  const target = letter[0]?.toLowerCase() ?? '';
  let count = 0;
  for (const char of text.toLowerCase()) {
    if (char === target) count += 1;
  }
  const pass = checkRelation(count, frequency, relation);
  return {
    pass,
    detail: `letter occurs ${count}x, expected ${relation} ${frequency}x`,
  };
}

registerChecker('keywords:existence', keywordsExistence);
registerChecker('keywords:frequency', keywordsFrequency);
registerChecker('keywords:forbidden_words', forbiddenWords);
registerChecker('keywords:letter_frequency', letterFrequency);
