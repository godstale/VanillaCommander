import { describe, expect, it, beforeEach, vi } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { BUILTIN_PROFILES } from '../constants';
import type {
  CandidateSnapshot,
  EvalRunConfig,
  EvalTrialRow,
  HardwareFingerprint,
  JudgeConfig,
} from '../types';
import type { LlmStreamChatFn } from '@/lib/llm/providerRuntime';
import {
  createRun,
  insertCandidates,
  listScores,
  upsertTrial,
} from '@/lib/db/repositories/evalRepo';
import { createMemoryPackFs } from '../packs/packFs';
import { listPacks, loadPack, type LoadedPack } from '../packs/packLoader';
import {
  judgeDataClasses,
  normalizeRubricScore,
  runJudgePass,
} from './judgePass';

const hardware: HardwareFingerprint = {
  gpuName: 'Test GPU',
  vramTotalMb: 12288,
  isNvidia: true,
  ramTotalMb: 32768,
  os: 'test',
  appVersion: '0.1.0',
  providerVersions: {},
};

const METRIC = {
  id: 'accuracy',
  description: { ko: 'd', en: 'd' },
  source: 'score',
  aggregation: 'mean',
  lowerIsBetter: false,
  scoreType: 'binary',
  range: { min: 0, max: 1 },
  normalization: { kind: 'baseline', baseline: 0 },
};

function manifest(id: string, scorerType: string): Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    id,
    version: '1.0.0',
    title: { ko: 'd', en: 'd' },
    description: { ko: 'd', en: 'd' },
    category: 'Q1',
    lang: ['ko'],
    license: { id: 't' },
    kind: 'single_turn',
    source: { type: 'jsonl', file: 'samples.jsonl' },
    scorers: [{ type: scorerType }],
    metrics: [METRIC],
    tiers: { smoke: 2, standard: 2, full: 'all' },
  };
}

const SAMPLES = [
  JSON.stringify({ id: 's1', input: 'What is 2+2?', reference: '4', rubric: 'Award full marks for 4.' }),
].join('\n');

function candidateSnapshot(label: string, model: string): CandidateSnapshot {
  return {
    label,
    sourceAgentId: null,
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    endpointClass: 'local',
    model,
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
}

function makeJudge(pairwise: JudgeConfig['pairwise'], model = 'judge-model'): JudgeConfig {
  return {
    target: {
      type: 'local',
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model,
      sourceAgentId: null,
    },
    scale: '1-5',
    pairwise,
    promptVersion: 'judge-v1',
  };
}

async function setupPack(scorerType: string): Promise<{ packId: string; pack: LoadedPack; contentHash: string }> {
  const packId = `j${scorerType.replace(/[^a-z]/g, '')}`;
  const fs = createMemoryPackFs({
    builtin: { [packId]: { 'manifest.json': JSON.stringify(manifest(packId, scorerType)), 'samples.jsonl': SAMPLES } },
  });
  const { refs } = await listPacks(fs);
  const pack = await loadPack(fs, refs[0]);
  return { packId, pack, contentHash: pack.contentHash };
}

function makeConfig(packId: string, contentHash: string, judge: JudgeConfig, candidates: CandidateSnapshot[]): EvalRunConfig {
  return {
    name: 'judge-run',
    profile: BUILTIN_PROFILES[0],
    packs: [
      {
        scope: 'builtin',
        packId,
        version: '1.0.0',
        contentHash,
        tier: 'smoke',
        epochs: 1,
        circular: false,
        sampleIds: ['s1'],
      },
    ],
    candidates,
    judge,
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
  };
}

function makeTrial(over: Partial<EvalTrialRow> & { id: string; runId: string; candidateId: string }): EvalTrialRow {
  const now = new Date().toISOString();
  return {
    packId: '',
    sampleId: 's1',
    epoch: 0,
    outcome: 'ok',
    outputText: 'The answer is 4.',
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
    ...over,
  };
}

interface Seen {
  reqs: Array<{ model?: unknown; temperature?: unknown; seed?: unknown }>;
  prompts: string[];
}

function queueFactory(texts: string[], seen: Seen): LlmStreamChatFn {
  return async function* (req) {
    seen.reqs.push({ model: req.model, temperature: req.temperature, seed: req.seed });
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    seen.prompts.push(typeof lastUser?.content === 'string' ? lastUser.content : '');
    const text = texts.shift() ?? '{"winner":"tie","reason":"default"}';
    yield { content: text, done: true };
  };
}

const RUBRIC_OK = '{"criteria":[{"name":"correctness","score":4,"reason":"exact match"}],"overall":4}';

beforeEach(() => {
  setDatabase(new MemorySqlFallback());
  vi.restoreAllMocks();
});

describe('normalizeRubricScore', () => {
  it('maps 1-5 onto 0..1', () => {
    expect(normalizeRubricScore(4, '1-5')).toBeCloseTo(0.75, 10);
    expect(normalizeRubricScore(1, '1-5')).toBe(0);
    expect(normalizeRubricScore(5, '1-5')).toBe(1);
  });
  it('maps 1-10 onto 0..1 and clamps', () => {
    expect(normalizeRubricScore(10, '1-10')).toBe(1);
    expect(normalizeRubricScore(99, '1-10')).toBe(1);
    expect(normalizeRubricScore(-3, '1-5')).toBe(0);
  });
});

describe('judgeDataClasses', () => {
  const pack = (scope: LoadedPack['scope'], category: string, fixture: boolean): LoadedPack =>
    ({
      scope,
      manifest: { category },
      samples: fixture ? [{ fixture: { dir: 'f' } }] : [{}],
    }) as unknown as LoadedPack;

  it('maps builtin packs to public-bundled', () => {
    expect(judgeDataClasses(pack('builtin', 'Q1', false))).toEqual(['public-bundled']);
  });
  it('maps Q9 and user/project packs to personal', () => {
    expect(judgeDataClasses(pack('builtin', 'Q9', false))).toEqual(['personal']);
    expect(judgeDataClasses(pack('user', 'Q1', false))).toEqual(['personal']);
    expect(judgeDataClasses(pack('project', 'Q4', false))).toEqual(['personal']);
  });
  it('adds fixture-files when samples carry fixtures', () => {
    expect(judgeDataClasses(pack('builtin', 'Q1', true))).toEqual(['public-bundled', 'fixture-files']);
    expect(judgeDataClasses(pack('user', 'Q1', true))).toEqual(['personal', 'fixture-files']);
  });
});

describe('runJudgePass rubric', () => {
  it('grades with temperature 0 and a fixed seed, persisting judge rows', async () => {
    const { packId, pack, contentHash } = await setupPack('llm_judge_rubric');
    const runId = await createRun(
      makeConfig(packId, contentHash, makeJudge('none'), [candidateSnapshot('c1', 'cand-model')]),
      hardware,
    );
    const [cand] = await insertCandidates(runId, [candidateSnapshot('c1', 'cand-model')]);
    await upsertTrial(makeTrial({ id: 't1', runId, candidateId: cand.id, packId }));
    const seen: Seen = { reqs: [], prompts: [] };
    const unload = vi.fn(async () => undefined);

    const res = await runJudgePass(runId, {
      streamChatFactory: () => queueFactory([RUBRIC_OK], seen),
      loadPacks: async () => [pack],
      getFamily: async () => null,
      unloadModel: unload,
    });

    expect(res).toEqual({ judgedTrials: 1, scoresWritten: 1, skippedSelf: 0, errors: 0 });
    expect(unload).toHaveBeenCalledWith('http://127.0.0.1:11434', 'cand-model');
    expect(seen.reqs[0]).toMatchObject({ model: 'judge-model', temperature: 0, seed: 42 });
    expect(seen.prompts[0]).toContain('do not reward length');
    const scores = await listScores(runId);
    expect(scores).toHaveLength(1);
    expect(scores[0].source).toBe('judge');
    expect(scores[0].scorerType).toBe('llm_judge_rubric');
    expect(scores[0].value).toBeCloseTo(0.75, 10);
    expect(scores[0].verdict).toBe('correct');
    expect(scores[0].judgeRaw).toContain('overall');
    const reason = JSON.parse(scores[0].reason ?? '{}') as Record<string, unknown>;
    expect(reason['promptVersion']).toBe('judge-v1');
    expect(reason['judgeModel']).toBe('judge-model');
  });

  it('skips self-judging without calling the model', async () => {
    const { packId, pack, contentHash } = await setupPack('llm_judge_rubric');
    const runId = await createRun(
      makeConfig(packId, contentHash, makeJudge('none'), [candidateSnapshot('c1', 'judge-model')]),
      hardware,
    );
    const [cand] = await insertCandidates(runId, [candidateSnapshot('c1', 'judge-model')]);
    await upsertTrial(makeTrial({ id: 't1', runId, candidateId: cand.id, packId }));
    const empty: Seen = { reqs: [], prompts: [] };
    const chat = vi.fn(() => queueFactory([RUBRIC_OK], empty));

    const res = await runJudgePass(runId, {
      streamChatFactory: chat,
      loadPacks: async () => [pack],
      getFamily: async () => null,
      unloadModel: async () => undefined,
    });

    expect(chat).not.toHaveBeenCalled();
    expect(res.skippedSelf).toBe(1);
    expect(res.judgedTrials).toBe(0);
    const scores = await listScores(runId);
    expect(scores).toHaveLength(1);
    expect(scores[0].verdict).toBe('skipped');
    expect(scores[0].reason).toContain('self-judging prevented');
  });

  it('recovers from a non-JSON first answer via re-ask', async () => {
    const { packId, pack, contentHash } = await setupPack('llm_judge_rubric');
    const runId = await createRun(
      makeConfig(packId, contentHash, makeJudge('none'), [candidateSnapshot('c1', 'cand-model')]),
      hardware,
    );
    const [cand] = await insertCandidates(runId, [candidateSnapshot('c1', 'cand-model')]);
    await upsertTrial(makeTrial({ id: 't1', runId, candidateId: cand.id, packId }));
    const seen: Seen = { reqs: [], prompts: [] };

    const res = await runJudgePass(runId, {
      streamChatFactory: () => queueFactory(['Just some prose, no JSON here.', RUBRIC_OK], seen),
      loadPacks: async () => [pack],
      getFamily: async () => null,
      unloadModel: async () => undefined,
    });

    expect(res.errors).toBe(0);
    expect(seen.prompts).toHaveLength(2);
    expect(seen.prompts[1]).toContain('JSON only');
    expect((await listScores(runId))[0].verdict).toBe('correct');
  });

  it('flags same-family judges in the reason', async () => {
    const { packId, pack, contentHash } = await setupPack('llm_judge_rubric');
    const runId = await createRun(
      makeConfig(packId, contentHash, makeJudge('none'), [candidateSnapshot('c1', 'cand-8b')]),
      hardware,
    );
    const [cand] = await insertCandidates(runId, [candidateSnapshot('c1', 'cand-8b')]);
    await upsertTrial(makeTrial({ id: 't1', runId, candidateId: cand.id, packId }));
    const seen: Seen = { reqs: [], prompts: [] };

    await runJudgePass(runId, {
      streamChatFactory: () => queueFactory([RUBRIC_OK], seen),
      loadPacks: async () => [pack],
      getFamily: async () => 'llama',
      unloadModel: async () => undefined,
    });

    expect((await listScores(runId))[0].reason).toContain('same-family');
  });

  it('routes integration judges through the gateway with judge purpose', async () => {
    const { packId, pack, contentHash } = await setupPack('llm_judge_rubric');
    const judge: JudgeConfig = {
      target: { type: 'integration', integrationId: 'int-1' },
      scale: '1-5',
      pairwise: 'none',
      promptVersion: 'judge-v1',
    };
    const runId = await createRun(
      makeConfig(packId, contentHash, judge, [candidateSnapshot('c1', 'cand-model')]),
      hardware,
    );
    const [cand] = await insertCandidates(runId, [candidateSnapshot('c1', 'cand-model')]);
    await upsertTrial(makeTrial({ id: 't1', runId, candidateId: cand.id, packId }));
    const calls: Array<{ id: string; purpose: unknown; dataClasses: unknown }> = [];
    const callIntegration = async (id: string, req: { purpose: unknown; dataClasses: unknown }) => {
      calls.push({ id, purpose: req.purpose, dataClasses: req.dataClasses });
      return { ok: true as const, text: RUBRIC_OK };
    };

    const res = await runJudgePass(runId, {
      loadPacks: async () => [pack],
      callIntegration,
    });

    expect(res.judgedTrials).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'int-1', purpose: 'judge', dataClasses: ['public-bundled'] });
    const scores = await listScores(runId);
    expect(scores[0].reason).toContain('integration:int-1');
  });
});

describe('runJudgePass pairwise', () => {
  it('ties on order-swap mismatch', async () => {
    const { packId, pack, contentHash } = await setupPack('llm_judge_pairwise');
    const runId = await createRun(
      makeConfig(packId, contentHash, makeJudge('vs-reference'), [candidateSnapshot('c1', 'cand-model')]),
      hardware,
    );
    const [cand] = await insertCandidates(runId, [candidateSnapshot('c1', 'cand-model')]);
    await upsertTrial(makeTrial({ id: 't1', runId, candidateId: cand.id, packId }));
    const seen: Seen = { reqs: [], prompts: [] };

    const res = await runJudgePass(runId, {
      streamChatFactory: () => queueFactory(
        ['{"winner":"A","reason":"first-seen wins"}', '{"winner":"A","reason":"first-seen wins again"}'],
        seen,
      ),
      loadPacks: async () => [pack],
      getFamily: async () => null,
      unloadModel: async () => undefined,
    });

    expect(res.errors).toBe(0);
    const scores = await listScores(runId);
    expect(scores).toHaveLength(1);
    expect(scores[0].value).toBe(0.5);
    expect(scores[0].verdict).toBe('partial');
    expect(scores[0].reason).toContain('swappedAgreement');
    expect(scores[0].judgeRaw).toContain('swapped');
  });

  it('scores wins when both orderings agree', async () => {
    const { packId, pack, contentHash } = await setupPack('llm_judge_pairwise');
    const runId = await createRun(
      makeConfig(packId, contentHash, makeJudge('vs-reference'), [candidateSnapshot('c1', 'cand-model')]),
      hardware,
    );
    const [cand] = await insertCandidates(runId, [candidateSnapshot('c1', 'cand-model')]);
    await upsertTrial(makeTrial({ id: 't1', runId, candidateId: cand.id, packId }));
    const seen: Seen = { reqs: [], prompts: [] };

    await runJudgePass(runId, {
      streamChatFactory: () => queueFactory(
        ['{"winner":"A","reason":"answer better"}', '{"winner":"B","reason":"answer still better"}'],
        seen,
      ),
      loadPacks: async () => [pack],
      getFamily: async () => null,
      unloadModel: async () => undefined,
    });

    const scores = await listScores(runId);
    expect(scores[0].value).toBe(1);
    expect(scores[0].verdict).toBe('correct');
  });

  it('round-robin stores per-pack Bradley-Terry ratings in reasons', async () => {
    const { packId, pack, contentHash } = await setupPack('llm_judge_pairwise');
    const runId = await createRun(
      makeConfig(packId, contentHash, makeJudge('round-robin'), [
        candidateSnapshot('cA', 'a-model'),
        candidateSnapshot('cB', 'b-model'),
      ]),
      hardware,
    );
    const [cA, cB] = await insertCandidates(runId, [
      candidateSnapshot('cA', 'a-model'),
      candidateSnapshot('cB', 'b-model'),
    ]);
    await upsertTrial(makeTrial({ id: 'tA', runId, candidateId: cA.id, packId, outputText: 'A says 4.' }));
    await upsertTrial(makeTrial({ id: 'tB', runId, candidateId: cB.id, packId, outputText: 'B says five.' }));
    const seen: Seen = { reqs: [], prompts: [] };

    const res = await runJudgePass(runId, {
      streamChatFactory: () => queueFactory(
        ['{"winner":"A","reason":"a better"}', '{"winner":"B","reason":"a still better"}'],
        seen,
      ),
      loadPacks: async () => [pack],
      getFamily: async () => null,
      unloadModel: async () => undefined,
    });

    expect(res.errors).toBe(0);
    const scores = await listScores(runId);
    expect(scores).toHaveLength(2);
    const byTrial = new Map(scores.map((s) => [s.trialId, s]));
    expect(byTrial.get('tA')?.value).toBe(1);
    expect(byTrial.get('tB')?.value).toBe(0);
    for (const s of scores) {
      const reason = JSON.parse(s.reason ?? '{}') as {
        bt: { strength: unknown; display: unknown; games: unknown } | null;
      };
      expect(reason.bt).not.toBeNull();
      expect(typeof reason.bt?.display).toBe('number');
      expect(reason.bt?.games).toBe(1);
    }
  });
});
