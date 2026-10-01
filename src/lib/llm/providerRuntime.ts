import type { Agent } from '@/lib/types/agent';
import type { TokenUsage } from '@/lib/agent/types';
import type { LlmPerformanceMetrics } from '@/lib/types/monitoring';
import {
  getProviderPreset,
  resolveAgentLlmRuntime,
  type ResolvedLlmRuntime,
} from '@/lib/llm/providers';
import {
  listModels as listOllamaModels,
  showModel as showOllamaModel,
  streamChat as streamOllamaChat,
} from '@/lib/llm/ollamaClient';
import {
  listModels as listOpenAiModels,
  streamChat as streamOpenAiChat,
} from '@/lib/llm/openAiCompatibleClient';

export type { ResolvedLlmRuntime };
export { getProviderPreset, resolveAgentLlmRuntime };

/**
 * 루프/훅이 주입받는 Provider 중립 스트리밍 시그니처.
 * Ollama 네이티브 규격과 OpenAI 호환 규격의 상위 집합이며,
 * 각 클라이언트는 자신이 이해하는 필드만 읽는다.
 */
export interface LlmChatRequestMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function: { name: string; arguments: unknown };
  }>;
  tool_call_id?: string;
}

export interface LlmChatRequest {
  baseUrl?: string;
  apiKey?: string;
  model: string;
  messages: LlmChatRequestMessage[];
  tools?: unknown[];
  temperature?: number;
  think?: boolean | string | null;
  /** 생성 파라미터. 각 클라이언트가 자신의 규격에 맞는 필드만 읽는다. */
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  stopSequences?: string[];
  maxTokens?: number;
  options?: Record<string, unknown>;
}

export interface LlmChunk {
  content?: string;
  thinking?: string;
  toolCalls?: Array<{
    id?: string;
    function: { name: string; arguments: Record<string, unknown> };
  }>;
  done: boolean;
  usage?: TokenUsage;
  metrics?: LlmPerformanceMetrics;
}

/** 루프/훅이 주입받는 스트리밍 함수 시그니처 (Ollama/OpenAI 호환 공용). */
export type LlmStreamChatFn = (
  req: LlmChatRequest,
  signal?: AbortSignal,
) => AsyncIterable<LlmChunk>;

/**
 * 런타임에 맞는 스트리밍 함수를 반환한다.
 * 테스트에서 주입한 custom 함수가 있으면 그것을 우선한다.
 */
export function getStreamChatFn(
  runtime: Pick<ResolvedLlmRuntime, 'openAiCompatible'>,
  custom?: LlmStreamChatFn,
): LlmStreamChatFn {
  if (custom) return custom;
  return (runtime.openAiCompatible
    ? (streamOpenAiChat as unknown as LlmStreamChatFn)
    : (streamOllamaChat as unknown as LlmStreamChatFn));
}

export interface ProviderModelInfo {
  name: string;
  size?: number;
}

/** Provider 종류에 맞는 모델 목록 조회 (UI 드롭다운 공용). */
export async function listProviderModels(runtime: ResolvedLlmRuntime): Promise<ProviderModelInfo[]> {
  if (runtime.openAiCompatible) {
    const models = await listOpenAiModels(runtime.baseUrl, runtime.apiKey);
    return models.map((m) => ({ name: m.id }));
  }
  const models = await listOllamaModels(runtime.baseUrl);
  return models.map((m) => ({ name: m.name, size: m.size }));
}

/**
 * 루프백 대체 주소. Windows에서는 `localhost`와 `127.0.0.1`의 해석(IPv6 ::1/IPv4)이
 * 서버 바인딩과 어긋나 한쪽만 연결되는 경우가 있다 (LM Studio 등).
 * 루프백이면 반대 표기를, 그 외·파싱 실패면 null을 반환한다.
 */
export function loopbackFallbackUrl(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    if (u.hostname === '127.0.0.1') {
      u.hostname = 'localhost';
    } else if (u.hostname.toLowerCase() === 'localhost') {
      u.hostname = '127.0.0.1';
    } else {
      return null;
    }
    return u.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export interface ModelListFetch {
  models: ProviderModelInfo[];
  /** 실제로 목록을 가져온 Base URL */
  baseUrl: string;
  /** 루프백 대체 주소로 가져왔으면 true (설정된 주소 자체는 미검증) */
  fromFallback: boolean;
}

/**
 * 모델 목록 조회 + 루프백 대체 재시도 (콤보박스 채우기용).
 * 연결 판정(checkProviderModel)과 달리 목록 표시에만 쓰이며,
 * 대체 주소로 가져와도 설정된 주소의 연결 성공으로 보지 않는다.
 */
export async function listProviderModelsWithFallback(
  runtime: ResolvedLlmRuntime,
): Promise<ModelListFetch> {
  try {
    return { models: await listProviderModels(runtime), baseUrl: runtime.baseUrl, fromFallback: false };
  } catch (err) {
    const alt = loopbackFallbackUrl(runtime.baseUrl);
    if (!alt) throw err;
    const models = await listProviderModels({ ...runtime, baseUrl: alt });
    return { models, baseUrl: alt, fromFallback: true };
  }
}

/**
 * 모델 존재 여부를 확인한다.
 * - 'connected': 모델이 목록에 있음 (Ollama는 /api/show 폴백 포함)
 * - 'model-missing': 서버 도달은 됐으나 목록에 모델이 없음
 * - 서버 도달 자체가 실패하면 throw (호출자가 네트워크 에러로 표시)
 */
export async function checkProviderModel(
  runtime: ResolvedLlmRuntime,
  model: string,
): Promise<'connected' | 'model-missing'> {
  if (runtime.openAiCompatible) {
    const models = await listOpenAiModels(runtime.baseUrl, runtime.apiKey);
    if (models.some((m) => m.id === model || m.id.toLowerCase() === model.toLowerCase())) {
      return 'connected';
    }
    // 목록에 없어도 실제 추론 가능 모델일 수 있으나, 호출 없이 확인할
    // 방법이 없으므로 목록 기준을 따른다 (OpenAI 규격에 /show 상당 API 없음).
    return 'model-missing';
  }
  const models = await listOllamaModels(runtime.baseUrl);
  if (models.some((m) => m.name === model || m.name.toLowerCase() === model.toLowerCase())) {
    return 'connected';
  }
  try {
    await showOllamaModel(runtime.baseUrl, model);
    return 'connected';
  } catch {
    // 목록 조회까지 성공했으므로 서버는 살아있다 → 모델 부재로 본다.
    return 'model-missing';
  }
}

/** Agent + 전역 Ollama URL에서 런타임을 해석하는 편의 함수. */
export function resolveRuntimeForAgent(
  agent: Pick<Agent, 'llmProvider' | 'llmBaseUrl' | 'llmApiKey'>,
  globalOllamaBaseUrl?: string,
): ResolvedLlmRuntime {
  return resolveAgentLlmRuntime(agent, globalOllamaBaseUrl);
}

/** 모니터링/상태 확인 등 baseUrl 문자열만 필요한 호출부용. */
export function resolveBaseUrlForAgent(
  agent: Pick<Agent, 'llmProvider' | 'llmBaseUrl'>,
  globalOllamaBaseUrl?: string,
): string {
  return resolveAgentLlmRuntime(agent, globalOllamaBaseUrl).baseUrl;
}
