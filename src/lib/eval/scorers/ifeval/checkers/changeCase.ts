import {
  checkRelation,
  fail,
  numArg,
  registerChecker,
  relationArg,
  type CheckerOutcome,
} from '../registry';
import {
  countCapitalWords,
  isAllLowerEnglish,
  isAllUpperEnglish,
} from '../textUtils';

export function capitalWordFrequency(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const expected = numArg(kwargs, 'capital_frequency');
  const relation = relationArg(kwargs, 'capital_relation');
  if (expected === undefined || relation === undefined) {
    return fail('invalid kwargs: capital_frequency, capital_relation required');
  }
  const count = countCapitalWords(text);
  const pass = checkRelation(count, expected, relation);
  return {
    pass,
    detail: `found ${count} capital words, expected ${relation} ${expected}`,
  };
}

export function englishCapital(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  void kwargs;
  const pass = isAllUpperEnglish(text);
  return {
    pass,
    detail: pass
      ? 'response is all uppercase English'
      : 'response is not all uppercase English',
  };
}

export function englishLowercase(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  void kwargs;
  const pass = isAllLowerEnglish(text);
  return {
    pass,
    detail: pass
      ? 'response is all lowercase English'
      : 'response is not all lowercase English',
  };
}

registerChecker('change_case:capital_word_frequency', capitalWordFrequency);
registerChecker('change_case:english_capital', englishCapital);
registerChecker('change_case:english_lowercase', englishLowercase);
