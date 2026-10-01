export type ApprovalMode = 'always' | 'dangerous-only' | 'never';

/**
 * Reasoning (사고모드) 제어. Ollama `/api/chat`의 최상위 `think` 필드로 전달된다.
 * - 'default': think를 보내지 않음 → 모델 기본값 사용
 * - 'off': think=false → 모델이 허용하면 사고 출력 생략
 * - 'on': think=effort 문자열(low/medium/high) → 명시적 effort 지정
 */
export type ReasoningMode = 'default' | 'off' | 'on';

/** Reasoning effort 레벨. Ollama가 레벨 문자열을 지원하지 않는 모델(boolean on/off만 지원)에게는
 *  지원하지 않는 이름이 전달되며, Ollama는 그 경우 모델 기본값을 사용한다. */
export type ReasoningEffort = 'low' | 'medium' | 'high';

/** Ollama `/api/chat` 요청에 실리는 think 값. undefined면 필드 자체를 생략한다. */
export type ThinkValue = boolean | string | undefined;

export const DEFAULT_REASONING_MODE: ReasoningMode = 'default';
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium';

/** 새 에이전트·전역 기본값의 temperature. 문서 작성 정확도 우선으로 0.2를 쓴다. */
export const DEFAULT_TEMPERATURE = 0.2;

/** 대화 시작 시 모니터링 자동 시작 여부. 미지정(구 DB 행) 시 켜짐으로 해석한다. */
export const DEFAULT_AUTO_MONITOR = true;

export function isAutoMonitorEnabled(
  agent: Pick<Agent, 'autoMonitor'> | undefined | null,
): boolean {
  if (!agent) return DEFAULT_AUTO_MONITOR;
  return agent.autoMonitor ?? DEFAULT_AUTO_MONITOR;
}

/**
 * 한 번의 사용자 요청이 실행된 에이전트 설정 스냅샷.
 * 사용자 메시지(`AgentMessage` role:'user')에 첨부되어 해당 턴이 어떤
 * 설정(ctx 크기·temperature·reasoning/effort 등)으로 실행됐는지 기록한다.
 * DB에는 메시지 JSON에 그대로 저장되므로 마이그레이션이 필요 없으며,
 * 구 행(스냅샷 없음)은 채팅 화면에서 현재 설정으로 폴백 표시한다.
 */
export interface ChatConfigSnapshot {
  agentName: string;
  model: string;
  temperature: number;
  contextSize: number;
  reasoning: ReasoningMode;
  reasoningEffort: ReasoningEffort;
  /** Agent 기본값 + 세션 오버라이드 해석 결과 (Ollama think 필드 값) */
  think?: ThinkValue;
  llmProvider?: LlmProviderKind;
  approvalMode?: ApprovalMode;
  enabledToolCount?: number;
  /** 생성 파라미터. undefined = 자동(Provider·모델 기본값) */
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  stopSequences?: string[];
  maxOutputTokens?: number;
}

export interface ThinkOverrideInput {
  reasoning?: ReasoningMode;
  effort?: ReasoningEffort;
}

/**
 * 전송 시점의 유효 설정으로 스냅샷을 만든다.
 * 세션 오버라이드('agent' 해석은 호출자가 완료한 값 전달)가 있으면 우선한다.
 */
export function captureChatConfigSnapshot(
  agent: Pick<
    Agent,
    | 'name'
    | 'model'
    | 'temperature'
    | 'contextSize'
    | 'reasoning'
    | 'reasoningEffort'
    | 'llmProvider'
    | 'approvalMode'
    | 'enabledBuiltinTools'
    | 'topP'
    | 'topK'
    | 'repeatPenalty'
    | 'frequencyPenalty'
    | 'presencePenalty'
    | 'seed'
    | 'stopSequences'
    | 'maxOutputTokens'
  >,
  thinkOverride?: ThinkOverrideInput,
  effectiveThink?: ThinkValue,
): ChatConfigSnapshot {
  const reasoning = thinkOverride?.reasoning ?? agent.reasoning ?? DEFAULT_REASONING_MODE;
  const reasoningEffort =
    thinkOverride?.effort ?? agent.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  return {
    agentName: agent.name,
    model: agent.model,
    temperature: agent.temperature,
    contextSize: agent.contextSize,
    reasoning,
    reasoningEffort,
    think: effectiveThink ?? resolveThinkValue(reasoning, reasoningEffort),
    llmProvider: agent.llmProvider ?? DEFAULT_LLM_PROVIDER,
    approvalMode: agent.approvalMode,
    enabledToolCount: agent.enabledBuiltinTools?.length,
    topP: agent.topP,
    topK: agent.topK,
    repeatPenalty: agent.repeatPenalty,
    frequencyPenalty: agent.frequencyPenalty,
    presencePenalty: agent.presencePenalty,
    seed: agent.seed,
    stopSequences: agent.stopSequences,
    maxOutputTokens: agent.maxOutputTokens,
  };
}

/** 설정 변경 감지용 서명. 순서·공백에 영향받지 않는 단순 직렬화다. */
export function chatConfigSignature(snapshot: ChatConfigSnapshot): string {
  return [
    snapshot.agentName,
    snapshot.llmProvider ?? '',
    snapshot.model,
    String(snapshot.temperature),
    String(snapshot.contextSize),
    snapshot.reasoning,
    snapshot.reasoningEffort,
    String(snapshot.think ?? 'default'),
    snapshot.approvalMode ?? '',
    String(snapshot.enabledToolCount ?? ''),
    String(snapshot.topP ?? 'auto'),
    String(snapshot.topK ?? 'auto'),
    String(snapshot.repeatPenalty ?? 'auto'),
    String(snapshot.frequencyPenalty ?? 'auto'),
    String(snapshot.presencePenalty ?? 'auto'),
    String(snapshot.seed ?? 'auto'),
    (snapshot.stopSequences ?? []).join(','),
    String(snapshot.maxOutputTokens ?? 'auto'),
  ].join('|');
}

/**
 * Agent의 reasoning 설정 + 세션 오버라이드를 Ollama `think` 값으로 해석한다.
 * 메시지 배열을 건드리지 않으므로 effort를 바꿔도 프롬프트 토큰(prefill)에 변화가 없다.
 */
export function resolveThinkValue(
  reasoning?: ReasoningMode,
  effort?: ReasoningEffort,
): ThinkValue {
  const mode = reasoning ?? DEFAULT_REASONING_MODE;
  if (mode === 'off') return false;
  if (mode === 'on') return effort ?? DEFAULT_REASONING_EFFORT;
  return undefined;
}

export type BuiltinToolId =
  | 'read'
  | 'write'
  | 'edit'
  | 'ls'
  | 'grep'
  | 'find'
  | 'shell'
  | 'web_search'
  | 'web_fetch'
  | 'wiki';

/**
 * LLM Provider 종류. Ollama 네이티브 규격(/api/chat, NDJSON)과
 * OpenAI 호환 규격(/v1/chat/completions, SSE)으로 나뉜다.
 * 로컬 런타임(LM Studio / llama.cpp / vLLM / Jan)은 모두 OpenAI 호환
 * 클라이언트로 동작하며 프리셋 기본 Base URL만 다르다.
 * 클라우드(OpenAI/OpenRouter/Azure 등 OpenAI 호환 게이트웨이)도
 * 'openai' 또는 'openai-compatible' + apiKey로 연동한다.
 */
export type LlmProviderKind =
  | 'ollama'
  | 'lmstudio'
  | 'llamacpp'
  | 'vllm'
  | 'jan'
  | 'openai-compatible'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'xai'
  | 'deepseek'
  | 'openrouter'
  | 'mistral'
  | 'moonshot'
  | 'together'
  | 'opencode';

export const DEFAULT_LLM_PROVIDER: LlmProviderKind = 'ollama';

export function isOpenAiCompatibleProvider(kind?: LlmProviderKind): boolean {
  return (kind ?? DEFAULT_LLM_PROVIDER) !== 'ollama';
}

export type AgentConnectionStatus = 'unknown' | 'connected' | 'disconnected';

export interface Agent {
  id: string; // uuid
  name: string;
  description?: string;
  systemPrompt: string;
  model: string; // Ollama model tag, e.g. "qwen3.5:9b" (OpenAI 호환 Provider에서는 /v1/models의 ID)
  temperature: number; // 0.0 ~ 2.0, 기본 0.2
  contextSize: number; // token count. 0 inherits global
  reserveTokens: number; // compaction trigger margin
  keepRecentTokens: number; // tokens to keep after compaction
  enabledSkills: string[]; // SkillManifest.name list
  enabledBuiltinTools: BuiltinToolId[];
  approvalMode: ApprovalMode;
  reasoning?: ReasoningMode; // 사고모드. 미지정 시 'default'(모델 기본값)
  reasoningEffort?: ReasoningEffort; // reasoning==='on'일 때 Ollama think 레벨. 미지정 시 'medium'
  /**
   * 생성 파라미터(샘플링/출력 제어). 모두 선택값이며 미지정(undefined) 시
   * Provider·모델 기본값을 사용한다 ("자동").
   * - topP: nucleus sampling 상위 확률 질량 (0~1, 양쪽 Provider 지원)
   * - topK: 상위 K개 토큰으로 제한 (Ollama 전용)
   * - repeatPenalty: 반복 억제 강도 1~2 (Ollama 전용)
   * - frequencyPenalty/presencePenalty: 빈도/주제 반복 억제 -2~2 (OpenAI 호환 전용)
   * - seed: 재현용 시드 (양쪽 지원, 미지정 시 랜덤)
   * - stopSequences: 생성 중단 문자열 목록 (양쪽 지원, 최대 16개)
   * - maxOutputTokens: 응답 최대 토큰 (Ollama num_predict / OpenAI max_tokens)
   */
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  stopSequences?: string[];
  maxOutputTokens?: number;
  /** LLM Provider 종류. 미지정(구 DB 행) 시 'ollama'로 해석 */
  llmProvider?: LlmProviderKind;
  /** Provider Base URL. 미지정 시 프리셋 기본값(또는 Ollama는 전역 설정) 사용 */
  llmBaseUrl?: string;
  /** 클라우드/인증 필요 서버용 API 키. 로컬 런타임은 보통 불필요(Jan은 임의 문자열 가능) */
  llmApiKey?: string;
  /**
   * 대화 시작 시 모니터링 자동 시작 여부. 미지정(구 DB 행) 시 true(켜짐)로 해석.
   * on이면 대화 시작 시 자동으로 모니터링 상태로 전환하고,
   * LLM 호출 작업이 모두 완료되면 모니터링을 중단한다.
   */
  autoMonitor?: boolean;
  isDefault: boolean; // exactly one agent is true
  createdAt: string; // ISO 8601
  updatedAt: string;
}

