import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/repositories/evalRepo', () => ({
  getRun: vi.fn(async () => null),
  listCandidates: vi.fn(async () => []),
  listAggregates: vi.fn(async () => []),
  listTrials: vi.fn(async () => []),
  listScores: vi.fn(async () => []),
}));

import {
  getRun,
  listAggregates,
  listCandidates,
  listScores,
  listTrials,
} from '@/lib/db/repositories/evalRepo';
import {
  collectReportData,
  dimensionCoverage,
  displayValue,
  findAggregate,
  formatScore,
} from './reportData';
import { makeAgg, makeCandidate } from './fixtures';

describe('collectReportData', () => {
  it('returns a JSON-able snapshot object with the documented shape', async () => {
    const data = await collectReportData('run1');
    expect(data).toEqual({ run: null, candidates: [], aggregates: [], trials: [], scores: [] });
    expect(getRun).toHaveBeenCalledWith('run1');
    expect(listCandidates).toHaveBeenCalledWith('run1');
    expect(listTrials).toHaveBeenCalledWith('run1');
    expect(listScores).toHaveBeenCalledWith('run1');
    expect(listAggregates).toHaveBeenCalledWith('run1');
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});

describe('aggregate helpers', () => {
  const cands = [makeCandidate('a', 'A'), makeCandidate('b', 'B')];
  void cands;
  const aggs = [
    makeAgg('a', 'composite', 'composite', 80, 0.8, 78, 82),
    makeAgg('a', 'dimension', 'Q', 70),
    makeAgg('a', 'dimension', 'A', 75),
  ];

  it('findAggregate locates cells', () => {
    expect(findAggregate(aggs, 'a', 'composite', 'composite')?.normalized).toBe(80);
    expect(findAggregate(aggs, 'b', 'composite', 'composite')).toBeUndefined();
  });

  it('displayValue honors raw-vs-normalized with fallback', () => {
    const row = findAggregate(aggs, 'a', 'composite', 'composite');
    expect(displayValue(row, 'normalized')).toBe(80);
    expect(displayValue(row, 'raw')).toBe(0.8);
    expect(displayValue(undefined, 'raw')).toBeNull();
  });

  it('formatScore handles null/NaN', () => {
    expect(formatScore(null)).toBe('-');
    expect(formatScore(Number.NaN)).toBe('-');
    expect(formatScore(80.123)).toBe('80.1');
  });

  it('dimensionCoverage counts present dimensions', () => {
    expect(dimensionCoverage(aggs, 'a')).toBeCloseTo(0.4);
    expect(dimensionCoverage(aggs, 'b')).toBe(0);
  });
});
