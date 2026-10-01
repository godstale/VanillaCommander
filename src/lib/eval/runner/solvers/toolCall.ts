import { getBuiltinTools } from '@/lib/tools/registry';
import { mapAgentToolsToOllama } from '@/lib/llm/messageMapper';
import { resolveThinkValue } from '@/lib/types/agent';
import { EVAL_TOOLS_ALLOWED } from '../../constants';
import { buildPrompt } from '../promptBuild';
import { registerSolver, type Solver } from './index';
import type { ToolSchemaJson } from '../../types';

export const toolCallSolver: Solver = async (ctx) => {
  const { candidate, pack, sample } = ctx;
  const startedAt = performance.now();

  // Sample-level tools override the pack default (bfcl). Never executed — schema only.
  const manifestTools: ToolSchemaJson[] | null =
    pack.manifest.tools === 'fortress-default' ? null : (pack.manifest.tools ?? null);
  const sampleSchemas: ToolSchemaJson[] | null = sample.tools ?? manifestTools;
  const mapped: unknown[] = sampleSchemas
    ? sampleSchemas.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
    : mapAgentToolsToOllama(
        getBuiltinTools([...EVAL_TOOLS_ALLOWED, 'web_search'], {}),
      );

  const { system, messages } = buildPrompt(candidate, pack.manifest, sample, ctx.rotation ?? 0);
  const requestMessages = [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const think = resolveThinkValue(candidate.reasoning, candidate.reasoningEffort);
  let outputText = '';
  let reasoningText = '';
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let ttftMs: number | null = null;
  let gotFirst = false;

  const stream = ctx.streamChat(
    {
      baseUrl: ctx.runtime.baseUrl,
      apiKey: ctx.apiKey,
      model: candidate.model,
      messages: requestMessages.map((m) => ({ role: m.role, content: m.content })),
      tools: mapped,
      temperature: ctx.candidate.temperature,
      think: think ?? undefined,
      seed: candidate.seed,
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
    if (chunk.toolCalls) {
      for (const tc of chunk.toolCalls) {
        const args = tc.function.arguments;
        toolCalls.push({
          name: tc.function.name,
          arguments: typeof args === 'string' ? safeParseArgs(args) : (args ?? {}),
        });
      }
      break; // first turn only — tools are never executed in tool_call packs
    }
    if (chunk.done) break;
  }
  const totalMs = performance.now() - startedAt;

  return {
    outcome: 'ok',
    outputText,
    reasoningText: reasoningText || undefined,
    toolCalls,
    usage: {},
    timing: {
      ttftMs,
      prefillTps: null,
      decodeTps: null,
      totalMs,
      timingSource: 'client',
      cacheHit: null,
      inputTokens: null,
      outputTokens: null,
      thinkingTokens: null,
    },
    turns: 1,
  };
};

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { _raw: raw };
  } catch {
    throw new Error(`tool call arguments parse_error: ${raw.slice(0, 120)}`);
  }
}

export function registerToolCallSolver(): void {
  registerSolver('tool_call', toolCallSolver);
}
