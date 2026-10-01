import type { Agent, LlmProviderKind } from '@/lib/types/agent';

export interface LlmProviderPreset {
  kind: LlmProviderKind;
  /** UI 표시명 (i18n 키는 AgentEditorForm에서 매핑) */
  label: string;
  /** Base URL 미지정 시 사용할 기본값 */
  defaultBaseUrl: string;
  /** 해당 Provider 선택 시 제안하는 대표 모델 ID (사용자 수정 가능) */
  defaultModel?: string;
  /** Provider 선택 드롭다운 그룹 (로컬 직접연동 / 클라우드 / 게이트웨이) */
  category: 'local' | 'cloud' | 'gateway';
  /** OpenAI 호환 규격 여부 (ollama만 false) */
  openAiCompatible: boolean;
  /** apiKey 입력란을 노출할지 여부 */
  supportsApiKey: boolean;
  /** apiKey 필수 여부 (openai 클라우드는 필수, Jan은 서버 설정에 따라 선택) */
  requiresApiKey: boolean;
  /** 모델 목록 조회 지원 여부 — OpenAI 규격은 ID 목록만 반환 */
  supportsModelList: boolean;
  /** 컨텍스트 길이를 서버에서 자동 조회할 수 있는지 (Ollama /api/show만 가능) */
  supportsAutoContextSize: boolean;
  /** 짧은 설명 (설정 화면 힌트용) */
  hint: string;
}

/**
 * 로컬 런타임 기본 엔드포인트 (추가 자료조사, 2026-09-25 기준):
 * - Ollama: http://127.0.0.1:11434 (/api/chat 네이티브 + /v1 호환도 제공)
 * - LM Studio: http://localhost:1234/v1 (Server 탭, /v1/chat/completions)
 * - llama.cpp llama-server: http://127.0.0.1:8080/v1 (기본 8080 포트)
 * - vLLM: http://localhost:8000/v1 (`vllm serve`, 기본 8000 포트, --tool-call-parser 필요)
 * - Jan: http://127.0.0.1:1337/v1 (Local API Server, 임의 API 키 필요 가능)
 * - OpenAI 클라우드: https://api.openai.com/v1 (API 키 필수)
 */
export const LLM_PROVIDER_PRESETS: Record<LlmProviderKind, LlmProviderPreset> = {
  ollama: {
    kind: 'ollama',
    label: 'Ollama',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    defaultModel: 'qwen3.5:9b',
    category: 'local',
    openAiCompatible: false,
    supportsApiKey: false,
    requiresApiKey: false,
    supportsModelList: true,
    supportsAutoContextSize: true,
    hint: 'Ollama 네이티브 API (/api/chat, NDJSON 스트리밍)',
  },
  lmstudio: {
    kind: 'lmstudio',
    label: 'LM Studio',
    defaultBaseUrl: 'http://localhost:1234/v1',
    category: 'local',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: false,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: 'LM Studio Server 탭에서 서버를 시작하고 모델을 로드하세요 (OpenAI 호환, 기본 포트 1234)',
  },
  llamacpp: {
    kind: 'llamacpp',
    label: 'llama.cpp (llama-server)',
    defaultBaseUrl: 'http://127.0.0.1:8080/v1',
    category: 'local',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: false,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: 'llama-server 바이너리 (OpenAI 호환, 기본 포트 8080)',
  },
  vllm: {
    kind: 'vllm',
    label: 'vLLM',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    category: 'local',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: false,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: 'vLLM OpenAI-Compatible Server (기본 포트 8000, --tool-call-parser 권장)',
  },
  jan: {
    kind: 'jan',
    label: 'Jan.ai',
    defaultBaseUrl: 'http://127.0.0.1:1337/v1',
    category: 'local',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: false,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: 'Jan Local API Server (OpenAI 호환, 기본 포트 1337)',
  },
  'openai-compatible': {
    kind: 'openai-compatible',
    label: 'OpenAI Compatible (Local Agent, API)',
    defaultBaseUrl: 'http://127.0.0.1:1234/v1',
    category: 'local',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: false,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: '로컬 에이전트·직접 만든 앱과 연동하는 커스텀 OpenAI 호환 서버 (LocalAI, Ollama /v1 등). Base URL·모델을 직접 입력하세요.',
  },
  openai: {
    kind: 'openai',
    label: 'OpenAI (Cloud)',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    category: 'cloud',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: true,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: 'OpenAI 클라우드 API (외부 API 연동용, API 키 필수)',
  },
  anthropic: {
    kind: 'anthropic',
    label: 'Anthropic Claude (Cloud)',
    defaultBaseUrl: 'https://api.anthropic.com/v1/',
    defaultModel: 'claude-sonnet-4-5',
    category: 'cloud',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: true,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: 'Claude API (OpenAI 호환 형태로 연동. 네이티브는 /v1/messages 규격이므로 목록 조회 실패 시 OpenRouter 경유를 권장)',
  },
  gemini: {
    kind: 'gemini',
    label: 'Google Gemini (Cloud)',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.5-flash',
    category: 'cloud',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: true,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: 'Gemini OpenAI 호환 엔드포인트 (API 키 필수)',
  },
  xai: {
    kind: 'xai',
    label: 'xAI Grok (Cloud)',
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-3-mini',
    category: 'cloud',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: true,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: 'xAI Grok API (OpenAI 호환, API 키 필수)',
  },
  deepseek: {
    kind: 'deepseek',
    label: 'DeepSeek (Cloud)',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    category: 'cloud',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: true,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: 'DeepSeek API (OpenAI 호환, API 키 필수)',
  },
  mistral: {
    kind: 'mistral',
    label: 'Mistral (Cloud)',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    category: 'cloud',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: true,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: 'Mistral La Plateforme API (OpenAI 호환, API 키 필수)',
  },
  moonshot: {
    kind: 'moonshot',
    label: 'Moonshot / Kimi (Cloud)',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k2',
    category: 'cloud',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: true,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: 'Moonshot Kimi API (OpenAI 호환, API 키 필수)',
  },
  together: {
    kind: 'together',
    label: 'Together AI (Cloud)',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    category: 'cloud',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: true,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: 'Together 호스팅 오픈 모델 (Hermes·Llama·Mistral 등, API 키 필수)',
  },
  opencode: {
    kind: 'opencode',
    label: 'OpenCode Zen (Cloud)',
    defaultBaseUrl: 'https://opencode.ai/zen/v1',
    defaultModel: 'big-pickle',
    category: 'cloud',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: true,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: 'OpenCode Zen 게이트웨이 (OpenAI 호환, API 키 필수. Base URL·모델은 변경될 수 있어 수정 가능)',
  },
  openrouter: {
    kind: 'openrouter',
    label: 'OpenRouter (Gateway)',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4.5',
    category: 'gateway',
    openAiCompatible: true,
    supportsApiKey: true,
    requiresApiKey: true,
    supportsModelList: true,
    supportsAutoContextSize: false,
    hint: '다중 모델 게이트웨이 (Claude·Gemini·Hermes 등 통합 연동, API 키 필수)',
  },
};

export const LLM_PROVIDER_ORDER: LlmProviderKind[] = [
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
  'mistral',
  'moonshot',
  'together',
  'opencode',
  'openrouter',
];

export function getProviderPreset(kind?: LlmProviderKind): LlmProviderPreset {
  return LLM_PROVIDER_PRESETS[kind ?? 'ollama'] ?? LLM_PROVIDER_PRESETS.ollama;
}

export interface ResolvedLlmRuntime {
  kind: LlmProviderKind;
  preset: LlmProviderPreset;
  baseUrl: string;
  apiKey?: string;
  openAiCompatible: boolean;
}

function normalizeBaseUrl(url: string, openAiCompatible = false): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  // OpenAI 호환 규격은 {baseUrl}/models, {baseUrl}/chat/completions 형태다.
  // LM Studio가 표시하는 주소(http://127.0.0.1:1234)처럼 버전 prefix가 없으면
  // 요청 경로가 어긋나 404가 나므로 /v1을 보정한다. 경로가 이미 있으면 그대로 둔다
  // (Azure의 /openai/deployments/... 등 커스텀 게이트웨이 보호).
  if (openAiCompatible) {
    try {
      const u = new URL(trimmed);
      if (u.pathname === '' || u.pathname === '/') {
        u.pathname = '/v1';
        return u.toString().replace(/\/+$/, '');
      }
    } catch {
      // URL 파싱 불가 시 trim 결과만 사용한다
    }
  }
  return trimmed;
}

/**
 * Agent의 Provider 설정을 실제 접속 정보로 해석한다.
 * - baseUrl 미지정 시: ollama → 전역 설정값(없으면 프리셋 기본), 그 외 → 프리셋 기본
 * - OpenAI 호환 Provider는 버전 prefix 없는 주소(LM Studio 표시 주소 등)에 /v1을 보정한다
 * - apiKey는 앞뒤 공백 제거 후 빈 문자열이면 undefined
 */
export function resolveAgentLlmRuntime(
  agent: Pick<Agent, 'llmProvider' | 'llmBaseUrl' | 'llmApiKey'>,
  globalOllamaBaseUrl?: string,
): ResolvedLlmRuntime {
  const kind: LlmProviderKind = agent.llmProvider ?? 'ollama';
  const preset = getProviderPreset(kind);
  const rawBase = (agent.llmBaseUrl ?? '').trim();
  let baseUrl: string;
  if (rawBase) {
    baseUrl = normalizeBaseUrl(rawBase, preset.openAiCompatible);
  } else if (kind === 'ollama') {
    baseUrl = normalizeBaseUrl(globalOllamaBaseUrl || preset.defaultBaseUrl);
  } else {
    baseUrl = normalizeBaseUrl(preset.defaultBaseUrl, preset.openAiCompatible);
  }
  const apiKey = (agent.llmApiKey ?? '').trim() || undefined;
  return { kind, preset, baseUrl, apiKey, openAiCompatible: preset.openAiCompatible };
}

/** 저장 전 정규화: 기본값과 동일하면 빈 문자열로 저장해 프리셋 변경을 따라가게 한다. */
export function normalizeProviderFields(input: {
  llmProvider?: LlmProviderKind;
  llmBaseUrl?: string;
  llmApiKey?: string;
}): { llmProvider: LlmProviderKind; llmBaseUrl: string; llmApiKey: string } {
  const kind = input.llmProvider ?? 'ollama';
  const preset = getProviderPreset(kind);
  const rawBase = (input.llmBaseUrl ?? '').trim();
  // /v1 보정 후 기본값과 같으면(예: "http://localhost:1234" 입력) 프리셋 따라가기로 저장한다.
  const normalized = rawBase
    ? normalizeBaseUrl(rawBase, preset.openAiCompatible)
    : '';
  const llmBaseUrl =
    normalized && normalized !== normalizeBaseUrl(preset.defaultBaseUrl, preset.openAiCompatible)
      ? normalized
      : '';
  return {
    llmProvider: kind,
    llmBaseUrl,
    llmApiKey: (input.llmApiKey ?? '').trim(),
  };
}
