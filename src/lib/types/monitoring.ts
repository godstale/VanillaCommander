export interface SystemGpuInfo {
  gpuName: string;
  vramTotalMb: number;
  vramUsedMb: number;
  vramFreeMb: number;
  gpuUtilizationPct: number;
  gpuTemperatureC: number;
  isNvidia: boolean;
  systemMemoryTotalMb: number;
  systemMemoryFreeMb: number;
}

export interface OllamaRunningModel {
  name: string;
  model: string;
  size: number;
  size_vram: number;
  details?: {
    format?: string;
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
  expires_at?: string;
}

export interface OllamaModelArchitectureInfo {
  architecture: string;
  parameterSize: string;
  parameterCount: number;
  contextLimit: number;
  blockCount: number;
  embeddingLength: number;
  headCount: number;
  headCountKv: number;
  feedForwardLength: number;
  /** Q/KV 헤드 구성에서 판정한 어텐션 알고리즘. */
  attentionKind: AttentionKind;
  /** 하이브리드 모델의 실제 어텐션 레이어 수 (KV 헤드>0인 레이어). */
  attentionLayers: number;
  /** 하이브리드 모델의 전 레이어 KV 헤드 합 (KV 캐시 추정에 사용). */
  kvHeadsTotal: number;
  /** Per-head dimension when /api/show exposes it (else derived). */
  headDim?: number;
  quantizationLevel: string;
  format: string;
  rawModelInfo?: Record<string, unknown>;
}

/** Q/KV 헤드 구성에서 판정한 어텐션 알고리즘. */
export type AttentionKind = 'MHA' | 'GQA' | 'MQA' | 'hybrid' | 'unknown';

export type AgentOperationalStatus =
  | 'idle'
  | 'thinking'
  | 'prefill'
  | 'generating'
  | 'decoding'
  | 'executing_tool'
  | 'waiting_approval'
  | 'disconnected'
  | 'unknown';

export interface LlmPerformanceMetrics {
  totalDurationMs: number;
  loadDurationMs: number;
  promptEvalCount: number;
  promptEvalDurationMs: number;
  evalCount: number;
  evalDurationMs: number;
  prefillSpeed: number; // tokens/sec
  decodingSpeed: number; // tokens/sec
  completedAt?: number; // timestamp in ms when inference finished
}

export interface AgentMonitoringSnapshot {
  id: string;
  agentId: string;
  timestamp: string; // ISO string
  gpuName: string;
  gpuVramTotalMb: number;
  gpuVramUsedMb: number;
  gpuVramFreeMb: number;
  gpuUtilizationPct: number;
  gpuTemperatureC: number;
  systemMemoryTotalMb: number;
  systemMemoryFreeMb: number;
  llmModel: string;
  llmArchitecture: string;
  llmParameterSize: string;
  contextSize: number;
  contextLimit: number;
  modelWeightBytes: number;
  vramAllocatedBytes: number;
  kvCacheBytes: number;
  gpuOffloadPct: number;
  agentStatus: AgentOperationalStatus;
  currentTask: string;
  prefillTokens?: number;
  prefillDurationMs?: number;
  prefillSpeed?: number;
  decodingTokens?: number;
  decodingDurationMs?: number;
  decodingSpeed?: number;
  totalDurationMs?: number;
  /** 사고(thinking) 토큰 추정치 — 출력 토큰 중 사고문 비율로 안분 */
  thinkingTokens?: number;
  /** 스냅샷 수집 시점에 진행 중이던 대화 id (대화 단위 집계 키) */
  conversationId?: string;
  /** 에이전트별 대화 일련번호 */
  conversationSeq?: number;
  details?: Record<string, unknown>;
  createdAt: string;
}

/** LLM 상태별 토큰 귀속 키. prefill=입력, thinking=사고분, decoding=본문분. */
export type TokenStatusKey =
  | 'thinking'
  | 'prefill'
  | 'decoding'
  | 'generating'
  | 'executing_tool'
  | 'waiting_approval';

export type TokenStatusBreakdown = Record<TokenStatusKey, number>;

/** 한 턴(단일 LLM 호출)의 토큰 기여분 */
export interface TurnTokenContribution {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  contentTokens: number;
  statusTokens: TokenStatusBreakdown;
}

/**
 * 하나의 "대화"(사용자 요청 1건 → agent_end까지의 전체 턴) 토큰 집계.
 * 멀티턴(도구 호출 포함) 대화는 턴별 usage 실측을 합산한다.
 */
export interface ConversationTokenSummary {
  id: string;
  agentId: string;
  sessionId?: string;
  /** 에이전트별 단조 증가 일련번호 */
  seq: number;
  startedAt: string;
  endedAt: string;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  thinkingTokens: number;
  contentTokens: number;
  statusTokens: TokenStatusBreakdown;
}

export interface ConversationTokenTotals {
  conversationCount: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  contentTokens: number;
  totalTokens: number;
  statusTokens: TokenStatusBreakdown;
}

export function emptyStatusTokens(): TokenStatusBreakdown {
  return {
    thinking: 0,
    prefill: 0,
    decoding: 0,
    generating: 0,
    executing_tool: 0,
    waiting_approval: 0,
  };
}

export interface MonitoringSummary {
  totalSnapshots: number;
  firstSnapshotTime: string | null;
  lastSnapshotTime: string | null;
  avgGpuUtilization: number;
  peakVramUsedMb: number;
  avgVramUsedMb: number;
  latestGpuName: string;
  latestModel: string;
  latestPrefillSpeed?: number;
  latestDecodingSpeed?: number;
}
