import { getGlobalDatabase, type SqlDatabase } from '@/lib/db/client';
import type {
  Agent,
  ApprovalMode,
  BuiltinToolId,
  LlmProviderKind,
  ReasoningEffort,
  ReasoningMode,
} from '@/lib/types/agent';
import {
  DEFAULT_AUTO_MONITOR,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_REASONING_MODE,
} from '@/lib/types/agent';

interface AgentRow {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model: string;
  temperature: number;
  context_size: number;
  reserve_tokens: number;
  keep_recent_tokens: number;
  enabled_skills: string;
  enabled_builtin_tools: string;
  approval_mode: ApprovalMode;
  reasoning: ReasoningMode | null;
  reasoning_effort: ReasoningEffort | null;
  top_p: number | null;
  top_k: number | null;
  repeat_penalty: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  seed: number | null;
  stop_sequences: string | null;
  max_output_tokens: number | null;
  llm_provider: LlmProviderKind | null;
  llm_base_url: string | null;
  llm_api_key: string | null;
  auto_monitor: number | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

function parseStopSequences(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const stops = parsed.filter((s): s is string => typeof s === 'string');
      return stops.length > 0 ? stops : undefined;
    }
  } catch {
    // 구 행의 비정상 값은 자동(미지정)으로 해석
  }
  return undefined;
}

function parseAgentRow(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    systemPrompt: row.system_prompt,
    model: row.model,
    temperature: row.temperature,
    contextSize: row.context_size,
    reserveTokens: row.reserve_tokens,
    keepRecentTokens: row.keep_recent_tokens,
    enabledSkills: JSON.parse(row.enabled_skills || '[]') as string[],
    enabledBuiltinTools: JSON.parse(
      row.enabled_builtin_tools || '[]',
    ) as BuiltinToolId[],
    approvalMode: row.approval_mode,
    // 구 DB 행(컬럼 없음 → null/undefined)은 모델 기본값으로 해석
    reasoning: row.reasoning ?? DEFAULT_REASONING_MODE,
    reasoningEffort: row.reasoning_effort ?? DEFAULT_REASONING_EFFORT,
    // 생성 파라미터: NULL/누락 → 자동(undefined)
    topP: row.top_p ?? undefined,
    topK: row.top_k ?? undefined,
    repeatPenalty: row.repeat_penalty ?? undefined,
    frequencyPenalty: row.frequency_penalty ?? undefined,
    presencePenalty: row.presence_penalty ?? undefined,
    seed: row.seed ?? undefined,
    stopSequences: parseStopSequences(row.stop_sequences),
    maxOutputTokens: row.max_output_tokens ?? undefined,
    // Provider 미지정 구 행은 Ollama로 해석 (기존 동작 유지)
    llmProvider: row.llm_provider ?? 'ollama',
    llmBaseUrl: row.llm_base_url ?? undefined,
    llmApiKey: row.llm_api_key ?? undefined,
    // 자동 모니터링 미지정 구 행은 켜짐으로 해석 (기본 on)
    autoMonitor: row.auto_monitor == null ? DEFAULT_AUTO_MONITOR : row.auto_monitor === 1,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAgents(dbOverride?: SqlDatabase): Promise<Agent[]> {
  const db = dbOverride ?? (await getGlobalDatabase());
  const rows = await db.select<AgentRow[]>(
    'SELECT * FROM agents ORDER BY created_at ASC',
  );
  return rows.map(parseAgentRow);
}

export async function getAgent(
  id: string,
  dbOverride?: SqlDatabase,
): Promise<Agent | null> {
  const db = dbOverride ?? (await getGlobalDatabase());
  const rows = await db.select<AgentRow[]>(
    'SELECT * FROM agents WHERE id = ?',
    [id],
  );
  if (rows.length === 0) return null;
  return parseAgentRow(rows[0]);
}

export async function getDefaultAgent(
  dbOverride?: SqlDatabase,
): Promise<Agent | null> {
  const db = dbOverride ?? (await getGlobalDatabase());
  const rows = await db.select<AgentRow[]>(
    'SELECT * FROM agents WHERE is_default = 1 LIMIT 1',
  );
  if (rows.length === 0) return null;
  return parseAgentRow(rows[0]);
}

export async function createAgent(
  agent: Omit<Agent, 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  },
  dbOverride?: SqlDatabase,
): Promise<Agent> {
  const db = dbOverride ?? (await getGlobalDatabase());
  const now = new Date().toISOString();
  const createdAt = agent.createdAt || now;
  const updatedAt = agent.updatedAt || now;

  // Check how many agents currently exist
  const countRows = await db.select<{ count: number }[]>(
    'SELECT COUNT(*) as count FROM agents',
  );
  const existingCount = countRows[0]?.count ?? 0;

  // First agent is automatically default; or if agent explicitly requested default
  let shouldBeDefault = agent.isDefault;
  if (existingCount === 0) {
    shouldBeDefault = true;
  }

  if (shouldBeDefault) {
    await db.execute('UPDATE agents SET is_default = 0');
  }

  await db.execute(
    `INSERT INTO agents (
      id, name, description, system_prompt, model, temperature,
      context_size, reserve_tokens, keep_recent_tokens,
      enabled_skills, enabled_builtin_tools, approval_mode,
      reasoning, reasoning_effort,
      top_p, top_k, repeat_penalty, frequency_penalty, presence_penalty,
      seed, stop_sequences, max_output_tokens,
      llm_provider, llm_base_url, llm_api_key, auto_monitor,
      is_default, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      agent.id,
      agent.name,
      agent.description ?? null,
      agent.systemPrompt,
      agent.model,
      agent.temperature,
      agent.contextSize,
      agent.reserveTokens,
      agent.keepRecentTokens,
      JSON.stringify(agent.enabledSkills),
      JSON.stringify(agent.enabledBuiltinTools),
      agent.approvalMode,
      agent.reasoning ?? DEFAULT_REASONING_MODE,
      agent.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
      agent.topP ?? null,
      agent.topK ?? null,
      agent.repeatPenalty ?? null,
      agent.frequencyPenalty ?? null,
      agent.presencePenalty ?? null,
      agent.seed ?? null,
      JSON.stringify(agent.stopSequences ?? []),
      agent.maxOutputTokens ?? null,
      agent.llmProvider ?? 'ollama',
      agent.llmBaseUrl ?? null,
      agent.llmApiKey ?? null,
      (agent.autoMonitor ?? DEFAULT_AUTO_MONITOR) ? 1 : 0,
      shouldBeDefault ? 1 : 0,
      createdAt,
      updatedAt,
    ],
  );

  return {
    ...agent,
    reasoning: agent.reasoning ?? DEFAULT_REASONING_MODE,
    reasoningEffort: agent.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    llmProvider: agent.llmProvider ?? 'ollama',
    llmBaseUrl: agent.llmBaseUrl ?? undefined,
    llmApiKey: agent.llmApiKey ?? undefined,
    autoMonitor: agent.autoMonitor ?? DEFAULT_AUTO_MONITOR,
    isDefault: shouldBeDefault,
    createdAt,
    updatedAt,
  };
}

export async function updateAgent(
  id: string,
  updates: Partial<Omit<Agent, 'id' | 'createdAt'>>,
  dbOverride?: SqlDatabase,
): Promise<Agent> {
  const db = dbOverride ?? (await getGlobalDatabase());
  const existing = await getAgent(id, db);
  if (!existing) {
    throw new Error(`Agent with id "${id}" not found.`);
  }

  const now = new Date().toISOString();
  let nextIsDefault = updates.isDefault ?? existing.isDefault;

  // If setting this agent as default, unset others
  if (updates.isDefault === true) {
    await db.execute('UPDATE agents SET is_default = 0 WHERE id != ?', [id]);
    nextIsDefault = true;
  } else if (updates.isDefault === false && existing.isDefault) {
    // Cannot unset default if it's the only agent or without promoting another
    // But if there are other agents, promote the first one
    const otherRows = await db.select<{ id: string }[]>(
      'SELECT id FROM agents WHERE id != ? ORDER BY created_at ASC LIMIT 1',
      [id],
    );
    if (otherRows.length > 0) {
      await db.execute('UPDATE agents SET is_default = 1 WHERE id = ?', [
        otherRows[0].id,
      ]);
      nextIsDefault = false;
    } else {
      nextIsDefault = true; // Still must be default if only 1 agent
    }
  }

  const merged: Agent = {
    ...existing,
    ...updates,
    isDefault: nextIsDefault,
    updatedAt: now,
  };

  await db.execute(
    `UPDATE agents SET
      name = ?, description = ?, system_prompt = ?, model = ?,
      temperature = ?, context_size = ?, reserve_tokens = ?,
      keep_recent_tokens = ?, enabled_skills = ?,
      enabled_builtin_tools = ?, approval_mode = ?,
      reasoning = ?, reasoning_effort = ?,
      top_p = ?, top_k = ?, repeat_penalty = ?, frequency_penalty = ?,
      presence_penalty = ?, seed = ?, stop_sequences = ?, max_output_tokens = ?,
      llm_provider = ?, llm_base_url = ?, llm_api_key = ?, auto_monitor = ?,
      is_default = ?, updated_at = ?
    WHERE id = ?`,
    [
      merged.name,
      merged.description ?? null,
      merged.systemPrompt,
      merged.model,
      merged.temperature,
      merged.contextSize,
      merged.reserveTokens,
      merged.keepRecentTokens,
      JSON.stringify(merged.enabledSkills),
      JSON.stringify(merged.enabledBuiltinTools),
      merged.approvalMode,
      merged.reasoning ?? DEFAULT_REASONING_MODE,
      merged.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
      merged.topP ?? null,
      merged.topK ?? null,
      merged.repeatPenalty ?? null,
      merged.frequencyPenalty ?? null,
      merged.presencePenalty ?? null,
      merged.seed ?? null,
      JSON.stringify(merged.stopSequences ?? []),
      merged.maxOutputTokens ?? null,
      merged.llmProvider ?? 'ollama',
      merged.llmBaseUrl ?? null,
      merged.llmApiKey ?? null,
      (merged.autoMonitor ?? DEFAULT_AUTO_MONITOR) ? 1 : 0,
      merged.isDefault ? 1 : 0,
      merged.updatedAt,
      id,
    ],
  );

  return merged;
}

export async function deleteAgent(
  id: string,
  dbOverride?: SqlDatabase,
): Promise<void> {
  const db = dbOverride ?? (await getGlobalDatabase());
  const existing = await getAgent(id, db);
  if (!existing) return;

  await db.execute('DELETE FROM agents WHERE id = ?', [id]);

  // If the deleted agent was default, promote the next agent
  if (existing.isDefault) {
    const nextRows = await db.select<{ id: string }[]>(
      'SELECT id FROM agents ORDER BY created_at ASC LIMIT 1',
    );
    if (nextRows.length > 0) {
      await db.execute('UPDATE agents SET is_default = 1 WHERE id = ?', [
        nextRows[0].id,
      ]);
    }
  }
}
