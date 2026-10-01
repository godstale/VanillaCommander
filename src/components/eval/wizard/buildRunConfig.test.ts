import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES } from '@/lib/eval/constants';
import type { LoadedPack } from '@/lib/eval/packs/packLoader';
import type { CandidateSnapshot, EvalPackManifest, EvalSample } from '@/lib/eval/types';
import { buildRunConfig, type WizardDraft } from './buildRunConfig';

function makeManifest(id: string): EvalPackManifest {
  return {
    schemaVersion: '1.0',
    id,
    version: '1.0.0',
    title: { ko: id, en: id },
    description: { ko: id, en: id },
    category: 'Q1',
    lang: ['ko'],
    license: { id: 'test-license' },
    kind: 'single_turn',
    source: { type: 'generator', generator: 'perf-probe-v1', params: {} },
    useAgentSystemPrompt: false,
    scorers: [],
    metrics: [
      {
        id: 'm1',
        description: { ko: 'm', en: 'm' },
        source: 'score',
        aggregation: 'mean',
        lowerIsBetter: false,
        scoreType: 'continuous',
        range: { min: 0, max: 1 },
        normalization: { kind: 'identity' },
        countsTowardComposite: true,
      },
    ],
    tiers: { smoke: 2, standard: 5, full: 'all' },
    defaults: { timeoutSec: 180, maxTurns: 12, epochs: 1, circular: false },
    requires: { toolCalling: false, logprobs: false },
    trusted: false,
  };
}

function makeSamples(n: number): EvalSample[] {
  return Array.from({ length: n }, (_, i) => ({ id: `s${i}`, input: `input ${i}` }));
}

function makePack(scope: LoadedPack['scope'], id: string): LoadedPack {
  return { scope, manifest: makeManifest(id), contentHash: `hash-${id}`, diagnostics: [], samples: makeSamples(10) };
}

function makeCandidate(label: string): CandidateSnapshot {
  return {
    label,
    sourceAgentId: 'agent-1',
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    endpointClass: 'local',
    model: 'qwen3:8b',
    systemPrompt: 'sys',
    temperature: 0.7,
    reasoning: 'default',
    reasoningEffort: 'medium',
    contextSize: 8192,
    reserveTokens: 1024,
    keepRecentTokens: 2048,
    enabledBuiltinTools: [],
    enabledSkills: [],
  };
}

function makeDraft(): WizardDraft {
  const profile = JSON.parse(JSON.stringify(BUILTIN_PROFILES[0])) as WizardDraft['profile'];
  profile.categoryWeights = { ...profile.categoryWeights, Q1: 9 };
  return {
    runName: 'test-run',
    profile,
    packSelections: [{ scope: 'builtin', packId: 'pack-a', tier: 'smoke', epochs: 2, circular: false }],
    candidates: [makeCandidate('cand-1')],
    judge: null,
    options: {
      deterministicMode: true,
      reliabilityEpochs: 3,
      timeoutMultiplier: 1,
      perfRepeats: 3,
      unloadBetweenCandidates: true,
    },
    sampleOrderSeed: 7,
    weightsConfirmedAt: '2026-09-25T00:00:00.000Z',
    externalTransfers: [
      {
        integrationId: 'int-1',
        purpose: 'judge',
        dataClasses: ['public-bundled'],
        estimatedRequests: 10,
        estimatedInputTokens: 8000,
      },
    ],
    externalConfirmedAt: '2026-09-25T00:00:01.000Z',
    codeExecution: { runtime: 'python', snippetCount: 3, confirmedAt: '2026-09-25T00:00:02.000Z' },
    proceedWithoutExternal: false,
  };
}

describe('buildRunConfig', () => {
  it('applies weight edits, fixes sample ids, and carries confirmations', () => {
    const draft = makeDraft();
    const packs = [makePack('builtin', 'pack-a')];
    const a = buildRunConfig(draft, packs, 7);
    const b = buildRunConfig(draft, packs, 7);
    // weights edits applied (run-local profile copy passes through)
    expect(a.profile.categoryWeights['Q1']).toBe(9);
    // sampleIds fixed for the same seed
    expect(a.packs[0].sampleIds).toEqual(b.packs[0].sampleIds);
    expect(a.packs[0].sampleIds).toHaveLength(2);
    expect(a.packs[0].epochs).toBe(2);
    expect(a.packs[0].version).toBe('1.0.0');
    expect(a.options.sampleOrderSeed).toBe(7);
    expect(a.options.deterministicMode).toBe(true);
    // confirmations set
    expect(a.confirmations.weightsConfirmedAt).toBe('2026-09-25T00:00:00.000Z');
    expect(a.confirmations.externalConfirmedAt).toBe('2026-09-25T00:00:01.000Z');
    // external + code confirmations carried
    expect(a.confirmations.externalTransfers).toHaveLength(1);
    expect(a.confirmations.codeExecution).toEqual({ runtime: 'python', snippetCount: 3, confirmedAt: '2026-09-25T00:00:02.000Z' });
  });

  it('drops external transfers when proceeding without external items', () => {
    const draft = makeDraft();
    draft.proceedWithoutExternal = true;
    const config = buildRunConfig(draft, [makePack('builtin', 'pack-a')], 7);
    expect(config.confirmations.externalTransfers).toEqual([]);
  });

  it('matches snapshot', () => {
    const config = buildRunConfig(makeDraft(), [makePack('builtin', 'pack-a')], 7);
    expect(config).toMatchSnapshot();
  });
});
