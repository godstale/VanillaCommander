import { Channel, invoke } from '@tauri-apps/api/core';

/** Tauri Webview 안에서 실행 중인지 (그렇다면 LLM HTTP는 Rust 백엔드로 우회한다). */
export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
    )
  );
}

/** 백엔드가 비-2xx에 반환하는 `LLM_HTTP_STATUS <code> <body>` 에러. */
export class TauriHttpStatusError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`LLM provider request failed with status ${status}: ${body}`);
    this.name = 'TauriHttpStatusError';
  }
}

function toTransportError(raw: unknown): Error {
  const msg = raw instanceof Error ? raw.message : String(raw);
  const m = /^LLM_HTTP_STATUS (\d{3}) ?([\s\S]*)$/.exec(msg.trim());
  if (m) {
    return new TauriHttpStatusError(Number(m[1]), (m[2] || '').trim());
  }
  return raw instanceof Error ? raw : new Error(msg);
}

/** GET 텍스트 조회 (모델 목록 등). Tauri에서만 호출한다. */
export async function tauriHttpGetText(url: string, apiKey?: string): Promise<string> {
  try {
    return await invoke<string>('llm_http_get', { url, apiKey: apiKey ?? null });
  } catch (err) {
    throw toTransportError(err);
  }
}

/** body 없는 GET이 아니므로 Content-Type을 붙이는 비-스트리밍 POST (Ollama /api/show 등). */
export async function tauriHttpPostText(
  url: string,
  body: string,
  apiKey?: string,
): Promise<string> {
  try {
    return await invoke<string>('llm_http_post_text', {
      url,
      apiKey: apiKey ?? null,
      body,
    });
  } catch (err) {
    throw toTransportError(err);
  }
}

/** fetch body reader를 텍스트 조각 스트림으로 감싼다 (웹 프리뷰 경로). */
export async function* decodeFetchBodyStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 스트리밍 POST의 텍스트 조각. 백엔드 Channel을 fetch body reader처럼 내보낸다.
 * Abort 시 제너레이터만 중단된다 (이미 날아간 백엔드 요청은 끝까지 돌고 버려진다).
 */
export async function* tauriHttpPostStreamText(
  url: string,
  body: string,
  apiKey?: string,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const pending: string[] = [];
  let finished = false;
  let failed: unknown = null;
  let waiter: (() => void) | null = null;
  const wake = () => {
    const w = waiter;
    waiter = null;
    w?.();
  };
  const onchunk = new Channel<string>();
  onchunk.onmessage = (text) => {
    pending.push(text);
    wake();
  };
  // 성공/실패 모두 여기서 수렴시켜 스트림 종료 조건으로 삼는다.
  // (unhandled rejection 방지를 위해 두 분기 모두 처리한다)
  void invoke<void>('llm_http_post_stream', {
    url,
    apiKey: apiKey ?? null,
    body,
    onchunk,
  }).then(
    () => {
      finished = true;
      wake();
    },
    (err: unknown) => {
      failed = err;
      finished = true;
      wake();
    },
  );
  while (true) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Aborted', 'AbortError');
    }
    const next = pending.shift();
    if (next !== undefined) {
      yield next;
      continue;
    }
    if (failed !== null) throw toTransportError(failed);
    if (finished) return;
    await new Promise<void>((resolve) => {
      waiter = resolve;
    });
  }
}
