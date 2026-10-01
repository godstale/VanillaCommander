import {
  fail,
  numArg,
  registerChecker,
  strArg,
  type CheckerOutcome,
} from '../registry';

const BULLET_LINE_RE = /^\s*[-*]\s+\S/m;
const HIGHLIGHT_RE = /\*\*[^*\n]+?\*\*/g;
const TITLE_RE = /<<[^<>\n]+>>/;
const FENCE_RE = /^```(?:json)?\s*|\s*```$/g;

export function numberBulletLists(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const expected = numArg(kwargs, 'num_bullets');
  if (expected === undefined) {
    return fail('invalid kwargs: num_bullets number required');
  }
  let count = 0;
  for (const line of text.split('\n')) {
    if (BULLET_LINE_RE.test(line)) count += 1;
  }
  const pass = count === expected;
  return { pass, detail: `found ${count} bullet lines, expected ${expected}` };
}

const DEFAULT_RESPONSES = ['yes', 'no'];

export function constrainedResponse(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const raw = kwargs['responses'];
  let allowed = DEFAULT_RESPONSES;
  if (raw !== undefined) {
    if (!Array.isArray(raw)) {
      return fail('invalid kwargs: responses must be string[]');
    }
    const list: string[] = [];
    for (const item of raw) {
      if (typeof item !== 'string') {
        return fail('invalid kwargs: responses must be string[]');
      }
      list.push(item);
    }
    if (list.length === 0) {
      return fail('invalid kwargs: responses must be a non-empty string[]');
    }
    allowed = list;
  }
  const normalized = text.trim().toLowerCase().replace(/[.\s]+$/, '');
  const pass = allowed.some((option) => option.toLowerCase() === normalized);
  return {
    pass,
    detail: pass
      ? `response matches constrained option "${normalized}"`
      : `response "${normalized}" is not one of [${allowed.join(', ')}]`,
  };
}

export function numberHighlightedSections(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const expected = numArg(kwargs, 'num_highlights');
  if (expected === undefined) {
    return fail('invalid kwargs: num_highlights number required');
  }
  const count = text.match(HIGHLIGHT_RE)?.length ?? 0;
  const pass = count === expected;
  return {
    pass,
    detail: `found ${count} highlighted sections, expected ${expected}`,
  };
}

export function multipleSections(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const spliter = strArg(kwargs, 'section_spliter');
  const expected = numArg(kwargs, 'num_sections');
  if (spliter === undefined || expected === undefined) {
    return fail('invalid kwargs: section_spliter, num_sections required');
  }
  const count = text.split(spliter).length - 1;
  const pass = count >= expected;
  return {
    pass,
    detail: `found ${count} sections, expected at least ${expected}`,
  };
}

export function jsonFormat(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  void kwargs;
  const stripped = text.trim().replace(FENCE_RE, '').trim();
  try {
    JSON.parse(stripped);
    return { pass: true, detail: 'response is valid JSON' };
  } catch {
    return { pass: false, detail: 'response is not valid JSON' };
  }
}

export function title(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  void kwargs;
  const pass = TITLE_RE.test(text);
  return {
    pass,
    detail: pass
      ? 'title in <<...>> found'
      : 'no <<title>> section found',
  };
}

registerChecker('detectable_format:number_bullet_lists', numberBulletLists);
registerChecker('detectable_format:constrained_response', constrainedResponse);
registerChecker(
  'detectable_format:number_highlighted_sections',
  numberHighlightedSections,
);
registerChecker('detectable_format:multiple_sections', multipleSections);
registerChecker('detectable_format:json_format', jsonFormat);
registerChecker('detectable_format:title', title);
