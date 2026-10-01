import { registerChecker, type CheckerOutcome } from '../registry';

export function noComma(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  void kwargs;
  const pass = !text.includes(',');
  return {
    pass,
    detail: pass ? 'response has no comma' : 'response contains a comma',
  };
}

registerChecker('punctuation:no_comma', noComma);
