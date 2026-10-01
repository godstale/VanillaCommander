import { describe, expect, it, beforeEach, vi } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { BUILTIN_PROFILES } from '../constants';
import type { CandidateSnapshot, EvalRunConfig, HardwareFingerprint } from '../types';
import type { LlmStreamChatFn } from '@/lib/llm/providerRuntime';
import { createMemoryPackFs } from '../packs/packFs';
import {
  createRun,
  getRun,
  listCandidates,
  listScores,
  listTrials,
} from '@/lib/db/repositories/evalRepo';
import { chatQueueManager } from '@/lib/agent/chatQueueManager';
import { evalLock } from '../evalLock';
import { EvalRunner } from './runner';
import { expandMatrix, candidateFromAgent } from './candidates';
import { rotationCount, rotatedTargetLetter, buildPrompt } from './promptBuild';
import { classifyOutcome } from './outcome';
import { estimateRun, formatDuration } from './estimate';
import type { Agent } from '@/lib/types/agent';

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
};

const MANIFEST = {
  schemaVersion: '1.0',
  id: 'demo',
  version: '1.0.0',
  title: { ko: 'd', en: 'd' },
  description: { ko: 'd', en: 'd' },
  category: 'Q1',
  lang: ['ko'],
  license: { id: 't' },
  kind: 'single_turn',
  source: { type: 'jsonl', file: 'samples.jsonl' },
  scorers: [{ type: 'exact' }],
  metrics: [
    {
      id: 'accuracy',
      description: { ko: 'd', en: 'd' },
      source: 'score',
      aggregation: 'mean',
      lowerIsBetter: false,
      scoreType: 'binary',
      range: { min: 0, max: 1 },
      normalization: { kind: 'baseline', baseline: 0 },
    },
  ],
  tiers: { smoke: 2, standard: 2, full: 'all' },
};

const SAMPLES = [
  JSON.stringify({ id: 's1', input: 'q1', target: 'hello' }),
  JSON.stringify({ id: 's2', input: 'q2', target: 'world' }),
].join('\n');

function packFs() {
  return createMemoryPackFs({
    builtin: {
      demo: {
        'manifest.json': JSON.stringify(MANIFEST),
        'samples.jsonl': SAMPLES,
      },
    },
  });
}

function cannedFactory(text: (input: string) => string): LlmStreamChatFn {
  return async function* (req) {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const out = text(typeof lastUser?.content === 'string' ? lastUser.content : '');
    yield { content: out, done: false };
    yield { content: '', done: true, usage: { input: 10, output: 2, total: 12 } };
  };
}

async function makeConfig(): Promise<EvalRunConfig> {
  const { loadPack, listPacks } = await import('../packs/packLoader');
  const fs = packFs();
  const { refs } = await listPacks(fs);
  const pack = await loadPack(fs, refs[0]);
  return {
    name: 'run',
    profile: BUILTIN_PROFILES[0],
    packs: [
      {
        scope: 'builtin',
        packId: 'demo',
        version: '1.0.0',
        contentHash: pack.contentHash,
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

describe('eval runner', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
    chatQueueManager.resetAll();
    const lock = evalLock.get();
    if (lock) evalLock.release(lock.runId);
    vi.restoreAllMocks();
  });

  it('runs trials, scores, and aggregates to completed', async () => {
    const runId = await createRun(await makeConfig(), hardware);
    const events: string[] = [];
    const runner = new EvalRunner({
      packFs: packFs(),
      streamChatFactory: () => cannedFactory((input) => (input.includes('q1') ? 'hello' : 'world')),
    });
    runner.on((e) => {
      events.push(e.type);
    });
    await runner.start(runId);

    const run = await getRun(runId);
    expect(run?.status).toBe('completed');
    expect(run?.progressTotal).toBe(2);
    expect(await listTrials(runId)).toHaveLength(2);
    const scores = await listScores(runId);
    expect(scores).toHaveLength(2);
    expect(scores.every((s) => s.verdict === 'correct')).toBe(true);
    expect(events).toContain('candidate_start');
    expect(events).toContain('trial_end');
  });

  it('skips completed trials on resume', async () => {
    const runId = await createRun(await makeConfig(), hardware);
    const mk = () =>
      new EvalRunner({ packFs: packFs(), streamChatFactory: () => cannedFactory(() => 'hello') });
    await mk().start(runId);
    expect(await listTrials(runId)).toHaveLength(2);
    // Second start reuses checkpoints without duplicating.
    await mk().start(runId);
    expect(await listTrials(runId)).toHaveLength(2);
    expect((await getRun(runId))?.status).toBe('completed');
  });

  it('fails when pack content changed after configuration', async () => {
    const config = await makeConfig();
    config.packs[0].contentHash = 'stale';
    const runId = await createRun(config, hardware);
    const runner = new EvalRunner({
      packFs: packFs(),
      streamChatFactory: () => cannedFactory(() => 'x'),
    });
    await runner.start(runId);
    const run = await getRun(runId);
    expect(run?.status).toBe('failed');
    expect(run?.error).toContain('pack changed');
  });

  it('does not start while a chat is busy', async () => {
    chatQueueManager.setSessionRunning('chat:x', true);
    const runId = await createRun(await makeConfig(), hardware);
    const runner = new EvalRunner({
      packFs: packFs(),
      streamChatFactory: () => cannedFactory(() => 'x'),
    });
    await runner.start(runId);
    expect((await getRun(runId))?.status).toBe('pending');
    expect(await listTrials(runId)).toHaveLength(0);
  });

  it('skips external candidates without consent', async () => {
    const config = await makeConfig();
    config.candidates = [{ ...candidate, label: 'ext', endpointClass: 'external', baseUrl: 'https://api.example.com/v1' }];
    const runId = await createRun(config, hardware);
    const runner = new EvalRunner({
      packFs: packFs(),
      streamChatFactory: () => cannedFactory(() => 'hello'),
    });
    await runner.start(runId);
    const cands = await listCandidates(runId);
    expect(cands[0].status).toBe('skipped');
    expect((await getRun(runId))?.status).toBe('completed');
  });

  it('continues past a timed-out trial and completes the run', async () => {
    const fastManifest = { ...MANIFEST, defaults: { epochs: 1, timeoutSec: 1 } };
    const fastFs = () =>
      createMemoryPackFs({
        builtin: {
          demo: {
            'manifest.json': JSON.stringify(fastManifest),
            'samples.jsonl': SAMPLES,
          },
        },
      });
    // NOTE: the run config must carry the fast manifest's hash, otherwise the
    // runner rejects the pack as changed since configuration.
    const { loadPack, listPacks } = await import('../packs/packLoader');
    const cfgFs = fastFs();
    const { refs } = await listPacks(cfgFs);
    const fastPack = await loadPack(cfgFs, refs[0]);
    const fastConfig = await makeConfig();
    fastConfig.packs[0].contentHash = fastPack.contentHash;
    const runId = await createRun(fastConfig, hardware);
    const seen: string[] = [];
    let calls = 0;
    const hangingFirst: LlmStreamChatFn = async function* (req) {
      calls += 1;
      const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
      const input = typeof lastUser?.content === 'string' ? lastUser.content : '';
      if (input.includes('q1')) {
        // Never yields: the trial timeout (1s) must record and continue.
        await new Promise<never>(() => undefined);
        return;
      }
      yield { content: input.includes('q2') ? 'world' : '?', done: false };
      yield { content: '', done: true, usage: { input: 10, output: 2, total: 12 } };
    };
    const runner = new EvalRunner({
      packFs: fastFs(),
      streamChatFactory: () => hangingFirst,
    });
    runner.on((e) => {
      if (e.type === 'log') seen.push(e.message);
    });
    await runner.start(runId);

    const run = await getRun(runId);
    expect(run?.status).toBe('completed');
    expect(run?.progressDone).toBe(2);
    const trials = await listTrials(runId);
    expect(trials).toHaveLength(2);
    const bySample = new Map(trials.map((t) => [t.sampleId, t]));
    expect(bySample.get('s1')?.outcome).toBe('timeout');
    expect(bySample.get('s2')?.outcome).toBe('ok');
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(seen.some((m) => m.includes('timeout on demo/s1') && m.includes('continuing'))).toBe(true);
  });

  it('runs the code-exec pass after trials and keeps sync scores on pass failure', async () => {
    const runId = await createRun(await makeConfig(), hardware);
    const codeExecPass = vi.fn(async () => ({ scoredTrials: 1, scoresWritten: 2 }));
    const runner = new EvalRunner({
      packFs: packFs(),
      streamChatFactory: () => cannedFactory((input) => (input.includes('q1') ? 'hello' : 'world')),
      codeExecPass,
    });
    await runner.start(runId);
    expect(codeExecPass).toHaveBeenCalledTimes(1);
    expect(codeExecPass).toHaveBeenCalledWith(runId);
    expect((await getRun(runId))?.status).toBe('completed');
    expect(await listScores(runId)).toHaveLength(2);
  });

  it('writes run lifecycle and trial lines to the progress log', async () => {
    const { createMemoryProgressLogStore } = await import('./progressLog');
    const { parseProgressLog } = await import('./progressLog');
    const store = createMemoryProgressLogStore();
    const runId = await createRun(await makeConfig(), hardware);
    const runner = new EvalRunner({
      packFs: packFs(),
      streamChatFactory: () => cannedFactory((input) => (input.includes('q1') ? 'hello' : 'world')),
      progressLogStore: store,
    });
    await runner.start(runId);

    const records = parseProgressLog((await store.read(runId)).text);
    const kinds = records.map((r) => r.kind);
    expect(kinds[0]).toBe('run_started');
    expect(kinds).toContain('candidate_started');
    expect(kinds).toContain('candidate_finished');
    expect(records.filter((r) => r.kind === 'trial_started')).toHaveLength(2);
    expect(records.filter((r) => r.kind === 'trial_finished')).toHaveLength(2);
    expect(kinds[kinds.length - 1]).toBe('run_finished');
    // No streaming deltas are persisted.
    expect(kinds).not.toContain('trial_delta');
    const finished = records.find((r) => r.kind === 'run_finished');
    expect(finished?.kind === 'run_finished' && finished.status).toBe('completed');
    expect(finished?.kind === 'run_finished' && finished.results[0].trials).toBe(2);
    expect(finished?.kind === 'run_finished' && finished.results[0].avgScore).toBe(1);
    const started = records[0];
    expect(started.kind === 'run_started' && started.hardware.gpuName).toBe('Test GPU');
  });
});

describe('candidates', () => {
  const base = {
    id: 'a1',
    name: 'base',
    systemPrompt: 'sys',
    model: 'm1',
    temperature: 0.7,
    contextSize: 8192,
    reserveTokens: 0,
    keepRecentTokens: 0,
    enabledSkills: [],
    enabledBuiltinTools: ['read', 'shell', 'wiki'] as Agent['enabledBuiltinTools'],
    approvalMode: 'dangerous-only' as const,
    isDefault: true,
    createdAt: '',
    updatedAt: '',
  };

  it('filters tools to the eval-allowed set', () => {
    const c = candidateFromAgent(base);
    expect(c.enabledBuiltinTools).toEqual(['read']);
    expect(c.endpointClass).toBe('local');
  });

  it('expands matrix and rejects over 24 combos', () => {
    const combos = expandMatrix(base, { temperature: [0.2, 0.7], contextSize: [8192, 32768] });
    expect(combos).toHaveLength(4);
    expect(combos[0].sweep).toBeDefined();
    expect(() =>
      expandMatrix(base, { model: ['a', 'b', 'c'], temperature: [0.1, 0.2, 0.3], contextSize: [1, 2, 3] }),
    ).toThrow();
  });

  it('parses on:low reasoning sweeps', () => {
    const [c] = expandMatrix(base, { reasoning: ['on:low'] });
    expect(c.reasoning).toBe('on');
    expect(c.reasoningEffort).toBe('low');
  });
});

describe('promptBuild', () => {
  it('appends rotated choices and remaps targets', () => {
    expect(rotationCount({ id: 's', input: 'q', choices: ['a', 'b', 'c'] } as never, true)).toBe(3);
    expect(rotationCount({ id: 's', input: 'q' } as never, true)).toBe(1);
    expect(rotatedTargetLetter(['a', 'b', 'c', 'd'], 'A', 1)).toBe('D');
    const { messages } = buildPrompt(
      candidate,
      { systemPrompt: 'sp', fewshot: [], useAgentSystemPrompt: false } as never,
      { id: 's', input: 'pick', choices: ['a', 'b'] } as never,
      1,
    );
    expect(messages[messages.length - 1].content).toContain('A. b');
  });
});

describe('outcome', () => {
  it('classifies errors', () => {
    expect(classifyOutcome(new Error('eval trial timeout'), true)).toBe('timeout');
    expect(classifyOutcome(new Error('CUDA error pt'), false)).toBe('oom');
    expect(classifyOutcome(new Error('tool arguments parse_error: ..'), false)).toBe('parse_error');
    expect(classifyOutcome(new Error('boom'), false)).toBe('provider_error');
  });
});

describe('estimate', () => {
  it('estimates and formats durations', async () => {
    const config = await makeConfig();
    const est = estimateRun(config, { 'builtin:demo': 'single_turn' });
    expect(est.totalSec).toBeGreaterThan(0);
    expect(formatDuration(45)).toContain('초');
    expect(formatDuration(600)).toContain('분');
  });
});
