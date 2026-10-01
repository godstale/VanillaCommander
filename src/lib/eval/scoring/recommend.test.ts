import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES } from '../constants';
import type { EvalAggregateRow, EvalProfile } from '../types';
import { pairKey, recommend } from './recommend';

function row(candidateId: string, level: EvalAggregateRow['level'], key: string, v: number | null): EvalAggregateRow {
  return {
    runId: 'run1',
    candidateId,
    level,
    key,
    raw: v,
    normalized: v,
    ciLow: null,
    ciHigh: null,
    n: 10,
    anchorsVersion: 'anchors-v1',
    computedAt: '2026-01-01T00:00:00.000Z',
  };
}

function profile(): EvalProfile {
  return {
    ...BUILTIN_PROFILES[0],
    id: 'test',
    builtIn: false,
    dimensionWeights: { Q: 30, A: 25, P: 20, R: 10, S: 15 },
    categoryWeights: {},
    constraints: [{ metric: 'Q1', op: '>=', value: 70, label: { ko: 'Q1', en: 'Q1' } }],
  };
}

// a: QA 80 / P 50, composite 80 | b: QA 70 / P 90, composite 75 | c: QA 60 / P 40, composite 60
function aggregates(): EvalAggregateRow[] {
  const defs: [string, number, number, number, number][] = [
    ['a', 80, 80, 50, 80],
    ['b', 75, 70, 90, 60],
    ['c', 60, 60, 40, 75],
  ];
  const rows: EvalAggregateRow[] = [];
  for (const [id, comp, qa, p, q1] of defs) {
    rows.push(row(id, 'composite', 'composite', comp));
    rows.push(row(id, 'dimension', 'Q', qa));
    rows.push(row(id, 'dimension', 'A', qa));
    rows.push(row(id, 'dimension', 'P', p));
    rows.push(row(id, 'category', 'Q1', q1));
  }
  return rows;
}

const candidates = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('recommend', () => {
  it('flags constraint violations and restricts eligibility', () => {
    const rec = recommend(aggregates(), candidates, profile());
    // b has Q1 60 < 70 -> violation
    expect(rec.violations['b']).toHaveLength(1);
    expect(rec.violations['b'][0].actual).toBe(60);
    expect(rec.eligible).toEqual(['a', 'c']);
  });

  it('finds the pareto frontier over eligible candidates', () => {
    const rec = recommend(aggregates(), candidates, { ...profile(), constraints: [] });
    // c is dominated by a (QA 80>60 and P 50>40); a and b dominate nobody mutually
    expect(rec.pareto.sort()).toEqual(['a', 'b']);
    expect(rec.picks.best).toBe('a');
  });

  it('picks fast only with indistinguishability evidence', () => {
    const agg = aggregates();
    const noEvidence = recommend(agg, candidates, { ...profile(), constraints: [] });
    expect(noEvidence.picks.fast).toBeUndefined();
    const withEvidence = recommend(agg, candidates, { ...profile(), constraints: [] }, {
      indistinguishable: new Set([pairKey('a', 'b')]),
    });
    expect(withEvidence.picks.fast).toBe('b');
    // quality = pareto non-best with max QA -> b (70) since a is best
    expect(withEvidence.picks.quality).toBe('b');
  });

  it('derives indistinguishability from sample scores', () => {
    const agg = aggregates();
    const same = new Map([
      ['s1', 0.8],
      ['s2', 0.6],
      ['s3', 0.7],
    ]);
    const rec = recommend(agg, candidates, { ...profile(), constraints: [] }, {
      sampleScores: new Map([
        ['a', same],
        ['b', new Map(same)],
        ['c', new Map([['s1', 0], ['s2', 0], ['s3', 0]])],
      ]),
      bootstrapOpts: { seed: 1, iterations: 200 },
    });
    // a and b identical -> grouped; c separate
    expect(rec.groups[0]).toEqual(['a', 'b']);
    expect(rec.groups[1]).toEqual(['c']);
    expect(rec.picks.fast).toBe('b');
  });

  it('groups each candidate alone without evidence', () => {
    const rec = recommend(aggregates(), candidates, { ...profile(), constraints: [] });
    expect(rec.groups).toEqual([['a'], ['b'], ['c']]);
  });
});
