import { z } from 'zod';
import type {
  BuiltinToolId,
  LlmProviderKind,
} from '@/lib/types/agent';
import {
  DEFAULT_LLM_PROVIDER,
} from '@/lib/types/agent';

// ---- 분류 ----

export const EVAL_DIMENSIONS = ['Q', 'A', 'P', 'R', 'S'] as const;
export type EvalDimension = (typeof EVAL_DIMENSIONS)[number];

export const EVAL_CATEGORIES = [
  'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9',
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6',
  'P1', 'P2',
  'R1',
  'S1',
] as const;
export type EvalCategoryId = (typeof EVAL_CATEGORIES)[number];

export const PACK_KINDS = [
  'single_turn', 'multi_turn', 'tool_call', 'agentic', 'perf_probe',
  'long_context', 'compaction_recall', 'logprob_trace',
] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export const PACK_SCOPES = ['builtin', 'user', 'project'] as const;
export type PackScope = (typeof PACK_SCOPES)[number];

export const TIER_NAMES = ['smoke', 'standard', 'full'] as const;
export type TierName = (typeof TIER_NAMES)[number];

// agent.ts 유니온과 동일한 값 목록 (동기화는 types.test.ts에서 검사)
export const LlmProviderKindSchema = z.enum([
  'ollama',
  'lmstudio',
  'llamacpp',
  'vllm',
  'jan',
  'openai-compatible',
  'openai',
  'anthropic',
  'gemini',
  'xai',
  'deepseek',
  'openrouter',
  'mistral',
  'moonshot',
  'together',
  'opencode',
]) satisfies z.ZodType<LlmProviderKind>;
export type LlmProviderKindEval = z.infer<typeof LlmProviderKindSchema>;

export const BuiltinToolIdSchema = z.enum([
  'read',
  'write',
  'edit',
  'ls',
  'grep',
  'find',
  'shell',
  'web_search',
  'web_fetch',
  'wiki',
]) satisfies z.ZodType<BuiltinToolId>;
export type BuiltinToolIdEval = z.infer<typeof BuiltinToolIdSchema>;

export { DEFAULT_LLM_PROVIDER };

export const I18nTextSchema = z.object({
  ko: z.string(),
  en: z.string(),
});
export type I18nText = z.infer<typeof I18nTextSchema>;

export const EvalMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});
export type EvalMessage = z.infer<typeof EvalMessageSchema>;

// ---- 팩 ----

export const ToolSchemaJsonSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()),
});
export type ToolSchemaJson = z.infer<typeof ToolSchemaJsonSchema>;

export const SCORER_TYPES = [
  'exact', 'includes', 'regex', 'choice', 'numeric', 'json_schema',
  'tool_call_ast', 'no_tool_call', 'viz_block', 'ifeval',
  'fs_state', 'trajectory', 'code_exec',
  'llm_judge_rubric', 'llm_judge_pairwise', 'human', 'choice_logprob',
] as const;
export type ScorerType = (typeof SCORER_TYPES)[number];

export const ScorerSpecSchema = z.object({
  type: z.enum(SCORER_TYPES),
  key: z.string().optional(),
  weight: z.number().positive().default(1),
  gate: z.boolean().default(false),
  threshold: z.number().min(0).max(1).optional(),
  options: z.record(z.unknown()).default({}),
});
export type ScorerSpec = z.infer<typeof ScorerSpecSchema>;

export const VERDICTS = ['correct', 'incorrect', 'partial', 'no_answer', 'error', 'skipped'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const MetricSpecSchema = z.object({
  id: z.string(),
  description: I18nTextSchema,
  source: z.enum(['score', 'trial_field', 'derived']),
  field: z.string().optional(),
  aggregation: z.enum(['mean', 'median', 'p95', 'pass_at_k', 'pass_hat_k', 'rate']),
  k: z.number().int().positive().optional(),
  lowerIsBetter: z.boolean(),
  scoreType: z.enum(['binary', 'continuous', 'ordinal']),
  range: z.object({ min: z.number(), max: z.number() }),
  normalization: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('baseline'),
      baseline: z.union([z.number(), z.literal('auto_choices')]),
      ceiling: z.number().default(1),
    }),
    z.object({ kind: z.literal('anchor'), anchorId: z.string() }),
    z.object({ kind: z.literal('identity') }),
  ]),
  countsTowardComposite: z.boolean().default(true),
});
export type MetricSpec = z.infer<typeof MetricSpecSchema>;

export const EvalPackManifestSchema = z.object({
  schemaVersion: z.literal('1.0'),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  version: z.string(),
  title: I18nTextSchema,
  description: I18nTextSchema,
  category: z.enum(EVAL_CATEGORIES),
  lang: z.array(z.enum(['ko', 'en'])).min(1),
  license: z.object({
    id: z.string(),
    source: z.string().optional(),
    attribution: z.string().optional(),
  }),
  kind: z.enum(PACK_KINDS),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('jsonl'), file: z.string().default('samples.jsonl') }),
    z.object({ type: z.literal('kmmlu-csv'), files: z.array(z.string()).min(1) }),
    z.object({
      type: z.literal('generator'),
      generator: z.enum(['long-context-v1', 'perf-probe-v1']),
      params: z.record(z.unknown()),
    }),
  ]),
  systemPrompt: z.string().optional(),
  useAgentSystemPrompt: z.boolean().default(false),
  fewshot: z.array(EvalMessageSchema).optional(),
  tools: z.union([z.literal('fortress-default'), z.array(ToolSchemaJsonSchema)]).optional(),
  scorers: z.array(ScorerSpecSchema).min(0),
  metrics: z.array(MetricSpecSchema).min(1),
  tiers: z.object({
    smoke: z.number().int().positive(),
    standard: z.number().int().positive(),
    full: z.union([z.number().int().positive(), z.literal('all')]),
  }),
  stratifyBy: z.string().optional(),
  defaults: z.object({
    timeoutSec: z.number().positive().default(180),
    maxTurns: z.number().int().positive().default(12),
    epochs: z.number().int().positive().default(1),
    circular: z.boolean().default(false),
  }).default({}),
  requires: z.object({
    toolCalling: z.boolean().default(false),
    logprobs: z.boolean().default(false),
    codeRuntime: z.enum(['js', 'python']).optional(),
    minContextTokens: z.number().int().optional(),
  }).default({}),
  trusted: z.boolean().default(false),
  publishedAt: z.string().optional(),
});
export type EvalPackManifest = z.infer<typeof EvalPackManifestSchema>;

export const ExpectedToolCallSchema = z.object({
  name: z.string(),
  args: z.record(z.array(z.unknown())),
  optionalArgs: z.array(z.string()).optional(),
});
export type ExpectedToolCall = z.infer<typeof ExpectedToolCallSchema>;

export const FsExpectationSchema = z.union([
  z.object({ path: z.string(), exists: z.boolean() }),
  z.object({
    path: z.string(),
    contains: z.array(z.string()).optional(),
    notContains: z.array(z.string()).optional(),
    regex: z.string().optional(),
    equals: z.string().optional(),
    caseSensitive: z.boolean().optional(),
  }),
  z.object({ glob: z.string(), unchanged: z.literal(true) }),
  z.object({ glob: z.string(), maxFiles: z.number().int() }),
]);
export type FsExpectation = z.infer<typeof FsExpectationSchema>;

export const EvalSampleSchema = z.object({
  id: z.string(),
  input: z.union([z.string(), z.array(EvalMessageSchema).min(1)]),
  choices: z.array(z.string()).optional(),
  target: z.union([z.string(), z.array(z.string()), z.number()]).optional(),
  reference: z.string().optional(),
  rubric: z.string().optional(),
  expectedToolCalls: z.array(ExpectedToolCallSchema).optional(),
  tools: z.array(ToolSchemaJsonSchema).optional(),
  fixture: z.object({ dir: z.string() }).optional(),
  expectState: z.array(FsExpectationSchema).optional(),
  trajectory: z.object({
    mustCall: z.array(z.string()).optional(),
    mustNotCall: z.array(z.string()).optional(),
    maxCalls: z.number().int().optional(),
    mustReadPaths: z.array(z.string()).optional(),
  }).optional(),
  ifeval: z.array(
    z.object({ id: z.string(), kwargs: z.record(z.unknown()).default({}) }),
  ).optional(),
  code: z.object({
    entryPoint: z.string(),
    tests: z.string(),
    language: z.enum(['js', 'python']),
  }).optional(),
  perf: z.object({
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    depthRatio: z.number().min(0).max(1).optional(),
    repeats: z.number().int().optional(),
  }).optional(),
  scorers: z.array(ScorerSpecSchema).optional(),
  clusterId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type EvalSample = z.infer<typeof EvalSampleSchema>;

// ---- 후보 ----

export const CandidateSnapshotSchema = z.object({
  label: z.string(),
  sourceAgentId: z.string().nullable(),
  provider: LlmProviderKindSchema,
  baseUrl: z.string(),
  endpointClass: z.enum(['local', 'lan-trusted', 'external']),
  model: z.string(),
  systemPrompt: z.string(),
  temperature: z.number(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  repeatPenalty: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  seed: z.number().optional(),
  stopSequences: z.array(z.string()).optional(),
  maxOutputTokens: z.number().optional(),
  reasoning: z.enum(['default', 'off', 'on']),
  reasoningEffort: z.enum(['low', 'medium', 'high']),
  contextSize: z.number().int(),
  reserveTokens: z.number().int(),
  keepRecentTokens: z.number().int(),
  enabledBuiltinTools: z.array(BuiltinToolIdSchema),
  enabledSkills: z.array(z.string()),
  sweep: z.record(z.union([z.string(), z.number()])).optional(),
});
export type CandidateSnapshot = z.infer<typeof CandidateSnapshotSchema>;

export const HardwareFingerprintSchema = z.object({
  gpuName: z.string(),
  vramTotalMb: z.number(),
  isNvidia: z.boolean(),
  ramTotalMb: z.number(),
  os: z.string(),
  appVersion: z.string(),
  providerVersions: z.record(z.string()),
});
export type HardwareFingerprint = z.infer<typeof HardwareFingerprintSchema>;

// ---- 프로파일 ----

export const EvalProfileSchema = z.object({
  id: z.string(),
  name: I18nTextSchema,
  builtIn: z.boolean(),
  description: I18nTextSchema,
  dimensionWeights: z.object({
    Q: z.number().min(0),
    A: z.number().min(0),
    P: z.number().min(0),
    R: z.number().min(0),
    S: z.number().min(0),
  }),
  categoryWeights: z.record(z.number().min(0)),
  anchorsVersion: z.string(),
  anchorOverrides: z.record(z.object({ zero: z.number(), full: z.number() })).default({}),
  constraints: z.array(z.object({
    metric: z.string(),
    op: z.enum(['>=', '<=']),
    value: z.number(),
    label: I18nTextSchema,
  })),
  arena: z.object({
    enabled: z.boolean(),
    minVotes: z.number().int().default(30),
  }).default({ enabled: false, minVotes: 30 }),
});
export type EvalProfile = z.infer<typeof EvalProfileSchema>;

// ---- 외부 연동 (D3) ----

export const INTEGRATION_PURPOSES = ['judge', 'reference-generation', 'pack-drafting', 'candidate'] as const;
export type IntegrationPurpose = (typeof INTEGRATION_PURPOSES)[number];

export const DATA_CLASSES = ['public-bundled', 'personal', 'fixture-files'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const ExternalIntegrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['llm-api', 'agent-cli']),
  enabled: z.boolean(),
  llm: z.object({
    provider: LlmProviderKindSchema,
    baseUrl: z.string(),
    model: z.string(),
    apiKey: z.string().optional(),
  }).optional(),
  cli: z.object({
    executablePath: z.string(),
    args: z.array(z.string()),
    promptVia: z.enum(['stdin', 'file']),
    outputFormat: z.enum(['text', 'json']),
    jsonPath: z.string().optional(),
    timeoutMs: z.number().int().default(180000),
  }).optional(),
  allowedPurposes: z.array(z.enum(INTEGRATION_PURPOSES)),
  allowedDataClasses: z.array(z.enum(DATA_CLASSES)),
  consent: z.object({
    version: z.string(),
    grantedAt: z.string(),
    purposes: z.array(z.enum(INTEGRATION_PURPOSES)),
    dataClasses: z.array(z.enum(DATA_CLASSES)),
  }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExternalIntegration = z.infer<typeof ExternalIntegrationSchema>;

export const IntegrationSettingsSchema = z.object({
  masterEnabled: z.boolean().default(false),
  trustedLanHosts: z.array(z.string()).default([]),
  allowLocalCodeExecution: z.boolean().default(false),
});
export type IntegrationSettings = z.infer<typeof IntegrationSettingsSchema>;

// ---- 실행 ----

export const JudgeConfigSchema = z.object({
  target: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('local'),
      provider: LlmProviderKindSchema,
      baseUrl: z.string(),
      model: z.string(),
      sourceAgentId: z.string().nullable(),
    }),
    z.object({ type: z.literal('integration'), integrationId: z.string() }),
  ]),
  scale: z.enum(['1-5', '1-10']).default('1-5'),
  pairwise: z.enum(['none', 'vs-reference', 'round-robin']).default('none'),
  promptVersion: z.string(),
});
export type JudgeConfig = z.infer<typeof JudgeConfigSchema>;

export const ExternalTransferPlanSchema = z.object({
  integrationId: z.string(),
  purpose: z.enum(INTEGRATION_PURPOSES),
  dataClasses: z.array(z.enum(DATA_CLASSES)),
  estimatedRequests: z.number().int(),
  estimatedInputTokens: z.number().int(),
});
export type ExternalTransferPlan = z.infer<typeof ExternalTransferPlanSchema>;

export const EvalRunConfigSchema = z.object({
  name: z.string(),
  profile: EvalProfileSchema,
  packs: z.array(z.object({
    scope: z.enum(PACK_SCOPES),
    packId: z.string(),
    version: z.string(),
    contentHash: z.string(),
    tier: z.enum(['smoke', 'standard', 'full']),
    epochs: z.number().int().positive(),
    circular: z.boolean(),
    sampleIds: z.array(z.string()),
  })).min(1),
  candidates: z.array(CandidateSnapshotSchema).min(1).max(24),
  judge: JudgeConfigSchema.nullable(),
  options: z.object({
    deterministicMode: z.boolean(),
    reliabilityEpochs: z.number().int().min(2).max(10),
    timeoutMultiplier: z.number().min(0.5).max(5),
    perfRepeats: z.number().int().min(1).max(10),
    unloadBetweenCandidates: z.boolean(),
    sampleOrderSeed: z.number().int(),
  }),
  confirmations: z.object({
    weightsConfirmedAt: z.string(),
    externalTransfers: z.array(ExternalTransferPlanSchema),
    externalConfirmedAt: z.string().nullable(),
    codeExecution: z.object({
      runtime: z.enum(['js', 'python']),
      snippetCount: z.number().int(),
      confirmedAt: z.string(),
    }).nullable(),
  }),
});
export type EvalRunConfig = z.infer<typeof EvalRunConfigSchema>;

export const TRIAL_OUTCOMES = [
  'ok', 'timeout', 'oom', 'provider_error', 'parse_error',
  'no_answer', 'max_turns', 'cancelled', 'skipped_unsupported',
] as const;
export type TrialOutcome = (typeof TRIAL_OUTCOMES)[number];

export const RUN_STATUSES = [
  'pending', 'running', 'paused', 'judging', 'completed',
  'cancelled', 'failed', 'interrupted',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

// ---- DB 행 (P10-02 Repo가 사용, JSON 컬럼은 파싱 전 원시형) ----

export interface EvalRunRow {
  id: string;
  name: string;
  config: EvalRunConfig;
  hardware: HardwareFingerprint;
  status: RunStatus;
  error: string | null;
  progressDone: number;
  progressTotal: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EvalCandidateStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface EvalCandidateRow {
  id: string;
  runId: string;
  position: number;
  label: string;
  snapshot: CandidateSnapshot;
  modelMeta: Record<string, unknown> | null;
  loadMs: number | null;
  status: EvalCandidateStatus;
  error: string | null;
}

export interface EvalTrialRow {
  id: string;
  runId: string;
  candidateId: string;
  packId: string;
  sampleId: string;
  epoch: number;
  outcome: TrialOutcome;
  outputText: string | null;
  reasoningText: string | null;
  transcriptJson: string | null;
  finalStateJson: string | null;
  extraJson: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  ttftMs: number | null;
  prefillTps: number | null;
  decodeTps: number | null;
  totalMs: number | null;
  timingSource: 'server' | 'client' | null;
  cacheHit: boolean | null;
  vramPeakMb: number | null;
  gpuUtilAvg: number | null;
  gpuTempMax: number | null;
  offloadRatio: number | null;
  turns: number | null;
  toolCalls: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export type EvalScoreSource = 'auto' | 'judge' | 'human';

export interface EvalScoreRow {
  id: string;
  trialId: string;
  scorerKey: string;
  scorerType: ScorerType;
  value: number;
  verdict: Verdict;
  reason: string | null;
  extracted: string | null;
  judgeRaw: string | null;
  source: EvalScoreSource;
  createdAt: string;
}

export type AggregateLevel = 'metric' | 'pack' | 'category' | 'dimension' | 'composite';

export interface EvalAggregateRow {
  runId: string;
  candidateId: string;
  level: AggregateLevel;
  key: string;
  raw: number | null;
  normalized: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  n: number | null;
  anchorsVersion: string | null;
  computedAt: string;
}

export type ArenaWinner = 'a' | 'b' | 'tie' | 'both_bad';

export interface ArenaVoteRow {
  id: string;
  promptHash: string;
  promptPreview: string | null;
  aSnapshot: CandidateSnapshot;
  bSnapshot: CandidateSnapshot;
  aLabel: string;
  bLabel: string;
  winner: ArenaWinner;
  workspaceRoot: string | null;
  createdAt: string;
}

export interface IntegrationAuditRow {
  id: string;
  integrationId: string;
  purpose: IntegrationPurpose;
  dataClasses: DataClass[];
  runId: string | null;
  requestCount: number;
  bytesSent: number;
  status: 'ok' | 'error';
  error: string | null;
  createdAt: string;
}

export interface PackDiagnostic {
  sampleId: string | null;
  message: string;
}
