import {
  fail,
  registerChecker,
  strArg,
  type CheckerOutcome,
} from '../registry';

export function endChecker(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const phrase = strArg(kwargs, 'end_phrase');
  if (phrase === undefined || phrase.trim().length === 0) {
    return fail('invalid kwargs: end_phrase string required');
  }
  const pass = text.trim().toLowerCase().endsWith(phrase.trim().toLowerCase());
  return {
    pass,
    detail: pass
      ? `response ends with "${phrase}"`
      : `response does not end with "${phrase}"`,
  };
}

export function quotation(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  void kwargs;
  const trimmed = text.trim();
  const pass =
    trimmed.length >= 2 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"');
  return {
    pass,
    detail: pass
      ? 'response is wrapped in double quotes'
      : 'response is not wrapped in double quotes',
  };
}

registerChecker('startend:end_checker', endChecker);
registerChecker('startend:quotation', quotation);
