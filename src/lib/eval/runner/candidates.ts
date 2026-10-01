import type {
  Agent,
  BuiltinToolId,
  ReasoningEffort,
  ReasoningMode,
} from '@/lib/types/agent';
import { EVAL_TOOLS_ALLOWED } from '../constants';
import { getProviderPreset } from '@/lib/llm/providers';
import type { CandidateSnapshot } from '../types';

export interface MatrixAxes {
  model?: string[];
  contextSize?: number[];
  temperature?: number[];
  reasoning?: Array<'off' | 'on:low' | 'on:medium' | 'on:high' | 'default'>;
  topP?: number[];
  maxOutputTokens?: number[];
}

function labelFor(base: Agent, sweep: Record<string, string | number>): string {
  const parts = [base.name];
  if (typeof sweep.model === 'string') parts.push(sweep.model);
  if (typeof sweep.contextSize === 'number') parts.push(`ctx${Math.round(sweep.contextSize / 1024)}k`);
  if (typeof sweep.temperature === 'number') parts.push(`T${sweep.temperature}`);
  if (typeof sweep.reasoning === 'string' && sweep.reasoning !== 'default') {
    parts.push(sweep.reasoning === 'off' ? 'no-think' : String(sweep.reasoning));
  }
  return parts.join(' · ');
}

export function candidateFromAgent(
  agent: Agent,
  overrides: {
    sweep?: Record<string, string | number>;
    label?: string;
    contextSize?: number;
  } = {},
): CandidateSnapshot {
  const sweep = overrides.sweep;
  const reasoningRaw = sweep?.reasoning;
  let reasoning: ReasoningMode = agent.reasoning ?? 'default';
  let reasoningEffort: ReasoningEffort = agent.reasoningEffort ?? 'medium';
  if (typeof reasoningRaw === 'string') {
    if (reasoningRaw === 'off' || reasoningRaw === 'default') {
      reasoning = reasoningRaw;
    } else if (reasoningRaw.startsWith('on:')) {
      reasoning = 'on';
      const level = reasoningRaw.slice(3);
      if (level === 'low' || level === 'medium' || level === 'high') reasoningEffort = level;
    }
  }
  const provider = agent.llmProvider ?? 'ollama';
  const baseUrl = agent.llmBaseUrl ?? getProviderPreset(provider).defaultBaseUrl;
  const enabledBuiltinTools = (agent.enabledBuiltinTools ?? []).filter(
    (t): t is BuiltinToolId => (EVAL_TOOLS_ALLOWED as BuiltinToolId[]).includes(t),
  );
  return {
    label: overrides.label ?? labelFor(agent, sweep ?? {}),
    sourceAgentId: agent.id,
    provider,
    baseUrl,
    endpointClass: 'local',
    model: typeof sweep?.model === 'string' ? sweep.model : agent.model,
    systemPrompt: agent.systemPrompt,
    temperature: typeof sweep?.temperature === 'number' ? sweep.temperature : agent.temperature,
    topP: agent.topP,
    topK: agent.topK,
    repeatPenalty: agent.repeatPenalty,
    frequencyPenalty: agent.frequencyPenalty,
    presencePenalty: agent.presencePenalty,
    seed: agent.seed,
    stopSequences: agent.stopSequences,
    maxOutputTokens:
      typeof sweep?.maxOutputTokens === 'number' ? sweep.maxOutputTokens : agent.maxOutputTokens,
    reasoning,
    reasoningEffort,
    contextSize: overrides.contextSize ?? agent.contextSize,
    reserveTokens: agent.reserveTokens,
    keepRecentTokens: agent.keepRecentTokens,
    enabledBuiltinTools,
    enabledSkills: [...(agent.enabledSkills ?? [])],
    ...(sweep ? { sweep } : {}),
  };
}

export function expandMatrix(base: Agent, axes: MatrixAxes): CandidateSnapshot[] {
  const dims: Array<{ key: string; values: Array<string | number> }> = [];
  if (axes.model && axes.model.length > 0) dims.push({ key: 'model', values: axes.model });
  if (axes.contextSize && axes.contextSize.length > 0) dims.push({ key: 'contextSize', values: axes.contextSize });
  if (axes.temperature && axes.temperature.length > 0) dims.push({ key: 'temperature', values: axes.temperature });
  if (axes.reasoning && axes.reasoning.length > 0) dims.push({ key: 'reasoning', values: axes.reasoning });
  if (axes.topP && axes.topP.length > 0) dims.push({ key: 'topP', values: axes.topP });
  if (axes.maxOutputTokens && axes.maxOutputTokens.length > 0) {
    dims.push({ key: 'maxOutputTokens', values: axes.maxOutputTokens });
  }
  const combos: Array<Record<string, string | number>> = [{}];
  for (const dim of dims) {
    const next: Array<Record<string, string | number>> = [];
    for (const combo of combos) {
      for (const value of dim.values) {
        next.push({ ...combo, [dim.key]: value });
      }
    }
    combos.length = 0;
    combos.push(...next);
  }
  if (combos.length > 24) {
    throw new Error(`Matrix has ${combos.length} combinations, limit is 24`);
  }
  return combos.map((sweep) => {
    const snapshot = candidateFromAgent(base, { sweep });
    if (typeof sweep.topP === 'number') snapshot.topP = sweep.topP;
    return snapshot;
  });
}
