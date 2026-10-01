import { resolveThinkValue } from '@/lib/types/agent';
import { registerSolver, type Solver } from './index';

// perf_probe: fixed-length generation repeated with a cache-busting nonce.
// Representative values use the median in aggregateRun (P10-07); repeats are kept in extra.
export const perfProbeSolver: Solver = async (ctx) => {
  const { candidate, sample } = ctx;
  const perf = sample.perf ?? { inputTokens: 512, outputTokens: 512 };
  const repeats = perf.repeats ?? 3;
  const filler = typeof sample.input === 'string' ? sample.input : 'Continue writing in detail.';
  const think = resolveThinkValue(candidate.reasoning, candidate.reasoningEffort);

  const runValues: Array<{
    ttftMs: number | null;
    decodeTps: number | null;
    prefillTps: number | null;
    totalMs: number;
    outputTokens: number | null;
  }> = [];
  let lastOutput = '';

  for (let r = 0; r < repeats; r++) {
    if (ctx.signal.aborted) throw new Error('cancelled');
    const nonce = `[run-${ctx.runId.slice(0, 8)}-${r}]`;
    const startedAt = performance.now();
    const stream = ctx.streamChat(
      {
        baseUrl: ctx.runtime.baseUrl,
        apiKey: ctx.apiKey,
        model: candidate.model,
        messages: [
          { role: 'user', content: `${nonce}\n${filler}` },
        ],
        temperature: candidate.temperature,
        think: think ?? undefined,
        seed: candidate.seed,
        maxTokens: perf.outputTokens,
        options: candidate.contextSize > 0 ? { num_ctx: candidate.contextSize } : undefined,
      },
      ctx.signal,
    );
    let outputTokens: number | null = null;
    let ttftMs: number | null = null;
    let decodeTps: number | null = null;
    let prefillTps: number | null = null;
    let gotFirst = false;
    let text = '';
    for await (const chunk of stream) {
      if (!gotFirst && (chunk.content || chunk.thinking)) {
        ttftMs = performance.now() - startedAt;
        gotFirst = true;
      }
      if (chunk.content) text += chunk.content;
      if (chunk.usage?.output !== undefined) outputTokens = chunk.usage.output;
      if (chunk.metrics) {
        if (chunk.metrics.evalCount !== undefined) outputTokens = chunk.metrics.evalCount;
        decodeTps = chunk.metrics.decodingSpeed;
        prefillTps = chunk.metrics.prefillSpeed;
      }
      if (chunk.done) break;
    }
    const totalMs = performance.now() - startedAt;
    if (decodeTps === null && outputTokens !== null) {
      decodeTps = outputTokens / Math.max(0.001, (totalMs - (ttftMs ?? 0)) / 1000);
    }
    runValues.push({ ttftMs, decodeTps, prefillTps, totalMs, outputTokens });
    lastOutput = text;
  }

  const median = (xs: Array<number | null>): number | null => {
    const nums = xs.filter((v): v is number => v !== null);
    if (nums.length === 0) return null;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const totalMs = runValues.reduce((a, r) => a + r.totalMs, 0);

  return {
    outcome: 'ok',
    outputText: lastOutput,
    toolCalls: [],
    extra: { repeats: runValues },
    usage: {},
    timing: {
      ttftMs: median(runValues.map((r) => r.ttftMs)),
      prefillTps: median(runValues.map((r) => r.prefillTps)),
      decodeTps: median(runValues.map((r) => r.decodeTps)),
      totalMs,
      timingSource: runValues.some((r) => r.prefillTps !== null) ? 'server' : 'client',
      cacheHit: null,
      inputTokens: perf.inputTokens,
      outputTokens: median(runValues.map((r) => r.outputTokens)),
      thinkingTokens: null,
    },
    turns: 1,
  };
};

export function registerPerfProbeSolver(): void {
  registerSolver('perf_probe', perfProbeSolver);
}
