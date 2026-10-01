import { describe, expect, it } from 'vitest';
import { mean } from './descriptive';
import { bootstrapCI, pairedBootstrapDiff } from './bootstrap';

describe('bootstrapCI', () => {
  it('is reproducible with the same seed', () => {
    const values = [0.1, 0.5, 0.9, 0.4, 0.7, 0.2, 0.8, 0.3, 0.6, 0.55];
    const a = bootstrapCI(values, mean, { seed: 7, iterations: 500 });
    const b = bootstrapCI(values, mean, { seed: 7, iterations: 500 });
    expect(a).toEqual(b);
    expect(a.estimate).toBeCloseTo(mean(values), 12);
    expect(a.low).toBeLessThanOrEqual(a.estimate);
    expect(a.high).toBeGreaterThanOrEqual(a.estimate);
  });

  it('differs across seeds (stochastic check)', () => {
    const values = [0.1, 0.5, 0.9, 0.4, 0.7, 0.2, 0.8, 0.3, 0.6, 0.55];
    const a = bootstrapCI(values, mean, { seed: 7, iterations: 500 });
    const b = bootstrapCI(values, mean, { seed: 8, iterations: 500 });
    expect(a.low !== b.low || a.high !== b.high).toBe(true);
  });

  it('resamples whole clusters when clusters are given', () => {
    const values = [1, 1, 1, 9, 9, 9];
    const clusters = ['a', 'a', 'a', 'b', 'b', 'b'];
    const ci = bootstrapCI(values, mean, { seed: 3, iterations: 2000, clusters });
    expect(ci.estimate).toBeCloseTo(5, 10);
    // cluster resampling only ever sees means of 1, 5, or 9
    expect(ci.low).toBeGreaterThanOrEqual(1);
    expect(ci.high).toBeLessThanOrEqual(9);
  });
});

describe('pairedBootstrapDiff', () => {
  it('uses common keys only and centers on the mean diff', () => {
    const a = new Map([
      ['s1', 1],
      ['s2', 0],
      ['only-a', 1],
    ]);
    const b = new Map([
      ['s1', 0],
      ['s2', 0],
      ['only-b', 1],
    ]);
    const r = pairedBootstrapDiff(a, b, { seed: 11, iterations: 500 });
    expect(r.n).toBe(2);
    expect(r.estimate).toBeCloseTo(0.5, 10);
    expect(r.low).toBeLessThanOrEqual(0.5);
    expect(r.high).toBeGreaterThanOrEqual(0.5);
  });

  it('contains 0 for identical maps', () => {
    const m = new Map([
      ['s1', 0.7],
      ['s2', 0.2],
      ['s3', 0.9],
    ]);
    const r = pairedBootstrapDiff(m, new Map(m), { seed: 5, iterations: 200 });
    expect(r.estimate).toBe(0);
    expect(r.low).toBeLessThanOrEqual(0);
    expect(r.high).toBeGreaterThanOrEqual(0);
  });
});
