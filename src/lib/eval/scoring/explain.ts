import type { ConstraintViolation } from './recommend';

export interface ReasonSentence {
  key: string;
  params: Record<string, string | number>;
}

/**
 * Template-based recommendation reasons (no LLM).
 * The UI maps `key` through i18n with `params`.
 */
export function explainBest(candidateLabel: string, composite: number | null): ReasonSentence {
  return {
    key: 'eval.report.reason.best',
    params: { candidate: candidateLabel, score: composite ?? 0 },
  };
}

export function explainFast(
  candidateLabel: string,
  bestLabel: string,
  pScore: number | null,
): ReasonSentence {
  return {
    key: 'eval.report.reason.fastAlt',
    params: { candidate: candidateLabel, best: bestLabel, performance: pScore ?? 0 },
  };
}

export function explainQuality(candidateLabel: string, qaScore: number | null): ReasonSentence {
  return {
    key: 'eval.report.reason.qualityAlt',
    params: { candidate: candidateLabel, quality: qaScore ?? 0 },
  };
}

export function explainViolation(candidateLabel: string, violation: ConstraintViolation): ReasonSentence {
  return {
    key: 'eval.report.reason.constraintViolation',
    params: {
      candidate: candidateLabel,
      metric: violation.metric,
      op: violation.op,
      value: violation.value,
      actual: violation.actual ?? 'n/a',
    },
  };
}

export function explainGroup(memberLabels: string[]): ReasonSentence {
  return {
    key: 'eval.report.reason.tieGroup',
    params: { members: memberLabels.join(', '), count: memberLabels.length },
  };
}
