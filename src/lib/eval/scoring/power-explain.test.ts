import { describe, expect, it } from 'vitest';
import { detectableDiff } from './power';
import {
  explainBest,
  explainFast,
  explainGroup,
  explainQuality,
  explainViolation,
} from './explain';

describe('detectableDiff', () => {
  it('matches 1.96*sqrt(p(1-p)/n)', () => {
    expect(detectableDiff(100)).toBeCloseTo(0.098, 3);
    expect(detectableDiff(400, 0.5)).toBeCloseTo(0.049, 3);
    expect(detectableDiff(0)).toBeNaN();
  });
});

describe('explain', () => {
  it('returns i18n keys with params (no LLM)', () => {
    expect(explainBest('A', 86.7)).toEqual({
      key: 'eval.report.reason.best',
      params: { candidate: 'A', score: 86.7 },
    });
    expect(explainFast('B', 'A', 70).key).toBe('eval.report.reason.fastAlt');
    expect(explainQuality('B', 75).key).toBe('eval.report.reason.qualityAlt');
    expect(
      explainViolation('B', { metric: 'failure_rate', op: '<=', value: 0.1, actual: 0.2 }).key,
    ).toBe('eval.report.reason.constraintViolation');
    expect(explainGroup(['A', 'B']).params['count']).toBe(2);
  });
});
