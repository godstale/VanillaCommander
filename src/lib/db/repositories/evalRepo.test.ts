import { describe, expect, it, beforeEach } from 'vitest';
import {
  setDatabase,
  MemorySqlFallback,
  getGlobalDatabase,
} from '@/lib/db/client';
import { BUILTIN_PROFILES } from '@/lib/eval/constants';
import type {
  CandidateSnapshot,
  EvalAggregateRow,
  EvalRunConfig,
  EvalScoreRow,
  EvalTrialRow,
  HardwareFingerprint,
} from '@/lib/eval/types';
import {
  createRun,
  deleteRun,
  getRun,
  insertArenaVote,
  insertCandidates,
  listAggregates,
  listArenaVotes,
  listCandidates,
  listCompletedTrialKeys,
  listProfiles,
  listRuns,
  listScores,
  listTrials,
  markInterruptedRuns,
  pruneRunOutputs,
  replaceAggregates,
  saveProfile,
  deleteProfile,
  deleteArenaVote,
  updateCandidate,
  updateRunProgress,
  updateRunStatus,
  upsertScores,
  upsertTrial,
} from './evalRepo';

const hardware: HardwareFingerprint = {
  gpuName: 'Test GPU',
  vramTotalMb: 12288,
  isNvidia: true,
  ramTotalMb: 32768,
  os: 'windows',
  appVersion: '0.1.0',
  providerVersions: { ollama: '0.12.11' },
};

const candidate: CandidateSnapshot = {
  label: 'test-agent · qwen3:8b',
  sourceAgentId: null,
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  endpointClass: 'local',
  model: 'qwen3:8b',
  systemPrompt: 'You are helpful.',
  temperature: 0.7,
  reasoning: 'default',
  reasoningEffort: 'medium',
  contextSize: 8192,
  reserveTokens: 2048,
  keepRecentTokens: 2048,
  enabledBuiltinTools: ['read', 'ls'],
  enabledSkills: [],
};

function makeConfig(): EvalRunConfig {
  return {
    name: 'test-run',
    profile: BUILTIN_PROFILES[0],
    packs: [
      {
        scope: 'builtin',
        packId: 'fab-tools-select',
        version: '1.0.0',
        contentHash: 'abc123',
        tier: 'smoke',
        epochs: 1,
        circular: false,
        sampleIds: ['s1', 's2'],
      },
    ],
    candidates: [candidate],
    judge: null,
    options: {
      deterministicMode: false,
      reliabilityEpochs: 3,
      timeoutMultiplier: 1,
      perfRepeats: 3,
      unloadBetweenCandidates: true,
      sampleOrderSeed: 42,
    },
    confirmations: {
      weightsConfirmedAt: new Date().toISOString(),
      externalTransfers: [],
      externalConfirmedAt: null,
      codeExecution: null,
    },
  };
}

function makeTrial(overrides: Partial<EvalTrialRow> & Pick<EvalTrialRow, 'id' | 'runId' | 'candidateId'>): EvalTrialRow {
  const now = new Date().toISOString();
  return {
    packId: 'fab-tools-select',
    sampleId: 's1',
    epoch: 1,
    outcome: 'ok',
    outputText: 'answer',
    reasoningText: null,
    transcriptJson: null,
    finalStateJson: null,
    extraJson: null,
    inputTokens: 10,
    outputTokens: 5,
    thinkingTokens: null,
    ttftMs: 100,
    prefillTps: 500,
    decodeTps: 20,
    totalMs: 500,
    timingSource: 'server',
    cacheHit: false,
    vramPeakMb: 8000,
    gpuUtilAvg: 80,
    gpuTempMax: 65,
    offloadRatio: 1,
    turns: 1,
    toolCalls: 0,
    startedAt: now,
    finishedAt: now,
    ...overrides,
  };
}

function makeScore(overrides: Partial<EvalScoreRow> & Pick<EvalScoreRow, 'id' | 'trialId'>): EvalScoreRow {
  return {
    scorerKey: 'tool_call_ast',
    scorerType: 'tool_call_ast',
    value: 1,
    verdict: 'correct',
    reason: 'all matched',
    extracted: null,
    judgeRaw: null,
    source: 'auto',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('evalRepo', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
  });

  it('inserts and reads run → candidate → trial → score', async () => {
    const runId = await createRun(makeConfig(), hardware);
    const [cand] = await insertCandidates(runId, [candidate]);
    await upsertTrial(makeTrial({ id: 't1', runId, candidateId: cand.id }));
    await upsertScores([makeScore({ id: 's1', trialId: 't1' })]);

    expect((await getRun(runId))?.name).toBe('test-run');
    expect(await listCandidates(runId)).toHaveLength(1);
    expect(await listTrials(runId)).toHaveLength(1);
    expect(await listScores(runId)).toHaveLength(1);
  });

  it('upserts trials and scores on unique keys', async () => {
    const runId = await createRun(makeConfig(), hardware);
    const [cand] = await insertCandidates(runId, [candidate]);
    await upsertTrial(makeTrial({ id: 't1', runId, candidateId: cand.id, outcome: 'ok' }));
    await upsertTrial(
      makeTrial({ id: 't2', runId, candidateId: cand.id, outcome: 'timeout', outputText: null }),
    );
    const trials = await listTrials(runId);
    expect(trials).toHaveLength(1);
    expect(trials[0].outcome).toBe('timeout');

    await upsertScores([makeScore({ id: 's1', trialId: trials[0].id, value: 0 })]);
    await upsertScores([makeScore({ id: 's2', trialId: trials[0].id, value: 1 })]);
    const scores = await listScores(runId);
    expect(scores).toHaveLength(1);
    expect(scores[0].value).toBe(1);
  });

  it('deletes a run with cascade', async () => {
    const runId = await createRun(makeConfig(), hardware);
    const [cand] = await insertCandidates(runId, [candidate]);
    await upsertTrial(makeTrial({ id: 't1', runId, candidateId: cand.id }));
    await upsertScores([makeScore({ id: 's1', trialId: 't1' })]);
    await replaceAggregates(runId, [
      {
        runId,
        candidateId: cand.id,
        level: 'composite',
        key: 'composite',
        raw: 80,
        normalized: 80,
        ciLow: 75,
        ciHigh: 85,
        n: 10,
        anchorsVersion: 'anchors-v1',
        computedAt: new Date().toISOString(),
      } satisfies EvalAggregateRow,
    ]);
    await deleteRun(runId);
    expect(await getRun(runId)).toBeNull();
    expect(await listCandidates(runId)).toHaveLength(0);
    expect(await listTrials(runId)).toHaveLength(0);
    expect(await listScores(runId)).toHaveLength(0);
    expect(await listAggregates(runId)).toHaveLength(0);
  });

  it('lists completed trial keys excluding cancelled', async () => {
    const runId = await createRun(makeConfig(), hardware);
    const [cand] = await insertCandidates(runId, [candidate]);
    await upsertTrial(makeTrial({ id: 't1', runId, candidateId: cand.id, sampleId: 's1' }));
    await upsertTrial(
      makeTrial({ id: 't2', runId, candidateId: cand.id, sampleId: 's2', outcome: 'cancelled' }),
    );
    const keys = await listCompletedTrialKeys(runId);
    expect(keys.size).toBe(1);
    expect([...keys][0]).toContain('s1');
  });

  it('marks running/judging/paused runs as interrupted', async () => {
    const running = await createRun(makeConfig(), hardware);
    const done = await createRun(makeConfig(), hardware);
    await updateRunStatus(running, 'running', { startedAt: new Date().toISOString() });
    await updateRunStatus(done, 'completed', { finishedAt: new Date().toISOString() });
    const affected = await markInterruptedRuns();
    expect(affected).toBe(1);
    expect((await getRun(running))?.status).toBe('interrupted');
    expect((await getRun(done))?.status).toBe('completed');
  });

  it('prunes old trial outputs but keeps aggregates', async () => {
    const runId = await createRun(makeConfig(), hardware);
    const [cand] = await insertCandidates(runId, [candidate]);
    await upsertTrial(
      makeTrial({
        id: 't-old',
        runId,
        candidateId: cand.id,
        startedAt: '2020-01-01T00:00:00.000Z',
      }),
    );
    await upsertTrial(makeTrial({ id: 't-new', runId, candidateId: cand.id, sampleId: 's2' }));
    const pruned = await pruneRunOutputs('2021-01-01T00:00:00.000Z');
    expect(pruned).toBe(1);
    const trials = await listTrials(runId);
    expect(trials.find((t) => t.id === 't-old')?.outputText).toBeNull();
    expect(trials.find((t) => t.id === 't-new')?.outputText).toBe('answer');
  });

  it('updates run progress and candidate fields', async () => {
    const runId = await createRun(makeConfig(), hardware);
    await updateRunProgress(runId, 5, 10);
    expect((await getRun(runId))?.progressDone).toBe(5);
    const [cand] = await insertCandidates(runId, [candidate]);
    await updateCandidate(cand.id, { status: 'done', loadMs: 1234 });
    const updated = (await listCandidates(runId))[0];
    expect(updated.status).toBe('done');
    expect(updated.loadMs).toBe(1234);
  });

  it('lists runs with status filter and limit', async () => {
    const a = await createRun({ ...makeConfig(), name: 'a' }, hardware);
    await createRun({ ...makeConfig(), name: 'b' }, hardware);
    await updateRunStatus(a, 'completed');
    expect(await listRuns({ status: ['completed'] })).toHaveLength(1);
    expect(await listRuns({ limit: 1 })).toHaveLength(1);
  });

  it('skips corrupt JSON rows instead of throwing', async () => {
    const db = await getGlobalDatabase();
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO eval_runs (id, name, config_json, hardware_json, status, error, progress_done, progress_total, started_at, finished_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', NULL, 0, 0, NULL, NULL, ?, ?)`,
      ['bad-run', 'bad', 'not-json', '{}', now, now],
    );
    expect(await getRun('bad-run')).toBeNull();
    expect(await listRuns()).toHaveLength(0);
  });

  it('saves, lists, and deletes profiles and arena votes', async () => {
    await saveProfile(BUILTIN_PROFILES[1]);
    expect(await listProfiles()).toHaveLength(1);
    await deleteProfile(BUILTIN_PROFILES[1].id);
    expect(await listProfiles()).toHaveLength(0);

    const voteId = await insertArenaVote({
      promptHash: 'hash1',
      promptPreview: 'hello',
      aSnapshot: candidate,
      bSnapshot: candidate,
      aLabel: 'A',
      bLabel: 'B',
      winner: 'a',
      workspaceRoot: null,
    });
    expect(await listArenaVotes()).toHaveLength(1);
    await deleteArenaVote(voteId);
    expect(await listArenaVotes()).toHaveLength(0);
  });

  it('replaces aggregates per run', async () => {
    const runId = await createRun(makeConfig(), hardware);
    const [cand] = await insertCandidates(runId, [candidate]);
    const row: EvalAggregateRow = {
      runId,
      candidateId: cand.id,
      level: 'metric',
      key: 'accuracy',
      raw: 0.8,
      normalized: 80,
      ciLow: 70,
      ciHigh: 90,
      n: 20,
      anchorsVersion: 'anchors-v1',
      computedAt: new Date().toISOString(),
    };
    await replaceAggregates(runId, [row]);
    await replaceAggregates(runId, [{ ...row, normalized: 85 }]);
    const rows = await listAggregates(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0].normalized).toBe(85);
  });
});
