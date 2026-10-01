import {
  checkRelation,
  fail,
  numArg,
  registerChecker,
  relationArg,
  strArg,
  type CheckerOutcome,
} from './registry';
import { splitSentences } from './textUtils';

export function koCharCount(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const expected = numArg(kwargs, 'num_characters');
  const relation = relationArg(kwargs, 'relation');
  if (expected === undefined || relation === undefined) {
    return fail('invalid kwargs: num_characters, relation required');
  }
  const count = text.replace(/\s+/g, '').length;
  const pass = checkRelation(count, expected, relation);
  return {
    pass,
    detail: `found ${count} characters, expected ${relation} ${expected}`,
  };
}

const POLITE_ENDING_RE =
  /(습니다|입니다|합니다|됩니다|갑니다|옵니다|하세요|주세요|드세요|보세요|이세요|세요|요)[.?!。…]?\s*$/u;

function isPoliteSentence(sentence: string): boolean {
  return POLITE_ENDING_RE.test(sentence.trim());
}

export type KoSpeechStyle = 'polite' | 'casual';

function normalizeStyle(raw: string): KoSpeechStyle | undefined {
  const lowered = raw.trim().toLowerCase();
  if (lowered === 'polite' || lowered === '존댓말') return 'polite';
  if (lowered === 'casual' || lowered === '반말') return 'casual';
  return undefined;
}

const POLITE_THRESHOLD = 0.7;
const CASUAL_THRESHOLD = 0.3;

export function koSpeechStyle(
  text: string,
  kwargs: Record<string, unknown>,
): CheckerOutcome {
  const rawStyle = strArg(kwargs, 'style');
  if (rawStyle === undefined) {
    return fail('invalid kwargs: style string required');
  }
  const style = normalizeStyle(rawStyle);
  if (style === undefined) {
    return fail('invalid kwargs: style must be polite/casual (존댓말/반말)');
  }
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return fail('empty response: no sentences for speech-style heuristic');
  }
  const polite = sentences.filter(isPoliteSentence).length;
  const ratio = polite / sentences.length;
  const pass =
    style === 'polite'
      ? ratio >= POLITE_THRESHOLD
      : ratio <= CASUAL_THRESHOLD;
  return {
    pass,
    detail:
      `speech-style heuristic: polite-ending ratio ${ratio.toFixed(2)} ` +
      `(${polite}/${sentences.length}, style ${style})`,
  };
}

registerChecker('ko:number_characters', koCharCount);
registerChecker('ko:speech_style', koSpeechStyle);
