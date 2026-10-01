import type { TokenUsage } from '@/lib/agent/types';
import type { LlmPerformanceMetrics } from '@/lib/types/monitoring';
import {
  TauriHttpStatusError,
  decodeFetchBodyStream,
  isTauriRuntime,
  tauriHttpGetText,
  tauriHttpPostStreamText,
} from '@/lib/llm/tauriLlmTransport';

export class OpenAiConnectionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(`LLM provider connection error: ${message}`);
    this.name = 'OpenAiConnectionError';
  }
}

export class OpenAiModelNotFoundError extends Error {
  constructor(public readonly model: string) {
    super(`LLM provider model not found: ${model}`);
    this.name = 'OpenAiModelNotFoundError';
  }
}

export class OpenAiContextOverflowError extends Error {
  constructor(message: string) {
    super(`LLM provider context length overflow: ${message}`);
    this.name = 'OpenAiContextOverflowError';
  }
}

export class OpenAiRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(`LLM provider request failed with status ${status}: ${message}`);
    this.name = 'OpenAiRequestError';
  }
}

export class OpenAiAuthError extends Error {
  constructor(message: string) {
    super(`LLM provider authentication failed: ${message}`);
    this.name = 'OpenAiAuthError';
  }
}

export interface OpenAiToolCallDelta {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface OpenAiChunk {
  content?: string;
  thinking?: string;
  toolCalls?: OpenAiToolCallDelta[];
  done: boolean;
  usage?: TokenUsage;
  metrics?: LlmPerformanceMetrics;
}

export interface OpenAiChatRequest {
  baseUrl?: string;
  apiKey?: string;
  model: string;
  messages: Array<{
    role: string;
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  }>;
  tools?: unknown[];
  temperature?: number;
  /**
   * Reasoning 제어. Ollama `think`에 대응하는 OpenAI 호환 필드로 변환된다.
   * - false: 생략 (모델 기본값)
   * - true: reasoning_effort='medium' 전송 (서버가 지원할 때만 유효)
   * - 'low'|'medium'|'high' 등 문자열: reasoning_effort 그대로 전송
   * - null/undefined: 필드 생략
   */
  think?: boolean | string | null;
  options?: Record<string, unknown>;
  maxTokens?: number;
  /** 생성 파라미터 (12. body 병합보다 우선한다). */
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  stopSequences?: string[];
}

export interface OpenAiModel {
  id: string;
  created?: number;
  owned_by?: string;
}

function isContextOverflowMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('context window') ||
    lower.includes('context length') ||
    lower.includes('context limit') ||
    lower.includes('exceeds context') ||
    lower.includes('maximum context') ||
    lower.includes('too many tokens') ||
    lower.includes('max_tokens')
  );
}

function isModelNotFoundMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('model not found') ||
    lower.includes('model_not_found') ||
    lower.includes('does not exist') ||
    lower.includes('no such model') ||
    lower.includes('model_not_available')
  );
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey.trim()) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }
  return headers;
}

/**
 * GET용 헤더. body가 없는 GET에 Content-Type을 보내면
 * 브라우저가 CORS preflight(OPTIONS)를 발생시키고,
 * LM Studio 등 로컬 서버가 OPTIONS /v1/models를 처리하지 못해
 * 연결 테스트가 실패한다. Authorization이 없으면 simple request로 나간다.
 */
function buildGetHeaders(apiKey?: string): Record<string, string> {
  if (apiKey && apiKey.trim()) {
    return { Authorization: `Bearer ${apiKey.trim()}` };
  }
  return {};
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

interface ToolCallDraft {
  index: number;
  id: string;
  name: string;
  argumentsText: string;
}

function snapshotDrafts(drafts: Map<number, ToolCallDraft>): OpenAiToolCallDelta[] {
  const out: OpenAiToolCallDelta[] = [];
  for (const draft of [...drafts.values()].sort((a, b) => a.index - b.index)) {
    let args: Record<string, unknown> = {};
    const text = draft.argumentsText.trim();
    if (text) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        // 부분 JSON이면 빈 객체로 두고 후속 청크에서 완성되길 기다린다
      }
    }
    out.push({ id: draft.id, function: { name: draft.name, arguments: args } });
  }
  return out;
}

export async function* streamChat(
  req: OpenAiChatRequest,
  signal?: AbortSignal,
): AsyncIterable<OpenAiChunk> {
  const baseUrl = (req.baseUrl || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '');
  const url = joinUrl(baseUrl, '/chat/completions');
  const startedAt = performance.now();

  const reasoningEffort =
    req.think === true ? 'medium' : typeof req.think === 'string' ? req.think : undefined;

  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: true,
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.topP !== undefined ? { top_p: req.topP } : {}),
    ...(req.frequencyPenalty !== undefined
      ? { frequency_penalty: req.frequencyPenalty }
      : {}),
    ...(req.presencePenalty !== undefined
      ? { presence_penalty: req.presencePenalty }
      : {}),
    ...(req.seed !== undefined ? { seed: req.seed } : {}),
    ...(req.stopSequences && req.stopSequences.length > 0
      ? { stop: req.stopSequences }
      : {}),
    ...(req.tools && req.tools.length > 0 ? { tools: req.tools } : {}),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    stream_options: { include_usage: true },
    ...(req.options ?? {}),
  };
  // Ollama 전용 옵션(num_ctx, top_k, repeat_penalty, num_predict 등)이
  // 섞여 들어오면 OpenAI 호환 서버가 400을 반환할 수 있으므로 제거한다.
  for (const ollamaOnlyKey of ['num_ctx', 'num_predict', 'top_k', 'repeat_penalty', 'think']) {
    if (ollamaOnlyKey in body) delete body[ollamaOnlyKey];
  }

  const bodyJson = JSON.stringify(body);
  // Tauri Webview의 fetch는 CORS를 강제하고 LM Studio 등은 ACAO를 보내지 않으므로,
  // Tauri 안에서는 Rust 백엔드(reqwest)로 우회한다. 웹 프리뷰는 fetch를 쓴다.
  let textChunks: AsyncIterable<string>;
  if (isTauriRuntime()) {
    textChunks = tauriHttpPostStreamText(url, bodyJson, req.apiKey, signal);
  } else {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(req.apiKey),
        body: bodyJson,
        signal,
      });
    } catch (err: unknown) {
      if (signal?.aborted) throw err;
      throw new OpenAiConnectionError(err instanceof Error ? err.message : String(err), err);
    }

    if (!response.ok) {
      let errBody = '';
      try {
        errBody = await response.text();
      } catch {
        // ignore
      }
      if (response.status === 401 || response.status === 403) {
        throw new OpenAiAuthError(errBody || response.statusText);
      }
      if (response.status === 404 && isModelNotFoundMessage(errBody)) {
        throw new OpenAiModelNotFoundError(req.model);
      }
      if (isContextOverflowMessage(errBody)) {
        throw new OpenAiContextOverflowError(errBody);
      }
      throw new OpenAiRequestError(errBody || response.statusText, response.status);
    }

    if (!response.body) {
      throw new OpenAiRequestError('Response body is null', response.status);
    }
    textChunks = decodeFetchBodyStream(response.body);
  }

  let buffer = '';
  const drafts = new Map<number, ToolCallDraft>();
  let usage: TokenUsage | undefined;

  try {
    for await (const text of textChunks) {
      buffer += text;

      // SSE는 빈 줄(\n\n)로 이벤트를 구분한다
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        const lines = event.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data) continue;
          if (data === '[DONE]') {
            yield {
              content: undefined,
              thinking: undefined,
              toolCalls: drafts.size > 0 ? snapshotDrafts(drafts) : undefined,
              done: true,
              usage,
              metrics: undefined,
            };
            continue;
          }

          let parsed: {
            choices?: Array<{
              delta?: {
                content?: string | null;
                reasoning_content?: string | null;
                reasoning?: string | null;
                thinking?: string | null;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            error?: { message?: string; code?: string };
          };
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          if (parsed.error?.message) {
            const msg = parsed.error.message;
            if (isContextOverflowMessage(msg)) throw new OpenAiContextOverflowError(msg);
            if (isModelNotFoundMessage(msg)) throw new OpenAiModelNotFoundError(req.model);
            throw new OpenAiRequestError(msg, 500);
          }

          if (parsed.usage) {
            const input = parsed.usage.prompt_tokens ?? 0;
            const output = parsed.usage.completion_tokens ?? 0;
            usage = { input, output, total: parsed.usage.total_tokens ?? input + output };
          }

          const delta = parsed.choices?.[0]?.delta;
          const finishReason = parsed.choices?.[0]?.finish_reason;
          if (!delta && !finishReason) continue;

          let content: string | undefined;
          if (typeof delta?.content === 'string' && delta.content) content = delta.content;

          // Thinking/reasoning: <think> 블록, reasoning_content, reasoning 필드를 모두 수집
          let thinking: string | undefined;
          const reasoningText =
            delta?.reasoning_content ?? delta?.reasoning ?? delta?.thinking ?? null;
          if (typeof reasoningText === 'string' && reasoningText) thinking = reasoningText;

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = drafts.get(idx);
              if (existing) {
                if (tc.id && !existing.id.startsWith('call_')) {
                  // 서버 ID 유지
                } else if (tc.id) {
                  existing.id = tc.id;
                }
                if (tc.function?.name) existing.name = tc.function.name;
                if (typeof tc.function?.arguments === 'string') {
                  existing.argumentsText += tc.function.arguments;
                }
              } else {
                drafts.set(idx, {
                  index: idx,
                  id: tc.id || `call_${idx}_${Date.now().toString(36)}`,
                  name: tc.function?.name || '',
                  argumentsText: tc.function?.arguments || '',
                });
              }
            }
          }

          const isDone =
            finishReason === 'stop' ||
            finishReason === 'tool_calls' ||
            finishReason === 'length';
          const toolSnapshot = drafts.size > 0 ? snapshotDrafts(drafts) : undefined;
          if (!content && !thinking && !toolSnapshot && !isDone && !usage) continue;

          let metrics: LlmPerformanceMetrics | undefined;
          if (isDone) {
            const elapsed = Math.max(1, Math.round(performance.now() - startedAt));
            metrics = {
              totalDurationMs: elapsed,
              loadDurationMs: 0,
              promptEvalCount: usage?.input ?? 0,
              promptEvalDurationMs: 0,
              evalCount: usage?.output ?? 0,
              evalDurationMs: elapsed,
              prefillSpeed: 0,
              decodingSpeed: 0,
              completedAt: Date.now(),
            };
          }

          yield { content, thinking, toolCalls: toolSnapshot, done: isDone, usage, metrics };
        }
      }
    }
  } catch (err) {
    // Tauri 우회 경로의 상태 에러를 fetch 경로와 같은 타입으로 매핑한다.
    // (SSE 본문에 담긴 모델 에러는 위 루프에서 이미 OpenAi* 로 던져진다)
    throw mapTauriStreamError(err, req.model);
  }
}

/** Tauri 우회 스트림의 상태 에러를 OpenAI 호환 타입 에러로 매핑한다. */
function mapTauriStreamError(err: unknown, model: string): unknown {
  if (err instanceof TauriHttpStatusError) {
    if (err.status === 401 || err.status === 403) {
      return new OpenAiAuthError(err.body || `status ${err.status}`);
    }
    if (err.status === 404 && isModelNotFoundMessage(err.body)) {
      return new OpenAiModelNotFoundError(model);
    }
    if (isContextOverflowMessage(err.body)) {
      return new OpenAiContextOverflowError(err.body);
    }
    return new OpenAiRequestError(err.body || `status ${err.status}`, err.status);
  }
  return err;
}

export async function listModels(baseUrl?: string, apiKey?: string): Promise<OpenAiModel[]> {
  const host = (baseUrl || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '');
  if (isTauriRuntime()) {
    try {
      const text = await tauriHttpGetText(joinUrl(host, '/models'), apiKey);
      const data = JSON.parse(text) as { data?: OpenAiModel[] };
      return data.data || [];
    } catch (err) {
      throw mapTauriListError(err);
    }
  }
  try {
    const res = await fetch(joinUrl(host, '/models'), {
      method: 'GET',
      headers: buildGetHeaders(apiKey),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new OpenAiAuthError(res.statusText);
      }
      throw new OpenAiRequestError(res.statusText, res.status);
    }
    const data = (await res.json()) as { data?: OpenAiModel[] };
    return data.data || [];
  } catch (err) {
    if (
      err instanceof OpenAiRequestError ||
      err instanceof OpenAiAuthError
    ) {
      throw err;
    }
    throw new OpenAiConnectionError(err instanceof Error ? err.message : String(err), err);
  }
}

/** Tauri 우회 GET의 에러를 목록 조회 타입 에러로 매핑한다. */
function mapTauriListError(err: unknown): Error {
  if (err instanceof TauriHttpStatusError) {
    if (err.status === 401 || err.status === 403) {
      return new OpenAiAuthError(err.body || `status ${err.status}`);
    }
    return new OpenAiRequestError(err.body || `status ${err.status}`, err.status);
  }
  return new OpenAiConnectionError(err instanceof Error ? err.message : String(err), err);
}
