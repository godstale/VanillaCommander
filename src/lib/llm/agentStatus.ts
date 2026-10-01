import type { Agent, AgentConnectionStatus, LlmProviderKind } from '@/lib/types/agent';
import { listModels, showModel, type OllamaModel } from './ollamaClient';
import { listModels as listOpenAiModels } from './openAiCompatibleClient';
import { getProviderPreset } from './providers';

/**
 * Checks if a candidate model tag matches a target model name.
 * Handles cases where ':latest' might be omitted or included.
 */
export function isModelMatching(candidate: string, target: string): boolean {
  if (!candidate || !target) return false;
  if (candidate.toLowerCase() === target.toLowerCase()) return true;

  const normalize = (m: string) => (m.endsWith(':latest') ? m.slice(0, -7) : m);
  return normalize(candidate).toLowerCase() === normalize(target).toLowerCase();
}

function resolveRuntime(agent: Agent, baseUrl?: string): {
  kind: LlmProviderKind;
  baseUrl: string;
  apiKey?: string;
} {
  const kind = agent.llmProvider ?? 'ollama';
  const preset = getProviderPreset(kind);
  const rawBase = (agent.llmBaseUrl ?? baseUrl ?? '').trim();
  return {
    kind,
    baseUrl: rawBase || preset.defaultBaseUrl,
    apiKey: (agent.llmApiKey ?? '').trim() || undefined,
  };
}

/**
 * Check connection status of a single agent (Provider-aware).
 */
export async function checkAgentConnection(
  agent: Agent,
  baseUrl?: string,
): Promise<'connected' | 'disconnected'> {
  const runtime = resolveRuntime(agent, baseUrl);
  try {
    if (runtime.kind !== 'ollama') {
      // OpenAI 호환 규격은 모델 ID 목록만 제공하므로 목록 기준으로 판단한다.
      // 목록 조회 자체가 성공하고 모델이 있으면 connected.
      const models = await listOpenAiModels(runtime.baseUrl, runtime.apiKey);
      return models.some((m) => isModelMatching(m.id, agent.model))
        ? 'connected'
        : 'disconnected';
    }
    // 1. Try listing models first to see if Ollama is accessible
    const models = await listModels(runtime.baseUrl);
    const found = models.some((m) => isModelMatching(m.name, agent.model));
    if (found) {
      return 'connected';
    }

    // 2. If not found in list, attempt showModel directly (e.g. for custom tags or newly pulled)
    await showModel(runtime.baseUrl, agent.model);
    return 'connected';
  } catch {
    return 'disconnected';
  }
}

/**
 * Check connection status for multiple agents efficiently.
 * Fetches the model list once per unique (baseUrl, kind) and evaluates all agents.
 */
export async function checkAllAgentsConnection(
  agents: Agent[],
  baseUrl?: string,
): Promise<Record<string, AgentConnectionStatus>> {
  const result: Record<string, AgentConnectionStatus> = {};

  if (agents.length === 0) {
    return result;
  }

  // Provider/URL별로 그룹화해 목록 조회를 1회씩만 수행한다
  const groups = new Map<string, { kind: LlmProviderKind; baseUrl: string; apiKey?: string; ids: string[] }>();
  for (const agent of agents) {
    const runtime = resolveRuntime(agent, baseUrl);
    const key = `${runtime.kind}::${runtime.baseUrl}::${runtime.apiKey ?? ''}`;
    const g = groups.get(key);
    if (g) {
      g.ids.push(agent.id);
    } else {
      groups.set(key, { kind: runtime.kind, baseUrl: runtime.baseUrl, apiKey: runtime.apiKey, ids: [agent.id] });
    }
  }

  const byId = new Map(agents.map((a) => [a.id, a]));

  for (const g of groups.values()) {
    if (g.kind !== 'ollama') {
      let models: { id: string }[];
      try {
        models = await listOpenAiModels(g.baseUrl, g.apiKey);
      } catch {
        for (const id of g.ids) result[id] = 'disconnected';
        continue;
      }
      for (const id of g.ids) {
        const agent = byId.get(id);
        result[id] =
          agent && models.some((m) => isModelMatching(m.id, agent.model))
            ? 'connected'
            : 'disconnected';
      }
      continue;
    }

    let models: OllamaModel[];
    try {
      models = await listModels(g.baseUrl);
    } catch {
      // Ollama is offline or unreachable - all agents are disconnected
      for (const id of g.ids) {
        result[id] = 'disconnected';
      }
      continue;
    }

    // Check each agent against the retrieved models
    const pendingChecks: Promise<void>[] = [];

    for (const id of g.ids) {
      const agent = byId.get(id);
      if (!agent) continue;
      const matched = models.some((m) => isModelMatching(m.name, agent.model));
      if (matched) {
        result[id] = 'connected';
      } else {
        // If not directly found in the tags list, fallback to showModel
        pendingChecks.push(
          showModel(g.baseUrl, agent.model)
            .then(() => {
              result[id] = 'connected';
            })
            .catch(() => {
              result[id] = 'disconnected';
            }),
        );
      }
    }

    if (pendingChecks.length > 0) {
      await Promise.all(pendingChecks);
    }
  }

  return result;
}
