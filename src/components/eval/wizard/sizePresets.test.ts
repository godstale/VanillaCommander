import { describe, expect, it } from 'vitest';
import type { LoadedPackRef } from '@/lib/eval/packs/packLoader';
import type { EvalPackManifest, EvalProfile, PackKind } from '@/lib/eval/types';
import {
  QUICK_EXCLUDED_KINDS,
  QUICK_PACK_LIMIT,
  applyEvalSizePreset,
} from './sizePresets';

function mockRef(
  id: string,
  category: EvalPackManifest['category'],
  kind: PackKind,
  smoke: number,
): LoadedPackRef {
  return {
    scope: 'builtin',
    manifest: {
      id,
      category,
      kind,
      tiers: { smoke, standard: smoke * 4, full: 'all' },
      defaults: { timeoutSec: 60, maxTurns: 4, epochs: 2, circular: false },
    } as unknown as EvalPackManifest,
    contentHash: `h-${id}`,
    diagnostics: [],
  };
}

function mockProfile(): EvalProfile {
  return {
    id: 'balanced',
    dimensionWeights: { Q: 30, A: 25, P: 20, R: 10, S: 15 },
    categoryWeights: { Q9: 2 },
  } as unknown as EvalProfile;
}

const packs: LoadedPackRef[] = [
  mockRef('q1-big', 'Q1', 'single_turn', 45),
  mockRef('q1-small', 'Q1', 'single_turn', 10),
  mockRef('a1-pack', 'A1', 'tool_call', 15),
  mockRef('heavy-long', 'Q6', 'long_context', 3),
  mockRef('heavy-agent', 'A3', 'agentic', 8),
  mockRef('quant', 'Q8', 'logprob_trace', 10),
  mockRef('p1-pack', 'P1', 'perf_probe', 3),
];

describe('applyEvalSizePreset', () => {
  it('quick은 카테고리당 1팩·무거운 kind 제외·최대 6팩·smoke/epochs 1', () => {
    const sels = applyEvalSizePreset(packs, mockProfile(), 'quick');
    expect(sels.length).toBeLessThanOrEqual(QUICK_PACK_LIMIT);
    for (const s of sels) {
      expect(s.tier).toBe('smoke');
      expect(s.epochs).toBe(1);
    }
    const ids = sels.map((s) => s.packId);
    // 같은 카테고리에서는 smoke가 적은 팩을 고른다
    expect(ids).toContain('q1-small');
    expect(ids).not.toContain('q1-big');
    // 무거운 kind는 제외된다
    for (const excluded of ['heavy-long', 'heavy-agent', 'quant']) {
      expect(ids).not.toContain(excluded);
    }
    expect(QUICK_EXCLUDED_KINDS.has('long_context')).toBe(true);
  });

  it('quick은 가중치 0 카테고리를 제외한다', () => {
    const profile = {
      ...mockProfile(),
      dimensionWeights: { Q: 100, A: 0, P: 0, R: 0, S: 0 },
    } as unknown as EvalProfile;
    const sels = applyEvalSizePreset(packs, profile, 'quick');
    expect(sels.map((s) => s.packId)).toEqual(['q1-small']);
  });

  it('standard는 가중치 0 제외 전 팩을 standard/기본 epochs로 고른다', () => {
    const sels = applyEvalSizePreset(packs, mockProfile(), 'standard');
    expect(sels.length).toBe(packs.length);
    for (const s of sels) {
      expect(s.tier).toBe('standard');
      expect(s.epochs).toBe(2);
    }
  });

  it('full은 가중치와 무관하게 전 팩을 full로 고른다', () => {
    const profile = {
      ...mockProfile(),
      dimensionWeights: { Q: 100, A: 0, P: 0, R: 0, S: 0 },
    } as unknown as EvalProfile;
    const sels = applyEvalSizePreset(packs, profile, 'full');
    expect(sels.length).toBe(packs.length);
    for (const s of sels) expect(s.tier).toBe('full');
  });
});
