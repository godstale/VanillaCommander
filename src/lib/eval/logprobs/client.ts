/**
 * Non-streaming Ollama logprobs probe (P10-14).
 *
 * Ollama >= 0.12.11 answers `POST /api/chat` with `logprobs: true` and
 * `top_logprobs: N`, returning per-output-token log probabilities. Other
 * providers (or older Ollama) either reject the fields or omit them; both
 * cases surface as `Error('logprobs unsupported')` so callers can map the
 * trial/score to N/A (skipped_unsupported / skipped).
 *
 * Field-shape finding (2026-09-25): `src/lib/llm/ollamaClient.ts` exposes no
 * logprob fields — `OllamaChunk` carries only content/thinking/toolCalls plus
 * usage/metrics, and the NDJSON parser drops every other key. So this module
 * uses plain `fetch` against the same base-URL rules instead of reusing
 * `streamChat`. NOTE: plain fetch from the Tauri WebView is subject to CORS;
 * inside Tauri the caller should route through the Rust HTTP bypass
 * (`tauriLlmTransport`) or run this from a non-WebView context. That routing
 * belongs to the caller (solver/report layer), not here.
 */

export const DEFAULT_LOGPROBS_BASE_URL = 'http://127.0.0.1:11434';

/** Thrown (message-identical) whenever logprobs cannot be obtained. */
export const LOGPROBS_UNSUPPORTED = 'logprobs unsupported';

export interface LogprobCandidate {
  token: string;
  logprob: number;
}

export interface LogprobTrace {
  /** Sampled token per output position (join to decode). */
  tokens: string[];
  /** Top-N candidates per output position, descending logprob. */
  topLogprobs: LogprobCandidate[][];
  promptEvalCount?: number;
}

export interface LogprobRequest {
  baseUrl?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  numPredict?: number;
  topLogprobs?: number;
  temperature?: number;
  seed?: number;
}

export function isLogprobsUnsupported(err: unknown): boolean {
  return err instanceof Error && err.message === LOGPROBS_UNSUPPORTED;
}

function unsupported(): Error {
  return new Error(LOGPROBS_UNSUPPORTED);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Normalize one top-list entry to {token, logprob}; accepts prob as fallback. */
function normalizeCandidate(v: unknown): LogprobCandidate | null {
  const r = asRecord(v);
  if (!r) return null;
  const token =
    asString(r['token']) ?? asString(r['text']) ?? asString(r['content']) ?? asString(r['bytes']);
  let logprob =
    asNumber(r['logprob']) ?? asNumber(r['log_prob']) ?? asNumber(r['logProb']);
  if (logprob === null) {
    const prob = asNumber(r['prob']);
    if (prob !== null && prob > 0) logprob = Math.log(prob);
  }
  if (token === null || logprob === null) return null;
  return { token, logprob };
}

/**
 * Normalize one per-position entry to its top list. Accepts either a bare
 * candidate (single-entry fallback from the sampled token itself) or an
 * object wrapping the list under common key spellings.
 */
function normalizePosition(v: unknown): { sampled: string | null; top: LogprobCandidate[] } | null {
  const r = asRecord(v);
  if (!r) return null;
  const wrapped =
    r['top_logprobs'] ?? r['top_log_probs'] ?? r['topLogprobs'] ?? r['top'] ?? r['candidates'];
  if (Array.isArray(wrapped)) {
    const top: LogprobCandidate[] = [];
    for (const c of wrapped) {
      const cand = normalizeCandidate(c);
      if (cand) top.push(cand);
    }
    if (top.length > 0) {
      const sampled =
        asString(r['token']) ?? asString(r['text']) ?? asString(r['content']) ?? null;
      return { sampled, top };
    }
  }
  const single = normalizeCandidate(v);
  if (single) return { sampled: single.token, top: [single] };
  return null;
}

/**
 * Extract {tokens, topLogprobs} from a non-streaming /api/chat payload.
 * Tolerates the list living at `logprobs`, `message.logprobs`, or
 * `top_logprobs`, plus a split `{tokens, top_logprobs}` shape. Returns null
 * when no logprob fields are present (caller maps to unsupported).
 */
export function extractLogprobTrace(data: unknown): LogprobTrace | null {
  const root = asRecord(data);
  if (!root) return null;
  const message = asRecord(root['message']);
  const listRaw =
    root['logprobs'] ?? message?.['logprobs'] ?? root['top_logprobs'] ?? message?.['top_logprobs'];
  if (!Array.isArray(listRaw) || listRaw.length === 0) return null;

  // Split shape: { tokens: string[], top_logprobs: Array<Array<...>> }.
  const tokensRaw = root['tokens'] ?? message?.['tokens'];
  if (Array.isArray(tokensRaw) && tokensRaw.every((t) => typeof t === 'string')) {
    const topLists: LogprobCandidate[][] = [];
    for (const entry of listRaw) {
      if (!Array.isArray(entry)) return null;
      const top: LogprobCandidate[] = [];
      for (const c of entry) {
        const cand = normalizeCandidate(c);
        if (cand) top.push(cand);
      }
      if (top.length === 0) return null;
      topLists.push(top);
    }
    if (topLists.length !== tokensRaw.length) return null;
    return withPromptCount(root, {
      tokens: tokensRaw as string[],
      topLogprobs: topLists,
    });
  }

  const tokens: string[] = [];
  const topLogprobs: LogprobCandidate[][] = [];
  for (const entry of listRaw) {
    const pos = normalizePosition(entry);
    if (!pos) return null;
    topLogprobs.push(pos.top);
    // Prefer the sampled token; fall back to the top-1 candidate.
    tokens.push(pos.sampled ?? pos.top[0].token);
  }
  return withPromptCount(root, { tokens, topLogprobs });
}

function withPromptCount(
  root: Record<string, unknown>,
  trace: { tokens: string[]; topLogprobs: LogprobCandidate[][] },
): LogprobTrace {
  const n = asNumber(root['prompt_eval_count']);
  return n === null ? trace : { ...trace, promptEvalCount: n };
}

export async function requestLogprobs(
  req: LogprobRequest,
  signal?: AbortSignal,
): Promise<LogprobTrace> {
  const baseUrl = (req.baseUrl || DEFAULT_LOGPROBS_BASE_URL).replace(/\/+$/, '');
  const url = `${baseUrl}/api/chat`;
  const payload = {
    model: req.model,
    messages: req.messages,
    stream: false,
    logprobs: true,
    top_logprobs: req.topLogprobs ?? 20,
    options: {
      temperature: req.temperature ?? 0,
      num_predict: req.numPredict ?? 256,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err: unknown) {
    if (signal?.aborted) throw err;
    throw err instanceof Error ? err : new Error(String(err));
  }

  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      // ignore body read failures
    }
    // Non-Ollama providers typically reject the unknown logprobs fields.
    if (/logprob/i.test(body)) throw unsupported();
    throw new Error(`logprobs request failed with status ${res.status}: ${body || res.statusText}`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw unsupported();
  }
  const trace = extractLogprobTrace(data);
  if (!trace) throw unsupported();
  return trace;
}
