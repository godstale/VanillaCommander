import { describe, expect, it } from 'vitest';
import { comb, passAtK, passHatK } from './passk';

describe('passk', () => {
  it('computes combinations without overflow', () => {
    expect(comb(10, 3)).toBe(120);
    expect(comb(5, 0)).toBe(1);
    expect(comb(5, 6)).toBe(0);
    expect(comb(100, 50)).toBeCloseTo(1.0089134454556415e29, -15);
  });

  it('computes pass@k known values', () => {
    expect(passAtK(10, 5, 1)).toBeCloseTo(0.5, 10);
    expect(passAtK(5, 5, 2)).toBe(1);
    // 1 - C(2,2)/C(5,2) = 1 - 0.1
    expect(passAtK(5, 3, 2)).toBeCloseTo(0.9, 10);
    // all wrong -> 0
    expect(passAtK(5, 0, 2)).toBe(0);
  });

  it('computes pass^@k known values', () => {
    // C(3,2)/C(5,2) = 3/10
    expect(passHatK(5, 3, 2)).toBeCloseTo(0.3, 10);
    expect(passHatK(4, 4, 2)).toBe(1);
    expect(passHatK(4, 1, 2)).toBe(0);
  });

  it('returns NaN when n < k', () => {
    expect(passAtK(2, 1, 3)).toBeNaN();
    expect(passHatK(2, 1, 3)).toBeNaN();
  });
});
