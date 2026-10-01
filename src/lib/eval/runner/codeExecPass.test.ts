import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { createRun, insertCandidates, listScores, upsertTrial } from '@/lib/db/repositories/evalRepo';
import { chatQueueManager } from '@/lib/agent/chatQueueManager';
import { evalLock } from '../evalLock';
import { runCodeExecPass } from './codeExecPass';
import type { LoadedPack } from '../packs/packLoader';
import type { EvalRunConfig, EvalTrialRow } from '../types';
import { BUILTIN_PROFILES } from '../constants';

vi.mock('../runtimes/jsWorkerHost', () => ({
  runJsTests: vi.fn(),
}));

import { runJsTests } from '../runtimes/jsWorkerHost';

const mockedRunJsTests = vi.mocked(runJsTests);

const hardware = {
  gpuName: 'Test GPU',
  vramTotalMb: 12288,
  isNvidia: true,
  ramTotalMb: 32768,
  os: 'test',
  appVersion: '0.1.0',
  providerVersions: {},
} as const;

const candidate = {
  label: 'c1',
  sourceAgentId: null,
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  endpointClass: 'local',
  model: 'test-model',
  systemPrompt: 'sys',
  temperature: 0.5,
  reasoning: 'default',
  reasoningEffort: 'medium',
  contextSize: 8192,
  reserveTokens: 0,
  keepRecentTokens: 0,
  enabledBuiltinTools: ['read'],
  enabledSkills: [],
} as const;

const CODE_SPEC = {
  entryPoint: 'add',
  tests: 'assertEqual(add(1, 2), 3);',
  language: 'js',
} as const;

function packStub(): LoadedPack {
  return {
    scope: 'builtin',
    manifest: {
      id: 'code-pack',
      scorers: [{ type: 'code_exec' }],
    },
    contentHash: 'stub',
    samples: [
      {
        id: 's1',
        input: 'write add',
        code: CODE_SPEC,
        scorers: [{ type: 'code_exec' }],
      },
      {
        id: 's2',
        input: 'write add',
        code: CODE_SPEC,
        scorers: [{ type: 'code_exec' }],
      },
      {
        id: 's3',
        input: 'write add',
        code: CODE_SPEC,
        scorers: [{ type: 'code_exec' }],
      },
    ],
  } as unknown as LoadedPack;
}

function config(): EvalRunConfig {
  return {
    name: 'run',
    profile: BUILTIN_PROFILES[0],
    packs: [
      {
        scope: 'builtin',
        packId: 'code-pack',
        version: '1.0.0',
        contentHash: 'stub',
        tier: 'smoke',
        epochs: 1,
        circular: false,
        sampleIds: ['s1', 's2', 's3'],
      },
    ],
    candidates: [{ ...candidate }],
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
}

async function seedTrials(runId: string, candidateId: string): Promise<void> {
  const base = {
    runId,
    candidateId,
    packId: 'code-pack',
    epoch: 0,
    outcome: 'ok',
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
    totalMs: 10,
    timingSource: 'client',
    cacheHit: null,
    vramPeakMb: null,
    gpuUtilAvg: null,
    gpuTempMax: null,
    offloadRatio: null,
    turns: 1,
    toolCalls: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  } as const;
  const outputs = [
    '```js\nfunction add(a, b) { return a + b; }\n```',
    '```js\nfunction add(a, b) { return a - b; }\n```',
    '   ',
  ];
  const ids = ['s1', 's2', 's3'];
  for (let i = 0; i < 3; i++) {
    await upsertTrial({
      ...base,
      id: `t${i + 1}`,
      sampleId: ids[i],
      outputText: outputs[i],
    } as unknown as EvalTrialRow);
  }
}

describe('runCodeExecPass', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
    chatQueueManager.resetAll();
    const lock = evalLock.get();
    if (lock) evalLock.release(lock.runId);
    vi.clearAllMocks();
  });

  it('scores missing code_exec trials and is idempotent', async () => {
    mockedRunJsTests
      .mockResolvedValueOnce({ passed: 1, failed: 0, error: null, timedOut: false })
      .mockResolvedValueOnce({ passed: 0, failed: 1, error: 'assertEqual failed: boom', timedOut: false });
    const runId = await createRun(config(), { ...hardware });
    const [c] = await insertCandidates(runId, config().candidates);
    await seedTrials(runId, c.id);

    const first = await runCodeExecPass(runId, {
      loadPacks: async () => [packStub()],
    });
    expect(first).toMatchObject({ scoredTrials: 2, scoresWritten: 3 });
    const scores = await listScores(runId);
    expect(scores).toHaveLength(3);
    const byTrial = new Map(scores.map((s) => [s.trialId, s]));
    expect(byTrial.get('t1')).toMatchObject({ value: 1, verdict: 'correct', source: 'auto' });
    expect(byTrial.get('t2')).toMatchObject({ value: 0, verdict: 'incorrect' });
    expect(byTrial.get('t3')).toMatchObject({ value: 0, verdict: 'no_answer' });
    expect(mockedRunJsTests).toHaveBeenCalledTimes(2);

    const second = await runCodeExecPass(runId, {
      loadPacks: async () => [packStub()],
    });
    expect(second).toMatchObject({ scoredTrials: 0, scoresWritten: 0 });
    expect(await listScores(runId)).toHaveLength(3);
    expect(mockedRunJsTests).toHaveBeenCalledTimes(2);
  });

  it('returns empty result for unknown runs', async () => {
    const r = await runCodeExecPass('missing', { loadPacks: async () => [] });
    expect(r).toMatchObject({ scoredTrials: 0, scoresWritten: 0, errors: 0 });
  });
});
