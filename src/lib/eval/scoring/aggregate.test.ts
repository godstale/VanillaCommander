import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES } from '../constants';
import type {
  CandidateSnapshot,
  EvalPackManifest,
  EvalRunConfig,
  EvalScoreRow,
  EvalTrialRow,
} from '../types';
import { aggregateRun } from './aggregate';

function snapshot(model: string): CandidateSnapshot {
  return {
    label: model,
    sourceAgentId: null,
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    endpointClass: 'local',
    model,
    systemPrompt: '',
    temperature: 0,
    contextSize: 8192,
    reserveTokens: 1024,
    keepRecentTokens: 2048,
    reasoning: 'default',
    reasoningEffort: 'low',
    enabledBuiltinTools: [],
    enabledSkills: [],
  };
}

function metric(id: string) {
  return {
    id,
    description: { ko: id, en: id },
    source: 'score',
    aggregation: 'mean',
    lowerIsBetter: false,
    scoreType: 'binary',
    range: { min: 0, max: 1 },
    normalization: { kind: 'baseline', baseline: 0, ceiling: 1 },
    countsTowardComposite: true,
  };
}

function pack(id: string, category: 'Q1' | 'Q8'): EvalPackManifest {
  return {
    schemaVersion: '1.0',
    id,
    version: '1.0.0',
    title: { ko: id, en: id },
    description: { ko: id, en: id },
    category,
    lang: ['ko'],
    license: { id: 'test' },
    kind: 'single_turn',
    source: { type: 'jsonl', file: 'samples.jsonl' },
    scorers: [],
    metrics: [metric('accuracy')],
    tiers: { smoke: 2, standard: 4, full: 4 },
    defaults: {},
    requires: {},
    trusted: false,
  } as unknown as EvalPackManifest;
}

function trial(id: string, candidateId: string, packId: string, sampleId: string): EvalTrialRow {
  return {
    id,
    runId: 'run1',
    candidateId,
    packId,
    sampleId,
    epoch: 0,
    outcome: 'ok',
    outputText: null,
    reasoningText: null,
    transcriptJson: null,
    finalStateJson: null,
    extraJson: null,
    inputTokens: null,
    outputTokens: null,
    thinkingTokens: null,
    ttftMs: null,
    prefillTps: null,
    decodeTps: null,
    totalMs: null,
    timingSource: null,
    cacheHit: null,
    vramPeakMb: null,
    gpuUtilAvg: null,
    gpuTempMax: null,
    offloadRatio: null,
    turns: null,
    toolCalls: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: null,
  };
}

function autoScore(id: string, trialId: string, value: number): EvalScoreRow {
  return {
    id,
    trialId,
    scorerKey: 'default',
    scorerType: 'exact',
    value,
    verdict: value >= 0.5 ? 'correct' : 'incorrect',
    reason: null,
    extracted: null,
    judgeRaw: null,
    source: 'auto',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function config(packs: EvalPackManifest[]): EvalRunConfig {
  return {
    name: 'test-run',
    profile: BUILTIN_PROFILES[0],
    packs: packs.map((p) => ({
      scope: 'builtin' as const,
      packId: p.id,
      version: p.version,
      contentHash: 'hash',
      tier: 'standard' as const,
      epochs: 1,
      circular: false,
      sampleIds: ['s1', 's2', 's3', 's4'],
    })),
    candidates: [snapshot('m-a'), snapshot('m-b')],
    judge: null,
    options: {
      deterministicMode: false,
      reliabilityEpochs: 2,
      timeoutMultiplier: 1,
      perfRepeats: 1,
      unloadBetweenCandidates: false,
      sampleOrderSeed: 1234,
    },
    confirmations: {
      weightsConfirmedAt: '2026-01-01T00:00:00.000Z',
      externalTransfers: [],
      externalConfirmedAt: null,
      codeExecution: null,
    },
  };
}

describe('aggregateRun', () => {
  it('rolls pack scores up to composite with N/A renormalization and Q8 exclusion', () => {
    const packs = [pack('pack-q1', 'Q1'), pack('pack-q8', 'Q8')];
    const trials: EvalTrialRow[] = [];
    const scores: EvalScoreRow[] = [];
    // candA: Q1 accuracy 0.75 (3/4), Q8 accuracy 0.0; candB: Q1 0.25, Q8 1.0
    const plan: [string, string, number[]][] = [
      ['candA', 'pack-q1', [1, 1, 1, 0]],
      ['candA', 'pack-q8', [0, 0, 0, 0]],
      ['candB', 'pack-q1', [1, 0, 0, 0]],
      ['candB', 'pack-q8', [1, 1, 1, 1]],
    ];
    for (const [cand, packId, vals] of plan) {
      vals.forEach((v, i) => {
        const tid = `${cand}-${packId}-s${i}`;
        trials.push(trial(tid, cand, packId, `s${i}`));
        scores.push(autoScore(`sc-${tid}`, tid, v));
      });
    }
    const out = aggregateRun({
      runId: 'run1',
      config: config(packs),
      candidates: [
        { id: 'candA', label: 'A', loadMs: null },
        { id: 'candB', label: 'B', loadMs: null },
      ],
      trials,
      scores,
      packs,
      hardware: null,
      compositeIterations: 100,
    });

    const get = (cand: string, level: string, key: string) =>
      out.rows.find((r) => r.candidateId === cand && r.level === level && r.key === key);
    // Q1: A=75, B=25
    expect(get('candA', 'pack', 'pack-q1')?.normalized).toBeCloseTo(75, 10);
    expect(get('candB', 'pack', 'pack-q1')?.normalized).toBeCloseTo(25, 10);
    // Q8 category row exists but Q dimension ignores it
    expect(get('candA', 'category', 'Q8')?.normalized).toBeCloseTo(0, 10);
    expect(get('candA', 'category', 'Q1')?.normalized).toBeCloseTo(75, 10);
    expect(get('candA', 'dimension', 'Q')?.normalized).toBeCloseTo(75, 10);
    expect(get('candB', 'dimension', 'Q')?.normalized).toBeCloseTo(25, 10);
    // S1 = mean(100, 100) (zero failure/format rates); P/A/R are N/A.
    // balanced: Q30 S15 -> A = (75*30 + 100*15)/45 = 83.33, B = (25*30+100*15)/45 = 50
    expect(get('candA', 'dimension', 'S')?.normalized).toBeCloseTo(100, 10);
    expect(get('candA', 'composite', 'composite')?.normalized).toBeCloseTo(83.3333, 2);
    expect(get('candB', 'composite', 'composite')?.normalized).toBeCloseTo(50, 2);
    // CIs populated for pack and composite rows
    expect(get('candA', 'pack', 'pack-q1')?.ciLow).not.toBeNull();
    expect(get('candA', 'composite', 'composite')?.ciLow).not.toBeNull();
    // coverage: (30+15)/100 = 0.45
    expect(out.coverage['candA']).toBeCloseTo(0.45, 10);
  });

  it('weights categories by sample count', () => {
    const packs = [pack('pack-a', 'Q1'), pack('pack-b', 'Q1')];
    const trials: EvalTrialRow[] = [];
    const scores: EvalScoreRow[] = [];
    // pack-a: 1 sample @1.0 ; pack-b: 3 samples @0.0 -> Q1 = (1*1 + 3*0)/4 = 25
    trials.push(trial('t1', 'candA', 'pack-a', 's1'));
    scores.push(autoScore('sc1', 't1', 1));
    ['s2', 's3', 's4'].forEach((s, i) => {
      trials.push(trial(`t${i + 2}`, 'candA', 'pack-b', s));
      scores.push(autoScore(`sc${i + 2}`, `t${i + 2}`, 0));
    });
    const out = aggregateRun({
      runId: 'run1',
      config: config(packs),
      candidates: [{ id: 'candA', label: 'A', loadMs: null }],
      trials,
      scores,
      packs,
      hardware: null,
      compositeIterations: 50,
    });
    const q1 = out.rows.find((r) => r.level === 'category' && r.key === 'Q1');
    expect(q1?.normalized).toBeCloseTo(25, 10);
  });
});
