import { describe, expect, it } from 'vitest';
import { judgeHumanAgreement, lengthBias, spearman } from './agreement';

describe('spearman', () => {
  it('is 1 for perfect monotone increase', () => {
    expect(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 10);
  });

  it('is -1 for perfect monotone decrease', () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 10);
  });

  it('matches the textbook spot value', () => {
    // ranks x: 1,2,3,4; ranks y: 4,1,3,2 → d² = 9+1+0+4 = 14
    // ρ = 1 − 6·14 / (4·15) = −0.4
    expect(spearman([1, 2, 3, 4], [4, 1, 3, 2])).toBeCloseTo(-0.4, 10);
  });

  it('handles ties with average ranks', () => {
    // x ranks: 1.5,1.5,3; y ranks: 1,2,3 → positive but imperfect
    const rho = spearman([5, 5, 9], [1, 2, 3]);
    expect(rho).not.toBeNull();
    expect(rho as number).toBeGreaterThan(0.8);
    expect(rho as number).toBeLessThan(1);
  });

  it('returns null for degenerate input', () => {
    expect(spearman([1, 2], [3, 4])).toBeNull();
    expect(spearman([7, 7, 7], [1, 2, 3])).toBeNull();
  });
});

describe('lengthBias', () => {
  it('warns when scores track length', () => {
    const items = [10, 20, 30, 40, 50, 60].map((len, i) => ({
      trialId: `t${i}`,
      outputLength: len,
      judgeValue: len / 100,
    }));
    const res = lengthBias(items);
    expect(res.n).toBe(6);
    expect(res.rho).toBeCloseTo(1, 10);
    expect(res.warn).toBe(true);
  });

  it('stays quiet when length and score are unrelated', () => {
    // d² = 100 over n = 8 → ρ ≈ −0.19, well below the warn threshold.
    const res = lengthBias([
      { trialId: 'a', outputLength: 10, judgeValue: 0.5 },
      { trialId: 'b', outputLength: 20, judgeValue: 0.9 },
      { trialId: 'c', outputLength: 30, judgeValue: 0.2 },
      { trialId: 'd', outputLength: 40, judgeValue: 0.7 },
      { trialId: 'e', outputLength: 50, judgeValue: 0.4 },
      { trialId: 'f', outputLength: 60, judgeValue: 0.8 },
      { trialId: 'g', outputLength: 70, judgeValue: 0.1 },
      { trialId: 'h', outputLength: 80, judgeValue: 0.6 },
    ]);
    expect(res.rho).toBeCloseTo(-0.19, 2);
    expect(res.warn).toBe(false);
  });
});

function binPairs(spec: { j1h1: number; j1h0: number; j0h1: number; j0h0: number }) {
  const pairs: Array<{ judgeValue: number; humanValue: number }> = [];
  for (let i = 0; i < spec.j1h1; i++) pairs.push({ judgeValue: 1, humanValue: 1 });
  for (let i = 0; i < spec.j1h0; i++) pairs.push({ judgeValue: 1, humanValue: 0 });
  for (let i = 0; i < spec.j0h1; i++) pairs.push({ judgeValue: 0, humanValue: 1 });
  for (let i = 0; i < spec.j0h0; i++) pairs.push({ judgeValue: 0, humanValue: 0 });
  return pairs;
}

describe('judgeHumanAgreement', () => {
  it('needs at least 20 pairs', () => {
    const res = judgeHumanAgreement(binPairs({ j1h1: 10, j1h0: 0, j0h1: 0, j0h0: 9 }));
    expect(res.n).toBe(19);
    expect(res.flag).toBe('insufficient-data');
    expect(res.kappa).toBeNull();
    expect(res.agreementRate).toBeCloseTo(1, 10);
  });

  it('computes agreement rate and Cohen κ', () => {
    // po = 15/20 = 0.75; pe = 0.75·0.7 + 0.25·0.3 = 0.6; κ = 0.15/0.4 = 0.375
    const res = judgeHumanAgreement(binPairs({ j1h1: 12, j1h0: 3, j0h1: 2, j0h0: 3 }));
    expect(res.n).toBe(20);
    expect(res.agreementRate).toBeCloseTo(0.75, 10);
    expect(res.kappa).toBeCloseTo(0.375, 10);
    expect(res.flag).toBe('low-trust');
  });

  it('flags ok for strong agreement', () => {
    const res = judgeHumanAgreement(binPairs({ j1h1: 12, j1h0: 1, j0h1: 1, j0h0: 12 }));
    expect(res.flag).toBe('ok');
    expect(res.kappa as number).toBeGreaterThan(0.8);
  });

  it('binarizes continuous values at the threshold', () => {
    const res = judgeHumanAgreement(
      Array.from({ length: 25 }, () => ({ judgeValue: 0.9, humanValue: 0.8 })),
    );
    expect(res.agreementRate).toBe(1);
    expect(res.kappa).toBe(1);
    expect(res.flag).toBe('ok');
  });

  it('handles empty input', () => {
    const res = judgeHumanAgreement([]);
    expect(res.flag).toBe('insufficient-data');
    expect(res.agreementRate).toBeNull();
  });
});
