import type {
  CandidateSnapshot,
  EvalAggregateRow,
  EvalCandidateRow,
  EvalScoreRow,
  EvalTrialRow,
} from '@/lib/eval/types';

export function makeSnapshot(label: string): CandidateSnapshot {
  return {
    label,
    sourceAgentId: null,
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    endpointClass: 'local',
    model: 'test-model',
    systemPrompt: 'system',
    temperature: 0.7,
    contextSize: 8192,
    reserveTokens: 512,
    keepRecentTokens: 2048,
    enabledBuiltinTools: [],
    enabledSkills: [],
    reasoning: 'default',
    reasoningEffort: 'medium',
  };
}

export function makeCandidate(id: string, label: string): EvalCandidateRow {
  return {
    id,
    runId: 'run1',
    position: 0,
    label,
    snapshot: makeSnapshot(label),
    modelMeta: null,
    loadMs: null,
    status: 'done',
    error: null,
  };
}

export function makeAgg(
  candidateId: string,
  level: EvalAggregateRow['level'],
  key: string,
  normalized: number | null,
  raw?: number | null,
  ciLow?: number | null,
  ciHigh?: number | null,
  n?: number | null,
): EvalAggregateRow {
  return {
    runId: 'run1',
    candidateId,
    level,
    key,
    raw: raw ?? normalized,
    normalized,
    ciLow: ciLow ?? null,
    ciHigh: ciHigh ?? null,
    n: n ?? 10,
    anchorsVersion: 'v1',
    computedAt: new Date().toISOString(),
  };
}

export function makeTrial(
  id: string,
  candidateId: string,
  overrides?: Partial<EvalTrialRow>,
): EvalTrialRow {
  return {
    id,
    runId: 'run1',
    candidateId,
    packId: 'pack-a',
    sampleId: 's1',
    epoch: 0,
    outcome: 'ok',
    outputText: 'output',
    reasoningText: null,
    transcriptJson: null,
    finalStateJson: null,
    extraJson: null,
    inputTokens: 1000,
    outputTokens: 50,
    thinkingTokens: null,
    ttftMs: null,
    prefillTps: null,
    decodeTps: 20,
    totalMs: 1000,
    timingSource: null,
    cacheHit: null,
    vramPeakMb: 4000,
    gpuUtilAvg: null,
    gpuTempMax: null,
    offloadRatio: null,
    turns: 1,
    toolCalls: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeScore(
  id: string,
  trialId: string,
  value: number,
  source: EvalScoreRow['source'] = 'auto',
): EvalScoreRow {
  return {
    id,
    trialId,
    scorerKey: 'acc',
    scorerType: 'exact',
    value,
    verdict: value >= 0.5 ? 'correct' : 'incorrect',
    reason: null,
    extracted: null,
    judgeRaw: null,
    source,
    createdAt: new Date().toISOString(),
  };
}
