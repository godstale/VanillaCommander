import {
  checkRelation,
  fail,
  numArg,
  registerChecker,
  relationArg,
  strArg,
  type CheckerOutcome,
} from '../registry';
import {
  countSentences,
  countWords,
  splitParagraphs,
  tokenizeWords,
} from '../textUtils';

export function numberSentences(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const expected = numArg(kwargs, 'num_sentences');
  const relation = relationArg(kwargs, 'relation');
  if (expected === undefined || relation === undefined) {
    return fail('invalid kwargs: num_sentences, relation required');
  }
  const count = countSentences(text);
  const pass = checkRelation(count, expected, relation);
  return {
    pass,
    detail: `found ${count} sentences, expected ${relation} ${expected}`,
  };
}

export function numberParagraphs(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const expected = numArg(kwargs, 'num_paragraphs');
  const relation = relationArg(kwargs, 'relation');
  if (expected === undefined || relation === undefined) {
    return fail('invalid kwargs: num_paragraphs, relation required');
  }
  const count = splitParagraphs(text).length;
  const pass = checkRelation(count, expected, relation);
  return {
    pass,
    detail: `found ${count} paragraphs, expected ${relation} ${expected}`,
  };
}

export function numberWords(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const expected = numArg(kwargs, 'num_words');
  const relation = relationArg(kwargs, 'relation');
  if (expected === undefined || relation === undefined) {
    return fail('invalid kwargs: num_words, relation required');
  }
  const count = countWords(text);
  const pass = checkRelation(count, expected, relation);
  return {
    pass,
    detail: `found ${count} words, expected ${relation} ${expected}`,
  };
}

export function nthParagraphFirstWord(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const expected = numArg(kwargs, 'num_paragraphs');
  const nth = numArg(kwargs, 'nth_paragraph');
  const firstWord = strArg(kwargs, 'first_word');
  if (expected === undefined || nth === undefined || firstWord === undefined) {
    return fail(
      'invalid kwargs: num_paragraphs, nth_paragraph, first_word required',
    );
  }
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length < expected) {
    return fail(
      `only ${paragraphs.length} paragraphs, need at least ${expected}`,
    );
  }
  const target = paragraphs[nth - 1];
  if (target === undefined) {
    return fail(`paragraph ${nth} out of range (${paragraphs.length} found)`);
  }
  const words = tokenizeWords(target);
  const actual = words[0] ?? '';
  const pass = actual.toLowerCase() === firstWord.toLowerCase();
  return {
    pass,
    detail: `paragraph ${nth} starts with "${actual}", expected "${firstWord}"`,
  };
}

registerChecker('length_constraints:number_sentences', numberSentences);
registerChecker('length_constraints:number_paragraphs', numberParagraphs);
registerChecker('length_constraints:number_words', numberWords);
registerChecker(
  'length_constraints:nth_paragraph_first_word',
  nthParagraphFirstWord,
);
