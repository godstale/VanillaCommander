import {
  fail,
  numArg,
  registerChecker,
  strArg,
  type CheckerOutcome,
} from '../registry';

const PLACEHOLDER_RE = /\[[^\n[\]]{1,200}\]/g;

export function numberPlaceholders(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const expected = numArg(kwargs, 'num_placeholders');
  if (expected === undefined) {
    return fail('invalid kwargs: num_placeholders number required');
  }
  const count = text.match(PLACEHOLDER_RE)?.length ?? 0;
  const pass = count >= expected;
  return {
    pass,
    detail: `found ${count} placeholders, expected at least ${expected}`,
  };
}

export function postscript(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const marker = strArg(kwargs, 'postscript_marker');
  if (marker === undefined || marker.length === 0) {
    return fail('invalid kwargs: postscript_marker string required');
  }
  const index = text.toLowerCase().indexOf(marker.toLowerCase());
  if (index === -1) {
    return { pass: false, detail: `postscript marker "${marker}" not found` };
  }
  const after = text.slice(index + marker.length).trim();
  if (after.length === 0) {
    return { pass: false, detail: 'postscript marker has no content after it' };
  }
  return { pass: true, detail: `postscript marker "${marker}" with content` };
}

registerChecker('detectable_content:number_placeholders', numberPlaceholders);
registerChecker('detectable_content:postscript', postscript);
