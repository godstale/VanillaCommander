import { describe, expect, it, beforeEach } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { BUILTIN_PROFILES } from '../constants';
import type { CandidateSnapshot, EvalRunConfig, EvalScoreRow, HardwareFingerprint } from '../types';
import {
  createRun,
  insertCandidates,
  listScores,
  upsertTrial,
} from '@/lib/db/repositories/evalRepo';
import { pickEffectiveScore } from '../scoring/metrics';
import { getScorer } from './index';
import { humanScorer, saveHumanScore } from './human';

const hardware: HardwareFingerprint = {
  gpuName: 'Test GPU',
  vramTotalMb: 12288,
  isNvidia: true,
  ramTotalMb: 32768,
  os: 'test',
  appVersion: '0.1.0',
  providerVersions: {},
};

const candidate: CandidateSnapshot = {
  label: 'c1',
  sourceAgentId: null,
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  endpointClass: 'local',
  model: 'cand-model',
  systemPrompt: 'sys',
  temperature: 0.5,
  reasoning: 'default',
  reasoningEffort: 'medium',
  contextSize: 8192,
  reserveTokens: 0,
  keepRecentTokens: 0,
  enabledBuiltinTools: ['read'],
  enabledSkills: [],
};

function row(over: Partial<EvalScoreRow> & { trialId: string }): EvalScoreRow {
  return {
    id: crypto.randomUUID(),
    scorerKey: 'llm_judge_rubric',
    scorerType: 'llm_judge_rubric',
    value: 0,
    verdict: 'incorrect',
    reason: null,
    extracted: null,
    judgeRaw: null,
    source: 'auto',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  setDatabase(new MemorySqlFallback());
});

describe('human scorer', () => {
  it('registers as async-only and throws when scored directly', async () => {
    expect(getScorer('human')).toBe(humanScorer);
    expect(humanScorer.requiresAsync).toBe(true);
    await expect(
      humanScorer.score(
        { sample: { id: 's', input: 'q' }, pack: { id: 'p' }, outputText: 'o', toolCalls: [] } as unknown as Parameters<typeof humanScorer.score>[0],
        {},
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow('use judge pass');
  });

  it('saveHumanScore persists source=human rows', async () => {
    const config = {
      name: 'h',
      profile: BUILTIN_PROFILES[0],
      packs: [],
      candidates: [candidate],
      judge: null,
      options: {
        deterministicMode: false,
        reliabilityEpochs: 3,
        timeoutMultiplier: 1,
        perfRepeats: 1,
        unloadBetweenCandidates: false,
        sampleOrderSeed: 1,
      },
      confirmations: {
        weightsConfirmedAt: new Date().toISOString(),
        externalTransfers: [],
        externalConfirmedAt: null,
        codeExecution: null,
      },
    } as unknown as EvalRunConfig;
    const runId = await createRun(config, hardware);
    const [cand] = await insertCandidates(runId, [candidate]);
    const now = new Date().toISOString();
    await upsertTrial({
      id: 't1',
      runId,
      candidateId: cand.id,
      packId: 'p',
      sampleId: 's',
      epoch: 0,
      outcome: 'ok',
      outputText: 'out',
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
      startedAt: now,
      finishedAt: now,
    });

    await saveHumanScore('t1', 'llm_judge_rubric', 0.9, 'correct', 'rater note');

    const scores = await listScores(runId);
    expect(scores).toHaveLength(1);
    expect(scores[0].source).toBe('human');
    expect(scores[0].value).toBe(0.9);
    expect(scores[0].verdict).toBe('correct');
    expect(scores[0].reason).toBe('rater note');
  });

  it('human outranks judge outranks auto in pickEffectiveScore', () => {
    const picked = pickEffectiveScore([
      row({ trialId: 't', source: 'auto', value: 0.2, verdict: 'incorrect' }),
      row({ trialId: 't', source: 'judge', value: 0.6, verdict: 'partial', id: 'j1' }),
      row({ trialId: 't', source: 'human', value: 1, verdict: 'correct', id: 'h1' }),
    ]);
    expect(picked).toHaveLength(1);
    expect(picked[0].source).toBe('human');
    expect(picked[0].value).toBe(1);

    const judgeWins = pickEffectiveScore([
      row({ trialId: 't2', source: 'auto', value: 0.2, verdict: 'incorrect' }),
      row({ trialId: 't2', source: 'judge', value: 0.6, verdict: 'partial', id: 'j2' }),
    ]);
    expect(judgeWins).toHaveLength(1);
    expect(judgeWins[0].source).toBe('judge');
  });
});
