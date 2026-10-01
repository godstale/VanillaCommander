import { describe, expect, it } from 'vitest';
import type { EvalScoreRow, EvalTrialRow } from '../types';
import {
  combineTrialScores,
  computeCandidateMetrics,
  computeMetrics,
  pickEffectiveScore,
} from './metrics';

let trialSeq = 0;
let scoreSeq = 0;

function trial(overrides: Partial<EvalTrialRow> = {}): EvalTrialRow {
  trialSeq += 1;
  return {
    id: `t${trialSeq}`,
    runId: 'run1',
    candidateId: 'candA',
    packId: 'pack-q',
    sampleId: 's1',
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
    ...overrides,
  };
}

function score(overrides: Partial<EvalScoreRow> = {}): EvalScoreRow {
  scoreSeq += 1;
  return {
    id: `sc${scoreSeq}`,
    trialId: 't1',
    scorerKey: 'default',
    scorerType: 'exact',
    value: 1,
    verdict: 'correct',
    reason: null,
    extracted: null,
    judgeRaw: null,
    source: 'auto',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('pickEffectiveScore', () => {
  it('prefers human > judge > auto', () => {
    const rows = [
      score({ trialId: 't1', scorerKey: 'k', source: 'auto', value: 0 }),
      score({ trialId: 't1', scorerKey: 'k', source: 'judge', value: 1 }),
      score({ trialId: 't1', scorerKey: 'k', source: 'human', value: 0 }),
      score({ trialId: 't1', scorerKey: 'other', source: 'auto', value: 1 }),
    ];
    const picked = pickEffectiveScore(rows);
    expect(picked).toHaveLength(2);
    expect(picked.find((s) => s.scorerKey === 'k')?.source).toBe('human');
    expect(combineTrialScores(picked.filter((s) => s.scorerKey === 'k'))).toBe(0);
  });
});

describe('computeMetrics', () => {
  it('averages epochs then applies the pack aggregation', () => {
    const trials = [
      trial({ id: 't1', sampleId: 's1', epoch: 0 }),
      trial({ id: 't2', sampleId: 's1', epoch: 1 }),
      trial({ id: 't3', sampleId: 's2', epoch: 0 }),
    ];
    const scores = [
      score({ trialId: 't1', value: 1 }),
      score({ trialId: 't2', value: 0 }),
      score({ trialId: 't3', value: 1 }),
    ];
    const packs = [
      {
        schemaVersion: '1.0',
        id: 'pack-q',
        version: '1.0.0',
        title: { ko: 'q', en: 'q' },
        description: { ko: 'q', en: 'q' },
        category: 'Q1',
        lang: ['ko'],
        license: { id: 'x' },
        kind: 'single_turn',
        source: { type: 'jsonl', file: 'samples.jsonl' },
        scorers: [],
        metrics: [
          {
            id: 'accuracy',
            description: { ko: 'a', en: 'a' },
            source: 'score',
            aggregation: 'mean',
            lowerIsBetter: false,
            scoreType: 'binary',
            range: { min: 0, max: 1 },
            normalization: { kind: 'baseline', baseline: 0, ceiling: 1 },
            countsTowardComposite: true,
          },
        ],
        tiers: { smoke: 1, standard: 2, full: 2 },
        defaults: {},
        requires: {},
        trusted: false,
      },
    ] as never;
    const out = computeMetrics(trials, scores, packs);
    expect(out).toHaveLength(1);
    // sample means 0.5 and 1 -> mean 0.75
    expect(out[0].value).toBeCloseTo(0.75, 10);
    expect(out[0].n).toBe(2);
    expect(out[0].sampleValues).toHaveLength(2);
  });
});

describe('computeCandidateMetrics', () => {
  const ctx = (overrides = {}) => ({
    loadMs: null,
    vramTotalMb: null as number | null,
    packKinds: { 'pack-q': 'single_turn', 'pack-p': 'perf_probe' } as Record<string, 'single_turn' | 'perf_probe'>,
    ...overrides,
  });

  it('computes failure and format error rates', () => {
    const trials = [
      trial({ id: 't1', outcome: 'timeout' }),
      trial({ id: 't2', outcome: 'ok' }),
      trial({ id: 't3', outcome: 'ok' }),
      trial({ id: 't4', outcome: 'parse_error' }),
    ];
    const scores = [score({ trialId: 't2', verdict: 'no_answer', value: 0 })];
    const m = computeCandidateMetrics(trials, scores, 'candA', ctx());
    expect(m['failure_rate'].value).toBeCloseTo(0.25, 10);
    // parse_error + no_answer verdict = 2/4
    expect(m['format_error_rate'].value).toBeCloseTo(0.5, 10);
  });

  it('excludes perf_probe trials from format errors and filters prefill by cache', () => {
    const trials = [
      trial({ id: 't1', packId: 'pack-p', outcome: 'parse_error' }),
      trial({ id: 't2', outcome: 'ok', prefillTps: 100, cacheHit: false }),
      trial({ id: 't3', outcome: 'ok', prefillTps: 9999, cacheHit: true }),
    ];
    const m = computeCandidateMetrics(trials, [], 'candA', ctx());
    expect(m['format_error_rate'].value).toBe(0);
    expect(m['prefill_tps'].value).toBe(100);
    expect(m['decode_tps'].value).toBeNull();
  });

  it('computes vram headroom, pass_hat_k, stddev and effective context', () => {
    const trials = [
      trial({ id: 't1', sampleId: 's1', epoch: 0, vramPeakMb: 8000 }),
      trial({ id: 't2', sampleId: 's1', epoch: 1, vramPeakMb: 9000 }),
      trial({ id: 't3', sampleId: 's2', epoch: 0 }),
      trial({ id: 't4', packId: 'pack-l', sampleId: 'l1', inputTokens: 1000 }),
      trial({ id: 't5', packId: 'pack-l', sampleId: 'l2', inputTokens: 4000 }),
      trial({ id: 't6', packId: 'pack-l', sampleId: 'l3', inputTokens: 8000 }),
    ];
    const scores = [
      score({ trialId: 't1', value: 1 }),
      score({ trialId: 't2', value: 1 }),
      score({ trialId: 't3', value: 0 }),
      score({ trialId: 't4', value: 1 }),
      score({ trialId: 't5', value: 1 }),
      score({ trialId: 't6', value: 0 }),
    ];
    const c = ctx({
      vramTotalMb: 18000,
      packKinds: { 'pack-q': 'single_turn', 'pack-l': 'long_context' } as Record<
        string,
        'single_turn' | 'long_context'
      >,
      reliabilityEpochs: 2,
    });
    const m = computeCandidateMetrics(trials, scores, 'candA', c);
    expect(m['vram_headroom'].value).toBeCloseTo(0.5, 10);
    // s1: C(2,2)/C(2,2)=1
    expect(m['pass_hat_k'].value).toBe(1);
    expect(m['score_stddev'].value).toBe(0);
    // shortest acc 1.0; 4k acc 1.0 kept; 8k acc 0 dropped
    expect(m['effective_context_tokens'].value).toBe(4000);
    // correct: t1, t2, t4, t5 -> tokens (1000+4000)/4
    expect(m['tokens_per_correct'].value).toBe(1250);
  });
});
