import type { LlmProviderKind } from '@/lib/types/agent';
import { isOpenAiCompatibleProvider } from '@/lib/types/agent';

/**
 * 에이전트 생성 파라미터(샘플링/출력 제어) 정의.
 * - `undefined` = 자동(Provider·모델 기본값 사용). DB에는 NULL/기본값으로 저장된다.
 * - Provider별 지원 여부는 SUPPORT_MATRIX가 단일 진실 공급원이다.
 *   UI 비활성화·런타임 전송 필터링이 모두 이 모듈을 참조한다.
 */
export type GenerationParamKey =
  | 'topP'
  | 'topK'
  | 'repeatPenalty'
  | 'frequencyPenalty'
  | 'presencePenalty'
  | 'seed'
  | 'stopSequences'
  | 'maxOutputTokens';

export interface GenerationParamMeta {
  key: GenerationParamKey;
  /** Ollama 네이티브(/api/chat options) 지원 여부 */
  ollama: boolean;
  /** OpenAI 호환(/v1/chat/completions) 지원 여부 */
  openAiCompatible: boolean;
  /** 자동일 때 적용되는 대표 기본값 (UI 표시용 참고치) */
  autoDefault: string;
}

export const GENERATION_PARAM_META: Record<GenerationParamKey, GenerationParamMeta> = {
  topP: { key: 'topP', ollama: true, openAiCompatible: true, autoDefault: '0.9' },
  topK: { key: 'topK', ollama: true, openAiCompatible: false, autoDefault: '40' },
  repeatPenalty: { key: 'repeatPenalty', ollama: true, openAiCompatible: false, autoDefault: '1.1' },
  frequencyPenalty: { key: 'frequencyPenalty', ollama: false, openAiCompatible: true, autoDefault: '0' },
  presencePenalty: { key: 'presencePenalty', ollama: false, openAiCompatible: true, autoDefault: '0' },
  seed: { key: 'seed', ollama: true, openAiCompatible: true, autoDefault: 'random' },
  stopSequences: { key: 'stopSequences', ollama: true, openAiCompatible: true, autoDefault: 'none' },
  maxOutputTokens: { key: 'maxOutputTokens', ollama: true, openAiCompatible: true, autoDefault: 'unlimited' },
};

export const GENERATION_PARAM_ORDER: GenerationParamKey[] = [
  'topP',
  'topK',
  'repeatPenalty',
  'frequencyPenalty',
  'presencePenalty',
  'seed',
  'stopSequences',
  'maxOutputTokens',
];

/** 값 범위 (UI 검증·정규화 공용) */
export const GENERATION_PARAM_RANGES = {
  topP: { min: 0, max: 1 },
  topK: { min: 1, max: 1000 },
  repeatPenalty: { min: 1, max: 2 },
  frequencyPenalty: { min: -2, max: 2 },
  presencePenalty: { min: -2, max: 2 },
  maxOutputTokens: { min: 1, max: 131072 },
} as const;

export function isGenerationParamSupported(
  key: GenerationParamKey,
  provider?: LlmProviderKind,
): boolean {
  const meta = GENERATION_PARAM_META[key];
  if (isOpenAiCompatibleProvider(provider)) return meta.openAiCompatible;
  return meta.ollama;
}

export function unsupportedGenerationParams(
  provider?: LlmProviderKind,
): GenerationParamKey[] {
  return GENERATION_PARAM_ORDER.filter((k) => !isGenerationParamSupported(k, provider));
}

export interface GenerationParams {
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  stopSequences?: string[];
  maxOutputTokens?: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function cleanNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

/**
 * 저장·전송 전 정규화. 범위 밖 값은 클램프하고, 빈 stop 시퀀스는 버린다.
 * 범위를 벗어난 입력이 조용히 바뀌므로 UI는 입력 단계에서 min/max를 강제한다.
 */
export function normalizeGenerationParams(input: GenerationParams): GenerationParams {
  const out: GenerationParams = {};
  const topP = cleanNumber(input.topP);
  if (topP !== undefined) out.topP = clamp(topP, 0, 1);
  const topK = cleanNumber(input.topK);
  if (topK !== undefined) out.topK = Math.round(clamp(topK, 1, 1000));
  const repeatPenalty = cleanNumber(input.repeatPenalty);
  if (repeatPenalty !== undefined) out.repeatPenalty = clamp(repeatPenalty, 1, 2);
  const frequencyPenalty = cleanNumber(input.frequencyPenalty);
  if (frequencyPenalty !== undefined)
    out.frequencyPenalty = clamp(frequencyPenalty, -2, 2);
  const presencePenalty = cleanNumber(input.presencePenalty);
  if (presencePenalty !== undefined)
    out.presencePenalty = clamp(presencePenalty, -2, 2);
  const seed = cleanNumber(input.seed);
  if (seed !== undefined) out.seed = Math.max(0, Math.floor(seed));
  if (Array.isArray(input.stopSequences)) {
    const stops = input.stopSequences
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 16);
    if (stops.length > 0) out.stopSequences = stops;
  }
  const maxOutputTokens = cleanNumber(input.maxOutputTokens);
  if (maxOutputTokens !== undefined)
    out.maxOutputTokens = Math.round(clamp(maxOutputTokens, 1, 131072));
  return out;
}

/** Ollama `/api/chat` options 페이로드로 변환 (미지원 키는 호출자가 미리 걸렀다고 가정) */
export function toOllamaOptions(params: GenerationParams): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (params.topP !== undefined) options['top_p'] = params.topP;
  if (params.topK !== undefined) options['top_k'] = params.topK;
  if (params.repeatPenalty !== undefined) options['repeat_penalty'] = params.repeatPenalty;
  if (params.seed !== undefined) options['seed'] = params.seed;
  if (params.stopSequences && params.stopSequences.length > 0)
    options['stop'] = params.stopSequences;
  if (params.maxOutputTokens !== undefined)
    options['num_predict'] = params.maxOutputTokens;
  return options;
}

/** OpenAI 호환 `/v1/chat/completions` 최상위 필드로 변환 */
export function toOpenAiParams(params: GenerationParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (params.topP !== undefined) body['top_p'] = params.topP;
  if (params.frequencyPenalty !== undefined)
    body['frequency_penalty'] = params.frequencyPenalty;
  if (params.presencePenalty !== undefined)
    body['presence_penalty'] = params.presencePenalty;
  if (params.seed !== undefined) body['seed'] = params.seed;
  if (params.stopSequences && params.stopSequences.length > 0)
    body['stop'] = params.stopSequences;
  if (params.maxOutputTokens !== undefined)
    body['max_tokens'] = params.maxOutputTokens;
  return body;
}

/**
 * 모델의 thinking 메타로 effort 레벨 지원 여부를 판단한다.
 * values에 문자열 레벨이 하나도 없으면 Low/Medium/High 지정이 무의미하다.
 * 메타 자체가 없으면(연결 전·비-Ollama) 알 수 없으므로 true를 반환한다.
 */
export function supportsEffortLevels(
  thinking: { values: Array<boolean | string> } | undefined,
): boolean {
  if (!thinking) return true;
  return thinking.values.some((v) => typeof v === 'string');
}

/** 스냅샷·UI 표시용 한 줄 요약 (auto는 'auto') */
export function formatGenerationParamValue(
  key: GenerationParamKey,
  params: GenerationParams,
): string {
  switch (key) {
    case 'topP':
      return params.topP !== undefined ? String(params.topP) : 'auto';
    case 'topK':
      return params.topK !== undefined ? String(params.topK) : 'auto';
    case 'repeatPenalty':
      return params.repeatPenalty !== undefined ? String(params.repeatPenalty) : 'auto';
    case 'frequencyPenalty':
      return params.frequencyPenalty !== undefined
        ? String(params.frequencyPenalty)
        : 'auto';
    case 'presencePenalty':
      return params.presencePenalty !== undefined ? String(params.presencePenalty) : 'auto';
    case 'seed':
      return params.seed !== undefined ? String(params.seed) : 'auto';
    case 'stopSequences':
      return params.stopSequences && params.stopSequences.length > 0
        ? params.stopSequences.join(', ')
        : 'auto';
    case 'maxOutputTokens':
      return params.maxOutputTokens !== undefined
        ? String(params.maxOutputTokens)
        : 'auto';
  }
}
