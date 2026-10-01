/**
 * logprob_trace solver (P10-14) + Q8 pair analysis.
 *
 * Runs the trial's candidate with temperature 0 / num_predict 256 /
 * top_logprobs 20 through the non-streaming logprobs client and stores the
 * trace in `extra.logprobTrace`; `outputText` is the decoded token stream.
 * Providers without logprobs support yield `skipped_unsupported` (N/A) with
 * `extra.logprobUnsupported = true` so the choice_logprob scorer and the
 * report layer can map the trial to N/A instead of failing it.
 *
 * The Q8 pair analysis itself runs in the report layer (wizard P10-16), not
 * here: use `analyzeQuantPair(traceR, traceQ)` there. Model matching also
 * lives in the wizard; `isSameBaseModel` below is the shared predicate
 * (Ollama /api/show family + parameter_size equality).
 */
import { buildPrompt } from '../promptBuild';
import {
  isLogprobsUnsupported,
  requestLogprobs,
  type LogprobTrace,
} from '../../logprobs/client';
import {
  pairFidelity,
  type QuantPairResult,
} from '../../logprobs/quantFidelity';
import { registerSolver, type Solver } from './index';

export const LOGPROB_TRACE_NUM_PREDICT = 256;
export const LOGPROB_TRACE_TOP_LOGPROBS = 20;

export const logprobTraceSolver: Solver = async (ctx) => {
  const { candidate, pack, sample } = ctx;
  const { system, messages } = buildPrompt(candidate, pack.manifest, sample, ctx.rotation ?? 0);
  const requestMessages = [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const startedAt = performance.now();
  const finishTiming = (outputTokens: number | null, inputTokens: number | null) => ({
    ttftMs: null as number | null,
    prefillTps: null as number | null,
    decodeTps: null as number | null,
    totalMs: performance.now() - startedAt,
    timingSource: 'client' as const,
    cacheHit: null as boolean | null,
    inputTokens,
    outputTokens,
    thinkingTokens: null as number | null,
  });

  let trace: LogprobTrace;
  try {
    trace = await requestLogprobs(
      {
        baseUrl: ctx.runtime.baseUrl,
        model: candidate.model,
        messages: requestMessages.map((m) => ({ role: m.role, content: m.content ?? '' })),
        numPredict: LOGPROB_TRACE_NUM_PREDICT,
        topLogprobs: LOGPROB_TRACE_TOP_LOGPROBS,
        temperature: 0,
        seed: candidate.seed,
      },
      ctx.signal,
    );
  } catch (err: unknown) {
    if (isLogprobsUnsupported(err)) {
      return {
        outcome: 'skipped_unsupported',
        outputText: '',
        toolCalls: [],
        extra: { logprobUnsupported: true },
        usage: {},
        timing: finishTiming(null, null),
        turns: 1,
      };
    }
    throw err;
  }

  const outputText = trace.tokens.join('');
  const inputTokens = trace.promptEvalCount ?? null;
  const outputTokens = trace.tokens.length;
  return {
    outcome: 'ok',
    outputText,
    toolCalls: [],
    transcript: [
      ...requestMessages.map((m) =>
        m.role === 'system'
          ? { role: 'system' as const, content: m.content ?? '' }
          : m.role === 'user'
            ? { role: 'user' as const, content: m.content ?? '' }
            : { role: 'assistant' as const, content: m.content ?? '', stopReason: 'stop' as const },
      ),
      { role: 'assistant' as const, content: outputText, stopReason: 'stop' as const },
    ],
    extra: {
      logprobTrace: {
        tokens: trace.tokens,
        topLogprobs: trace.topLogprobs,
        ...(trace.promptEvalCount !== undefined
          ? { promptEvalCount: trace.promptEvalCount }
          : {}),
      },
    },
    usage: {
      ...(trace.promptEvalCount !== undefined ? { input: trace.promptEvalCount } : {}),
      output: outputTokens,
    },
    timing: finishTiming(outputTokens, inputTokens),
    turns: 1,
  };
};

export function registerLogprobTraceSolver(): void {
  registerSolver('logprob_trace', logprobTraceSolver);
}

/**
 * Q8 pair analysis for the report layer: reference trace vs quantized trace.
 * Takes traces only — candidate/model matching lives in the wizard (P10-16).
 */
export function analyzeQuantPair(traceR: LogprobTrace, traceQ: LogprobTrace): QuantPairResult {
  return pairFidelity(traceR, traceQ);
}

export interface ShowModelIdentity {
  family?: string | null;
  parameter_size?: string | null;
  parameterSize?: string | null;
}

function normIdentityPart(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Same-base-model predicate for Q8 pairs: Ollama /api/show `details.family`
 * plus `details.parameter_size` must match (quantization_level intentionally
 * ignored — that is the dimension under test). Accepts both snake_case
 * (/api/show payload) and camelCase spellings. Model matching itself lives
 * in the wizard (P10-16); the /api/show payload type stays local to
 * `ollamaClient.ts`, so callers pass the two extracted fields.
 */
export function isSameBaseModel(a: ShowModelIdentity, b: ShowModelIdentity): boolean {
  const familyA = normIdentityPart(a.family);
  const familyB = normIdentityPart(b.family);
  if (!familyA || familyA !== familyB) return false;
  const sizeA = normIdentityPart(a.parameter_size ?? a.parameterSize);
  const sizeB = normIdentityPart(b.parameter_size ?? b.parameterSize);
  if (!sizeA || sizeA !== sizeB) return false;
  return true;
}
