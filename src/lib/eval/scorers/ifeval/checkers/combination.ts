import {
  fail,
  registerChecker,
  strArg,
  type CheckerOutcome,
} from '../registry';

const TWO_RESPONSES_SEPARATOR = '******';

export function twoResponses(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  void kwargs;
  const parts = text.split(TWO_RESPONSES_SEPARATOR);
  const pass =
    parts.length === 2 &&
    (parts[0]?.trim().length ?? 0) > 0 &&
    (parts[1]?.trim().length ?? 0) > 0;
  return {
    pass,
    detail: pass
      ? 'response has exactly two non-empty parts'
      : `expected 2 parts separated by "${TWO_RESPONSES_SEPARATOR}", found ${parts.length}`,
  };
}

export function repeatPrompt(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const prompt = strArg(kwargs, 'prompt_to_repeat');
  if (prompt === undefined || prompt.trim().length === 0) {
    return fail('invalid kwargs: prompt_to_repeat string required');
  }
  const pass = text
    .trim()
    .toLowerCase()
    .startsWith(prompt.trim().toLowerCase());
  return {
    pass,
    detail: pass
      ? 'response repeats the prompt first'
      : 'response does not start with the prompt',
  };
}

registerChecker('combination:two_responses', twoResponses);
registerChecker('combination:repeat_prompt', repeatPrompt);
