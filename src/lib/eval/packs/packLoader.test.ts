import { describe, expect, it } from 'vitest';
import type { EvalPackManifest } from '../types';
import { createMemoryPackFs } from './packFs';
import { listPacks, loadPack } from './packLoader';
import { listGenerators, registerGenerator } from './generators/index';

function manifestJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: '1.0',
    id: 'demo-pack',
    version: '1.0.0',
    title: { ko: '데모', en: 'Demo' },
    description: { ko: '설명', en: 'Desc' },
    category: 'Q1',
    lang: ['ko'],
    license: { id: 'test' },
    kind: 'single_turn',
    source: { type: 'jsonl', file: 'samples.jsonl' },
    scorers: [{ type: 'exact' }],
    metrics: [
      {
        id: 'accuracy',
        description: { ko: '정확도', en: 'Accuracy' },
        source: 'score',
        aggregation: 'mean',
        lowerIsBetter: false,
        scoreType: 'binary',
        range: { min: 0, max: 1 },
        normalization: { kind: 'baseline', baseline: 0 },
      },
    ],
    tiers: { smoke: 1, standard: 2, full: 'all' },
    ...overrides,
  });
}

const SAMPLES = [
  JSON.stringify({ id: 's1', input: 'hello' }),
  '',
  JSON.stringify({ id: 's2', input: 'world' }),
  'not json',
  JSON.stringify({ id: 's1', input: 'duplicate' }),
  JSON.stringify({ id: 42, input: 'bad' }),
].join('\n');

describe('pack loader', () => {
  it('prefers project > user > builtin and records shadowing', async () => {
    const fs = createMemoryPackFs({
      builtin: { 'demo-pack': { 'manifest.json': manifestJson() } },
      user: { 'demo-pack': { 'manifest.json': manifestJson() } },
      project: {},
    });
    const { refs, errors } = await listPacks(fs);
    expect(errors).toHaveLength(0);
    expect(refs).toHaveLength(1);
    expect(refs[0].scope).toBe('user');
    expect(refs[0].diagnostics.some((d) => d.message.includes('shadowed'))).toBe(true);
  });

  it('reports manifest errors without failing the whole list', async () => {
    const fs = createMemoryPackFs({
      builtin: {
        'good-pack': { 'manifest.json': manifestJson({ id: 'good-pack' }) },
        'bad-pack': { 'manifest.json': '{oops' },
        'mismatch-pack': { 'manifest.json': manifestJson({ id: 'other-id' }) },
      },
    });
    const { refs, errors } = await listPacks(fs);
    expect(refs.map((r) => r.manifest.id)).toEqual(['good-pack']);
    expect(errors).toHaveLength(2);
  });

  it('forces trusted=true for builtin packs', async () => {
    const fs = createMemoryPackFs({
      builtin: { 'demo-pack': { 'manifest.json': manifestJson({ trusted: false }) } },
    });
    const { refs } = await listPacks(fs);
    expect(refs[0].manifest.trusted).toBe(true);
  });

  it('loads samples with diagnostics for bad lines and duplicates', async () => {
    const fs = createMemoryPackFs({
      user: { 'demo-pack': { 'manifest.json': manifestJson(), 'samples.jsonl': SAMPLES } },
    });
    const { refs } = await listPacks(fs);
    const pack = await loadPack(fs, refs[0]);
    expect(pack.samples.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(pack.diagnostics.length).toBeGreaterThanOrEqual(3);
    expect(pack.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('has builtin generators registered without manual setup', () => {
    expect(listGenerators()).toContain('long-context-v1');
    expect(listGenerators()).toContain('perf-probe-v1');
  });

  it('loads generator packs via registry', async () => {
    registerGenerator('long-context-v1', async () => [
      { id: 'g1', input: 'generated' },
    ]);
    const fs = createMemoryPackFs({
      builtin: {
        'gen-pack': {
          'manifest.json': manifestJson({
            id: 'gen-pack',
            kind: 'long_context',
            source: { type: 'generator', generator: 'long-context-v1', params: {} },
          }),
        },
      },
    });
    const { refs } = await listPacks(fs);
    const pack = await loadPack(fs, refs.find((r) => r.manifest.id === 'gen-pack')!);
    expect(pack.samples.map((s) => s.id)).toEqual(['g1']);
  });
});

describe('pack manifest typing', () => {
  it('manifest fixture satisfies the schema type', () => {
    const parsed = JSON.parse(manifestJson()) as unknown;
    expect(typeof parsed === 'object' && parsed !== null).toBe(true);
    const m = parsed as EvalPackManifest;
    expect(m.tiers.smoke).toBe(1);
  });
});
