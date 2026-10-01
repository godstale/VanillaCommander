import { describe, expect, it } from 'vitest';
import { mean, median, percentile, stddev } from './descriptive';

describe('descriptive', () => {
  it('computes mean and median', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('interpolates percentiles linearly', () => {
    expect(percentile([1, 2, 3, 4], 25)).toBeCloseTo(1.75, 10);
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5, 10);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
  });

  it('computes population stddev', () => {
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 10);
    expect(stddev([7])).toBe(0);
  });

  it('returns NaN for empty input', () => {
    expect(mean([])).toBeNaN();
    expect(median([])).toBeNaN();
    expect(percentile([], 50)).toBeNaN();
    expect(stddev([])).toBeNaN();
  });
});
