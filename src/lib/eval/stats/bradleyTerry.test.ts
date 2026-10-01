import { describe, expect, it } from 'vitest';
import { bradleyTerryCI, btDisplayScore, fitBradleyTerry, type BradleyTerryMatch } from './bradleyTerry';

function repeat(match: BradleyTerryMatch, n: number): BradleyTerryMatch[] {
  return Array.from({ length: n }, () => ({ ...match }));
}

describe('fitBradleyTerry', () => {
  it('gives equal strengths for a 3-cycle', () => {
    const matches: BradleyTerryMatch[] = [
      { a: 'A', b: 'B', winner: 'a' },
      { a: 'B', b: 'C', winner: 'a' },
      { a: 'C', b: 'A', winner: 'a' },
    ];
    const fit = fitBradleyTerry(matches);
    expect(fit).not.toBeNull();
    expect(fit!.display['A']).toBeCloseTo(1000, 3);
    expect(fit!.display['B']).toBeCloseTo(1000, 3);
    expect(fit!.display['C']).toBeCloseTo(1000, 3);
    expect(fit!.converged).toBe(true);
  });

  it('ranks a clear winner higher', () => {
    const matches: BradleyTerryMatch[] = [
      ...repeat({ a: 'A', b: 'B', winner: 'a' }, 9),
      ...repeat({ a: 'A', b: 'B', winner: 'b' }, 1),
    ];
    const fit = fitBradleyTerry(matches);
    expect(fit).not.toBeNull();
    expect(fit!.display['A']).toBeGreaterThan(fit!.display['B']);
    expect(fit!.strengths['A']).toBeGreaterThan(1);
    expect(fit!.strengths['B']).toBeLessThan(1);
  });

  it('returns null for a disconnected graph', () => {
    const matches: BradleyTerryMatch[] = [
      { a: 'A', b: 'B', winner: 'a' },
      { a: 'C', b: 'D', winner: 'tie' },
    ];
    expect(fitBradleyTerry(matches)).toBeNull();
    expect(fitBradleyTerry([])).toBeNull();
  });

  it('maps strength 1 to display 1000', () => {
    expect(btDisplayScore(1)).toBe(1000);
    expect(btDisplayScore(10)).toBeCloseTo(1400, 10);
  });
});

describe('bradleyTerryCI', () => {
  it('returns vote-resampled intervals around the estimates', () => {
    const matches: BradleyTerryMatch[] = [
      ...repeat({ a: 'A', b: 'B', winner: 'a' }, 8),
      ...repeat({ a: 'A', b: 'B', winner: 'b' }, 2),
      ...repeat({ a: 'B', b: 'C', winner: 'a' }, 6),
      ...repeat({ a: 'B', b: 'C', winner: 'b' }, 4),
    ];
    const ci = bradleyTerryCI(matches, { seed: 9, iterations: 200 });
    expect(ci).not.toBeNull();
    const fit = fitBradleyTerry(matches);
    for (const p of ['A', 'B', 'C']) {
      expect(ci![p].estimate).toBeCloseTo(fit!.display[p], 10);
      expect(ci![p].low).toBeLessThanOrEqual(ci![p].estimate);
      expect(ci![p].high).toBeGreaterThanOrEqual(ci![p].estimate);
    }
    const again = bradleyTerryCI(matches, { seed: 9, iterations: 200 });
    expect(again).toEqual(ci);
  });
});
