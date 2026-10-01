import type { EvalReportData } from '@/components/eval/report/reportData';
import type {
  EvalAggregateRow,
  EvalCandidateRow,
  EvalRunRow,
  EvalScoreRow,
  EvalTrialRow,
} from '../types';

// Minimal EvalReportData builder for exporter tests (partial rows cast up).

export function makeCandidate(id: string, label: string, model: string): EvalCandidateRow {
  return {
    id,
    runId: 'run-1',
    position: 0,
    label,
    snapshot: {
      label,
      sourceAgentId: null,
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      endpointClass: 'local',
      model,
      systemPrompt: 'sys',
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 512,
      reasoning: 'off',
      reasoningEffort: 'low',
      contextSize: 8192,
      reserveTokens: 1024,
      keepRecentTokens: 512,
      enabledBuiltinTools: [],
      enabledSkills: [],
    },
    modelMeta: { quantization: 'Q4_K_M' },
    loadMs: 1200,
    status: 'done',
    error: null,
  } as unknown as EvalCandidateRow;
}

export function makeRun(): EvalRunRow {
  return {
    id: 'run-1',
    name: 'demo run',
    config: {
      packs: [{ packId: 'gpqa-demo', version: '1.0.0' }],
      profile: { id: 'balanced' },
    },
    hardware: {
      gpuName: 'Test GPU',
      vramTotalMb: 12288,
      isNvidia: true,
      ramTotalMb: 32768,
      os: 'windows',
      appVersion: '0.1.0',
      providerVersions: {},
    },
    status: 'completed',
    error: null,
    progressDone: 2,
    progressTotal: 2,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-09-25T00:00:00Z',
    updatedAt: '2026-09-25T00:00:00Z',
  } as unknown as EvalRunRow;
}

export function makeTrial(
  overrides: Partial<EvalTrialRow> & { id: string; candidateId: string },
): EvalTrialRow {
  return {
    runId: 'run-1',
    packId: 'demo-pack',
    sampleId: 's1',
    epoch: 1,
    outcome: 'ok',
    outputText: 'answer text',
    reasoningText: null,
    transcriptJson: null,
    finalStateJson: null,
    extraJson: null,
    inputTokens: 100,
    outputTokens: 20,
    thinkingTokens: null,
    ttftMs: 300,
    prefillTps: 500,
    decodeTps: 40,
    totalMs: 900,
    timingSource: 'client',
    cacheHit: false,
    vramPeakMb: 8000,
    gpuUtilAvg: null,
    gpuTempMax: null,
    offloadRatio: 1,
    turns: 1,
    toolCalls: 0,
    startedAt: '2026-09-25T00:00:00Z',
    finishedAt: '2026-09-25T00:00:01Z',
    ...overrides,
  } as EvalTrialRow;
}

export function makeScore(
  overrides: Partial<EvalScoreRow> & { id: string; trialId: string },
): EvalScoreRow {
  return {
    scorerKey: 'exact',
    scorerType: 'exact',
    value: 1,
    verdict: 'correct',
    reason: 'exact match',
    extracted: 'answer text',
    judgeRaw: null,
    source: 'auto',
    createdAt: '2026-09-25T00:00:01Z',
    ...overrides,
  } as EvalScoreRow;
}

export function makeAggregate(
  overrides: Partial<EvalAggregateRow> & { candidateId: string; key: string },
): EvalAggregateRow {
  return {
    runId: 'run-1',
    level: 'metric',
    raw: 0.8,
    normalized: 75,
    ciLow: 70,
    ciHigh: 80,
    n: 50,
    anchorsVersion: 'v1',
    computedAt: '2026-09-25T00:00:02Z',
    ...overrides,
  } as EvalAggregateRow;
}

export function makeReportData(): EvalReportData {
  return {
    run: makeRun(),
    candidates: [makeCandidate('cand-a', 'A', 'qwen3:8b')],
    aggregates: [makeAggregate({ candidateId: 'cand-a', key: '@all:accuracy' })],
    trials: [makeTrial({ id: 't1', candidateId: 'cand-a' })],
    scores: [makeScore({ id: 's1', trialId: 't1' })],
  };
}
