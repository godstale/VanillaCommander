import { describe, expect, it } from 'vitest';
import { wilsonInterval } from './wilson';

describe('wilsonInterval', () => {
  it('matches the known 60/100 value', () => {
    const { low, high } = wilsonInterval(60, 100);
    expect(low).toBeCloseTo(0.502, 3);
    expect(high).toBeCloseTo(0.691, 3);
  });

  it('clamps edges to [0, 1]', () => {
    expect(wilsonInterval(0, 10).low).toBe(0);
    expect(wilsonInterval(10, 10).high).toBe(1);
    const { low, high } = wilsonInterval(1, 10);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
    expect(low).toBeLessThan(high);
  });

  it('returns full uncertainty for n <= 0', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});
