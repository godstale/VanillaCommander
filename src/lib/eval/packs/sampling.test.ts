import { describe, expect, it } from 'vitest';
import { EvalPackManifestSchema, type EvalSample } from '../types';
import { selectSampleIds } from './sampling';

function manifest(stratifyBy?: string) {
  return EvalPackManifestSchema.parse({
    schemaVersion: '1.0',
    id: 'demo',
    version: '1.0.0',
    title: { ko: 'd', en: 'd' },
    description: { ko: 'd', en: 'd' },
    category: 'Q1',
    lang: ['ko'],
    license: { id: 't' },
    kind: 'single_turn',
    source: { type: 'jsonl' },
    scorers: [],
    metrics: [
      {
        id: 'm',
        description: { ko: 'd', en: 'd' },
        source: 'score',
        aggregation: 'mean',
        lowerIsBetter: false,
        scoreType: 'binary',
        range: { min: 0, max: 1 },
        normalization: { kind: 'baseline', baseline: 0 },
      },
    ],
    tiers: { smoke: 4, standard: 8, full: 'all' },
    ...(stratifyBy ? { stratifyBy } : {}),
  });
}

function sample(id: string, subject: string): EvalSample {
  return { id, input: id, metadata: { subject } };
}

describe('sampling', () => {
  it('is reproducible for the same seed', () => {
    const samples = Array.from({ length: 20 }, (_, i) => sample(`s${i}`, i % 2 === 0 ? 'a' : 'b'));
    const m = manifest('subject');
    const first = selectSampleIds(samples, 'smoke', m, 7);
    const second = selectSampleIds(samples, 'smoke', m, 7);
    expect(first).toEqual(second);
    expect(first).toHaveLength(4);
  });

  it('respects stratum ratios', () => {
    const samples = [
      ...Array.from({ length: 60 }, (_, i) => sample(`a${i}`, 'major')),
      ...Array.from({ length: 20 }, (_, i) => sample(`b${i}`, 'minor')),
    ];
    const ids = selectSampleIds(samples, 'standard', manifest('subject'), 3);
    expect(ids).toHaveLength(8);
    const minor = ids.filter((id) => id.startsWith('b')).length;
    expect(minor).toBeGreaterThanOrEqual(1);
    expect(minor).toBeLessThanOrEqual(3);
  });

  it('returns all for full=all and caps at sample size', () => {
    const samples = [sample('s1', 'a'), sample('s2', 'b')];
    expect(selectSampleIds(samples, 'full', manifest(), 1).sort()).toEqual(['s1', 's2']);
  });
});
