export { JUDGE_PROMPT_VERSION } from '../constants';

export type JudgeScale = '1-5' | '1-10';

export interface RubricPromptInput {
  question: string;
  reference?: string;
  rubric: string;
  scale: JudgeScale;
}

export interface PairwisePromptInput {
  question: string;
  answerA: string;
  answerB: string;
}

const LENGTH_NOTE =
  'Score only substance against the rubric — do not reward length per se: ' +
  'a short correct answer outranks a long padded one, and verbosity alone ' +
  'never raises a score.';

/**
 * Static half of the rubric prompt (question, reference, rubric, scale,
 * output schema). The caller appends the candidate answer after the
 * trailing `Candidate answer:` line, then the response arrives as JSON.
 */
export function buildRubricPrompt(input: RubricPromptInput): string {
  const max = input.scale === '1-5' ? 5 : 10;
  const lines = [
    'You are an impartial evaluator. Judge the candidate answer below.',
    '',
    `Question:\n${input.question}`,
    '',
  ];
  if (input.reference !== undefined && input.reference !== '') {
    lines.push(`Reference answer:\n${input.reference}`, '');
  }
  lines.push(
    `Rubric:\n${input.rubric}`,
    '',
    LENGTH_NOTE,
    '',
    `Score each rubric criterion on the ${input.scale} scale (integers 1..${max}) ` +
      'and give an overall score on the same scale.',
    'Respond with JSON only, no other text, in exactly this shape:',
    `{"criteria": [{"name": "<criterion>", "score": <1..${max}>, "reason": "<why>"}], "overall": <1..${max}>}`,
    '',
    'Candidate answer:',
  );
  return lines.join('\n');
}

/**
 * Full pairwise prompt for one ordering. The caller issues two calls with
 * swapped A/B and treats a mismatch as a tie (order-bias guard).
 */
export function buildPairwisePrompt(input: PairwisePromptInput): string {
  return [
    'You are an impartial evaluator. Compare the two answers below.',
    '',
    `Question:\n${input.question}`,
    '',
    `Answer A:\n${input.answerA}`,
    '',
    `Answer B:\n${input.answerB}`,
    '',
    LENGTH_NOTE,
    ' Prefer the answer that is more correct and better follows the question;',
    ' if they are equally good (or equally bad), call it a tie.',
    'Respond with JSON only, no other text, in exactly this shape:',
    '{"winner": "A" | "B" | "tie", "reason": "<why>"}',
  ].join('\n');
}
