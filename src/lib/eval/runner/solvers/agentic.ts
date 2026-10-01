import type { AgentEvent, AgentMessage } from '@/lib/agent/types';
import { composeHooks, type AfterToolCallContext, type ShouldStopAfterTurnContext } from '@/lib/agent/hooks';
import { createMessageQueue } from '@/lib/agent/queue';
import { runAgentLoop, type LoopAgentConfig } from '@/lib/agent/loop';
import { buildSystemPromptSections, formatSystemPrompt } from '@/lib/prompt/buildSystemPrompt';
import { loadProjectContextFiles } from '@/lib/skills/contextFiles';
import { scanSkills } from '@/lib/skills/scanner';
import { getBuiltinTools } from '@/lib/tools/registry';
import { truncateOutput } from '@/lib/tools/truncate';
import { resolveThinkValue, type BuiltinToolId } from '@/lib/types/agent';
import { EVAL_TOOLS_ALLOWED } from '../../constants';
import type { EvalMessage, TrialOutcome } from '../../types';
import { createSandbox, destroySandbox, snapshotSandbox } from '../sandbox';
import { sandboxPolicyHooks } from '../sandboxPolicy';
import { registerSolver, type Solver, type SolverContext, type SolverResult } from './index';

const SNAPSHOT_MAX_TEXT_BYTES = 64 * 1024;

function baseTiming(totalMs: number): SolverResult['timing'] {
  return {
    ttftMs: null,
    prefillTps: null,
    decodeTps: null,
    totalMs,
    timingSource: 'client',
    cacheHit: null,
    inputTokens: null,
    outputTokens: null,
    thinkingTokens: null,
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function toAgentMessage(m: EvalMessage): AgentMessage {
  if (m.role === 'system') return { role: 'system', content: m.content };
  if (m.role === 'assistant') return { role: 'assistant', content: m.content, stopReason: 'stop' };
  return { role: 'user', content: m.content };
}

export const agenticSolver: Solver = async (ctx: SolverContext) => {
  const startedAt = performance.now();
  const { pack, sample } = ctx;

  if (!sample.fixture) {
    return {
      outcome: 'skipped_unsupported',
      outputText: 'missing fixture',
      toolCalls: [],
      usage: {},
      timing: baseTiming(performance.now() - startedAt),
      turns: 0,
    };
  }

  const sandboxRoot = await createSandbox(pack.scope, pack.manifest.id, sample.fixture.dir);
  try {
    return await runInSandbox(ctx, sandboxRoot, startedAt);
  } finally {
    await destroySandbox(sandboxRoot).catch(() => undefined);
  }
};

async function runInSandbox(
  ctx: SolverContext,
  sandboxRoot: string,
  startedAt: number,
): Promise<SolverResult> {
  const { candidate, pack, sample } = ctx;

  let initialState: SolverResult['extra'];
  try {
    initialState = { initialState: await snapshotSandbox(sandboxRoot, SNAPSHOT_MAX_TEXT_BYTES) };
  } catch {
    initialState = { initialState: { files: [] } };
  }

  const allowed = new Set<BuiltinToolId>(EVAL_TOOLS_ALLOWED);
  const toolIds = candidate.enabledBuiltinTools.filter((t) => allowed.has(t));
  const tools = getBuiltinTools(toolIds, { workspaceRoot: sandboxRoot });

  const contextFiles: Array<{ path: string; content: string }> = [];
  const skills: Array<{ name: string; description: string; filePath?: string; disableModelInvocation?: boolean }> = [];
  if (pack.manifest.trusted) {
    try {
      const [scanned, loaded] = await Promise.all([
        scanSkills({ workspaceRoot: sandboxRoot }),
        loadProjectContextFiles({ workspaceRoot: sandboxRoot }),
      ]);
      for (const s of scanned.skills) {
        skills.push({
          name: s.name,
          description: s.description,
          filePath: s.filePath,
          disableModelInvocation: s.disableModelInvocation,
        });
      }
      for (const f of loaded) {
        contextFiles.push({ path: f.path, content: f.content });
      }
    } catch {
      // Skill/context discovery is best-effort; run without them on failure.
    }
  }

  const agentSystem = [candidate.systemPrompt, pack.manifest.systemPrompt ?? '']
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('\n\n');
  const sections = buildSystemPromptSections({
    agent: { systemPrompt: agentSystem || undefined },
    tools,
    contextFiles,
    skills,
    cwd: sandboxRoot,
  });
  const systemPrompt = formatSystemPrompt(sections);

  const messages: AgentMessage[] = [];
  for (const m of pack.manifest.fewshot ?? []) {
    messages.push(toAgentMessage(m));
  }
  if (typeof sample.input === 'string') {
    messages.push({ role: 'user', content: sample.input });
  } else {
    for (const m of sample.input) {
      messages.push(toAgentMessage(m));
    }
  }

  const agent: LoopAgentConfig = {
    model: candidate.model,
    systemPrompt,
    temperature: candidate.temperature,
    topP: candidate.topP,
    topK: candidate.topK,
    repeatPenalty: candidate.repeatPenalty,
    frequencyPenalty: candidate.frequencyPenalty,
    presencePenalty: candidate.presencePenalty,
    seed: candidate.seed,
    stopSequences: candidate.stopSequences,
    maxOutputTokens: candidate.maxOutputTokens,
    think: resolveThinkValue(candidate.reasoning, candidate.reasoningEffort),
    provider: candidate.provider,
    apiKey: ctx.apiKey,
    options: candidate.contextSize > 0 ? { num_ctx: candidate.contextSize } : undefined,
  };

  const maxTurns = pack.manifest.defaults.maxTurns;
  let hitMaxTurns = false;
  const policy = sandboxPolicyHooks(sandboxRoot);
  const hooks = composeHooks(
    policy,
    {
      async afterToolCall(tctx: AfterToolCallContext) {
        if (!tctx.result.content) return undefined;
        const res = truncateOutput(tctx.result.content);
        return res.truncated ? { content: res.content } : undefined;
      },
    },
    {
      async shouldStopAfterTurn(tctx: ShouldStopAfterTurnContext) {
        if (tctx.turnIndex >= maxTurns) {
          hitMaxTurns = true;
          return true;
        }
        return false;
      },
    },
  );

  let ttftMs: number | null = null;
  let turns = 0;
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const emit = (e: AgentEvent): void => {
    if (
      ttftMs === null &&
      (e.type === 'message_update' || e.type === 'message_end' || e.type === 'tool_execution_start')
    ) {
      ttftMs = performance.now() - startedAt;
    }
    if (e.type === 'turn_start') turns += 1;
    if (e.type === 'tool_execution_start') {
      toolCalls.push({ name: e.toolName, arguments: toRecord(e.args) });
    }
  };

  const transcript = await runAgentLoop({
    agent,
    messages,
    tools,
    hooks,
    signal: ctx.signal,
    steeringQueue: createMessageQueue(),
    followUpQueue: createMessageQueue(),
    emit,
    baseUrl: ctx.runtime.baseUrl,
    apiKey: ctx.apiKey,
    streamChatFn: ctx.streamChat,
  });

  const assistants = transcript.filter((m) => m.role === 'assistant');
  const last = assistants[assistants.length - 1];
  const outputText = last?.content ?? '';
  const thinking = assistants.map((m) => m.thinking).filter((t): t is string => !!t);
  const reasoningText = thinking.length > 0 ? thinking.join('\n\n') : undefined;

  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;
  for (const m of assistants) {
    if (m.usage) {
      sawUsage = true;
      inputTokens += m.usage.input;
      outputTokens += m.usage.output;
    }
  }

  let outcome: TrialOutcome = 'ok';
  if (ctx.signal.aborted) {
    outcome = 'cancelled';
  } else if (assistants.some((m) => m.stopReason === 'error')) {
    outcome = 'provider_error';
  } else if (hitMaxTurns) {
    outcome = 'max_turns';
  }

  let finalState: SolverResult['finalState'];
  try {
    finalState = await snapshotSandbox(sandboxRoot, SNAPSHOT_MAX_TEXT_BYTES);
  } catch {
    finalState = undefined;
  }

  const totalMs = performance.now() - startedAt;
  return {
    outcome,
    outputText,
    reasoningText,
    toolCalls,
    transcript,
    finalState,
    extra: {
      ...(initialState ?? {}),
      blockedToolCalls: policy.blockedToolCalls.count,
    },
    usage: sawUsage ? { input: inputTokens, output: outputTokens } : {},
    timing: {
      ...baseTiming(totalMs),
      ttftMs,
      inputTokens: sawUsage ? inputTokens : null,
      outputTokens: sawUsage ? outputTokens : null,
    },
    turns,
  };
}

export function registerAgenticSolver(): void {
  registerSolver('agentic', agenticSolver);
}
