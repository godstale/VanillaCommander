import { describe, expect, it } from 'vitest';
import {
  commonPrefix,
  klDivergence,
  meanKld,
  pairFidelity,
  summarizeQuantPairs,
  top1,
  top1Agreement,
  type QuantPairResult,
} from './quantFidelity';
import type { LogprobTrace } from './client';

function cand(token: string, prob: number): { token: string; logprob: number } {
  return { token, logprob: Math.log(prob) };
}

function trace(tokens: string[], tops: Array<Array<{ token: string; logprob: number }>>): LogprobTrace {
  return { tokens, topLogprobs: tops };
}

describe('commonPrefix', () => {
  it('counts the shared prefix', () => {
    expect(commonPrefix(['a', 'b', 'c'], ['a', 'b', 'd'])).toBe(2);
    expect(commonPrefix(['a'], ['a', 'b'])).toBe(1);
    expect(commonPrefix(['a'], ['b'])).toBe(0);
    expect(commonPrefix([], ['a'])).toBe(0);
    expect(commonPrefix(['a', 'b'], ['a', 'b'])).toBe(2);
  });
});

describe('klDivergence', () => {
  it('matches hand-computed KL(p||q)', () => {
    const p = [cand('A', 0.5), cand('B', 0.5)];
    const q = [cand('A', 0.9), cand('B', 0.1)];
    // 0.5*ln(0.5/0.9) + 0.5*ln(0.5/0.1) = 0.5*ln(5/9) + 0.5*ln(5)
    const expected = 0.5 * Math.log(5 / 9) + 0.5 * Math.log(5);
    expect(klDivergence(p, q, 0)).toBeCloseTo(expected, 10);
  });
  it('is zero for identical distributions', () => {
    const p = [cand('A', 0.7), cand('B', 0.2)];
    expect(klDivergence(p, [...p])).toBe(0);
  });
  it('stays finite on disjoint supports with default smoothing', () => {
    const kl = klDivergence([cand('A', 1)], [cand('B', 1)]);
    expect(Number.isFinite(kl)).toBe(true);
    expect(kl).toBeGreaterThan(0);
  });
  it('is order-independent via top1', () => {
    expect(top1([cand('B', 0.2), cand('A', 0.8)])).toBe('A');
    expect(top1([])).toBeNull();
  });
});

describe('pair comparison', () => {
  const traceR = trace(
    ['Hello', ' world'],
    [
      [cand('Hello', 0.8), cand('Hi', 0.2)],
      [cand(' world', 0.7), cand(' there', 0.3)],
    ],
  );
  const traceQ = trace(
    ['Hello', ' there'],
    [
      [cand('Hello', 0.75), cand('Hi', 0.25)],
      [cand(' there', 0.6), cand(' world', 0.4)],
    ],
  );

  it('reports divergence position 1 with prefix-only KL', () => {
    const r = pairFidelity(traceR, traceQ);
    expect(r.divergencePos).toBe(1);
    expect(r.positions).toBe(2);
    expect(r.meanKld).toBeCloseTo(
      klDivergence(traceR.topLogprobs[0], traceQ.topLogprobs[0]),
      10,
    );
    expect(r.top1Agreement).toBe(0.5);
  });
  it('meanKld is null when the first tokens already diverge', () => {
    const a = trace(['X'], [[cand('X', 1)]]);
    const b = trace(['Y'], [[cand('Y', 1)]]);
    expect(meanKld(a, b)).toBeNull();
    expect(top1Agreement(a, b)).toBe(0);
  });
  it('top1Agreement is 0 for empty alignment', () => {
    expect(top1Agreement(trace([], []), trace([], []))).toBe(0);
  });
});

describe('summarizeQuantPairs', () => {
  it('aggregates the report-only metrics', () => {
    const pairs: QuantPairResult[] = [
      { divergencePos: 1, meanKld: 0.1, top1Agreement: 0.5, positions: 2 },
      { divergencePos: 3, meanKld: 0.3, top1Agreement: 1, positions: 4 },
      { divergencePos: 5, meanKld: null, top1Agreement: 0.75, positions: 5 },
    ];
    const s = summarizeQuantPairs(pairs);
    expect(s.pairs).toBe(3);
    expect(s.mean_kld).toBeCloseTo(0.2, 10);
    expect(s.top1_agreement).toBeCloseTo(0.75, 10);
    expect(s.divergence_pos_median).toBe(3);
  });
  it('handles empty input', () => {
    expect(summarizeQuantPairs([])).toMatchObject({
      mean_kld: null,
      top1_agreement: null,
      divergence_pos_median: null,
      pairs: 0,
    });
  });
});
