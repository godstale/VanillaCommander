import type { AgentMessage } from '@/lib/agent/types';
import { resolveThinkValue } from '@/lib/types/agent';
import { buildPrompt } from '../promptBuild';
import { registerSolver, type Solver, type SolverContext } from './index';

function estimateInputTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 3.2));
}

export const singleTurnSolver: Solver = async (ctx: SolverContext) => {
  const { candidate, pack, sample } = ctx;
  const { system, messages } = buildPrompt(candidate, pack.manifest, sample, ctx.rotation ?? 0);
  const startedAt = performance.now();
  const requestMessages = [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const fullInput = requestMessages.map((m) => m.content ?? '').join('\n');
  const estimatedInput = estimateInputTokens(fullInput);

  let outputText = '';
  let reasoningText = '';
  let ttftMs: number | null = null;
  let usage: { input?: number; output?: number } = {};
  let serverMetrics:
    | {
        promptEvalCount?: number;
        evalCount?: number;
        prefillTps?: number;
        decodeTps?: number;
      }
    | undefined;
  let gotFirst = false;

  const think = resolveThinkValue(candidate.reasoning, candidate.reasoningEffort);
  const stream = ctx.streamChat(
    {
      baseUrl: ctx.runtime.baseUrl,
      apiKey: ctx.apiKey,
      model: candidate.model,
      messages: requestMessages.map((m) => ({ role: m.role, content: m.content })),
      temperature: ctx.candidate.temperature,
      think: think ?? undefined,
      topP: candidate.topP,
      topK: candidate.topK,
      repeatPenalty: candidate.repeatPenalty,
      frequencyPenalty: candidate.frequencyPenalty,
      presencePenalty: candidate.presencePenalty,
      seed: candidate.seed,
      stopSequences: candidate.stopSequences,
      maxTokens: candidate.maxOutputTokens,
      options: candidate.contextSize > 0 ? { num_ctx: candidate.contextSize } : undefined,
    },
    ctx.signal,
  );

  for await (const chunk of stream) {
    if (!gotFirst && (chunk.content || chunk.thinking || chunk.toolCalls)) {
      ttftMs = performance.now() - startedAt;
      gotFirst = true;
    }
    if (chunk.content) outputText += chunk.content;
    if (chunk.thinking) reasoningText += chunk.thinking;
    if (chunk.usage) usage = { input: chunk.usage.input, output: chunk.usage.output };
    if (chunk.metrics) {
      serverMetrics = {
        promptEvalCount: chunk.metrics.promptEvalCount,
        evalCount: chunk.metrics.evalCount,
        prefillTps: chunk.metrics.prefillSpeed,
        decodeTps: chunk.metrics.decodingSpeed,
      };
    }
    if (chunk.done) break;
  }
  const totalMs = performance.now() - startedAt;

  const outputTokens = usage.output ?? serverMetrics?.evalCount ?? null;
  const inputTokens = usage.input ?? serverMetrics?.promptEvalCount ?? null;
  const hasServer = serverMetrics?.decodeTps !== undefined || serverMetrics?.prefillTps !== undefined;
  let decodeTps: number | null = serverMetrics?.decodeTps ?? null;
  let prefillTps: number | null = serverMetrics?.prefillTps ?? null;
  if (!hasServer) {
    const elapsedSec = Math.max(0.001, (totalMs - (ttftMs ?? 0)) / 1000);
    decodeTps = outputTokens !== null ? outputTokens / elapsedSec : null;
    prefillTps = null;
  }
  const cacheHit =
    serverMetrics?.promptEvalCount !== undefined
      ? serverMetrics.promptEvalCount < estimatedInput * 0.5
      : null;

  const transcript: AgentMessage[] = [
    ...requestMessages.map(
      (m): AgentMessage =>
        m.role === 'system'
          ? { role: 'system', content: m.content ?? '' }
          : m.role === 'user'
            ? { role: 'user', content: m.content ?? '' }
            : { role: 'assistant', content: m.content ?? '', stopReason: 'stop' as const },
    ),
    {
      role: 'assistant',
      content: outputText,
      ...(reasoningText ? { thinking: reasoningText } : {}),
      stopReason: 'stop',
    },
  ];

  return {
    outcome: 'ok',
    outputText,
    reasoningText: reasoningText || undefined,
    toolCalls: [],
    transcript,
    usage: { input: inputTokens ?? undefined, output: outputTokens ?? undefined },
    timing: {
      ttftMs,
      prefillTps,
      decodeTps,
      totalMs,
      timingSource: hasServer ? 'server' : 'client',
      cacheHit,
      inputTokens,
      outputTokens,
      thinkingTokens: null,
    },
    turns: 1,
  };
};

export function registerSingleTurnSolver(): void {
  registerSolver('single_turn', singleTurnSolver);
  registerSolver('multi_turn', singleTurnSolver);
  registerSolver('long_context', singleTurnSolver);
}
