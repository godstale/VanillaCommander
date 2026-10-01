import { describe, it, expect, beforeEach } from 'vitest';
import type { SqlDatabase } from '@/lib/db/client';
import * as entriesRepo from './entriesRepo';
import * as agentsRepo from './agentsRepo';
import * as sessionsRepo from './sessionsRepo';
import * as settingsRepo from './settingsRepo';
import type { CompactionEntry, MessageEntry } from '@/lib/types/chat';

interface AgentRowMock {
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
  approval_mode: string;
  reasoning: string | null;
  reasoning_effort: string | null;
  top_p: number | null;
  top_k: number | null;
  repeat_penalty: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  seed: number | null;
  stop_sequences: string;
  max_output_tokens: number | null;
  llm_provider: string | null;
  llm_base_url: string | null;
  llm_api_key: string | null;
  auto_monitor?: number | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

interface SessionRowMock {
  id: string;
  agent_id: string;
  workspace_root: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

interface EntryRowMock {
  id: string;
  session_id: string;
  parent_id: string | null;
  seq: number;
  type: string;
  payload: string;
  created_at: string;
}

interface AppSettingsRowMock {
  id: string;
  open_tabs: string;
  active_tab_id: string | null;
  theme: string;
  language: string;
  ollama_base_url: string;
  default_context_size: number;
  default_approval_mode: string;
  trusted_workspaces: string;
  last_workspace_root: string | null;
  monitoring_interval_ms?: number | null;
}

class MemorySqlDatabase implements SqlDatabase {
  agents: Map<string, AgentRowMock> = new Map();
  sessions: Map<string, SessionRowMock> = new Map();
  entries: EntryRowMock[] = [];
  app_settings: AppSettingsRowMock[] = [];

  async execute(
    query: string,
    bindValues: unknown[] = [],
  ): Promise<{ rowsAffected: number; lastInsertId?: number }> {
    const q = query.trim();

    if (q.startsWith('CREATE TABLE') || q.startsWith('CREATE UNIQUE INDEX')) {
      return { rowsAffected: 0 };
    }

    if (
      q.startsWith('INSERT INTO agents') ||
      q.startsWith('INSERT OR IGNORE INTO agents')
    ) {
      const [
        id,
        name,
        description,
        system_prompt,
        model,
        temperature,
        context_size,
        reserve_tokens,
        keep_recent_tokens,
        enabled_skills,
        enabled_builtin_tools,
        approval_mode,
        reasoning,
        reasoning_effort,
        ...rest
      ] = bindValues;
      // 신규 스키마(29개): [..., top_p, top_k, repeat_penalty, frequency_penalty,
      //   presence_penalty, seed, stop_sequences, max_output_tokens,
      //   llm_provider, llm_base_url, llm_api_key, auto_monitor, is_default, created_at, updated_at]
      // 이전 스키마(28개): auto_monitor 없음 → 켜짐(1)으로 해석
      // 과도기 스키마(20개): [..., llm_provider, llm_base_url, llm_api_key, is_default, created_at, updated_at]
      // 구 스키마(17개): [..., is_default, created_at, updated_at]
      let top_p: unknown = null;
      let top_k: unknown = null;
      let repeat_penalty: unknown = null;
      let frequency_penalty: unknown = null;
      let presence_penalty: unknown = null;
      let seed: unknown = null;
      let stop_sequences: unknown = '[]';
      let max_output_tokens: unknown = null;
      let llm_provider: unknown = 'ollama';
      let llm_base_url: unknown = null;
      let llm_api_key: unknown = null;
      let auto_monitor: unknown = 1;
      let is_default: unknown;
      let created_at: unknown;
      let updated_at: unknown;
      if (rest.length >= 15) {
        [
          top_p,
          top_k,
          repeat_penalty,
          frequency_penalty,
          presence_penalty,
          seed,
          stop_sequences,
          max_output_tokens,
          llm_provider,
          llm_base_url,
          llm_api_key,
          auto_monitor,
          is_default,
          created_at,
          updated_at,
        ] = rest;
      } else if (rest.length >= 14) {
        [
          top_p,
          top_k,
          repeat_penalty,
          frequency_penalty,
          presence_penalty,
          seed,
          stop_sequences,
          max_output_tokens,
          llm_provider,
          llm_base_url,
          llm_api_key,
          is_default,
          created_at,
          updated_at,
        ] = rest;
      } else if (rest.length >= 6) {
        [llm_provider, llm_base_url, llm_api_key, is_default, created_at, updated_at] = rest;
      } else {
        [is_default, created_at, updated_at] = rest;
      }
      this.agents.set(id as string, {
        id: id as string,
        name: name as string,
        description: (description as string) ?? null,
        system_prompt: system_prompt as string,
        model: model as string,
        temperature: temperature as number,
        context_size: context_size as number,
        reserve_tokens: reserve_tokens as number,
        keep_recent_tokens: keep_recent_tokens as number,
        enabled_skills: enabled_skills as string,
        enabled_builtin_tools: enabled_builtin_tools as string,
        approval_mode: approval_mode as string,
        reasoning: (reasoning as string) ?? null,
        reasoning_effort: (reasoning_effort as string) ?? null,
        top_p: top_p as number | null,
        top_k: top_k as number | null,
        repeat_penalty: repeat_penalty as number | null,
        frequency_penalty: frequency_penalty as number | null,
        presence_penalty: presence_penalty as number | null,
        seed: seed as number | null,
        stop_sequences: stop_sequences as string,
        max_output_tokens: max_output_tokens as number | null,
        llm_provider: (llm_provider as string) ?? null,
        llm_base_url: (llm_base_url as string) ?? null,
        llm_api_key: (llm_api_key as string) ?? null,
        auto_monitor: auto_monitor as number | null,
        is_default: is_default as number,
        created_at: created_at as string,
        updated_at: updated_at as string,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE agents SET is_default = 0 WHERE id != ?')) {
      const [excludeId] = bindValues;
      for (const [k, a] of this.agents) {
        if (k !== excludeId) a.is_default = 0;
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE agents SET is_default = 0')) {
      for (const a of this.agents.values()) {
        a.is_default = 0;
      }
      return { rowsAffected: this.agents.size };
    }

    if (q.startsWith('UPDATE agents SET is_default = 1 WHERE id = ?')) {
      const [targetId] = bindValues;
      const target = this.agents.get(targetId as string);
      if (target) target.is_default = 1;
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE agents SET')) {
      const [
        name,
        description,
        system_prompt,
        model,
        temperature,
        context_size,
        reserve_tokens,
        keep_recent_tokens,
        enabled_skills,
        enabled_builtin_tools,
        approval_mode,
        reasoning,
        reasoning_effort,
        ...rest
      ] = bindValues;
      // 신규 스키마: [..., top_p, top_k, repeat_penalty, frequency_penalty,
      //   presence_penalty, seed, stop_sequences, max_output_tokens,
      //   llm_provider, llm_base_url, llm_api_key, auto_monitor, is_default, updated_at, id]
      // 이전 스키마: auto_monitor 없음
      // 과도기 스키마: [..., llm_provider, llm_base_url, llm_api_key, is_default, updated_at, id]
      // 구 스키마: [..., is_default, updated_at, id]
      let top_p: unknown;
      let top_k: unknown;
      let repeat_penalty: unknown;
      let frequency_penalty: unknown;
      let presence_penalty: unknown;
      let seed: unknown;
      let stop_sequences: unknown;
      let max_output_tokens: unknown;
      let llm_provider: unknown;
      let llm_base_url: unknown;
      let llm_api_key: unknown;
      let auto_monitor: unknown;
      let is_default: unknown;
      let updated_at: unknown;
      let id: unknown;
      if (rest.length >= 15) {
        [
          top_p,
          top_k,
          repeat_penalty,
          frequency_penalty,
          presence_penalty,
          seed,
          stop_sequences,
          max_output_tokens,
          llm_provider,
          llm_base_url,
          llm_api_key,
          auto_monitor,
          is_default,
          updated_at,
          id,
        ] = rest;
      } else if (rest.length >= 14) {
        [
          top_p,
          top_k,
          repeat_penalty,
          frequency_penalty,
          presence_penalty,
          seed,
          stop_sequences,
          max_output_tokens,
          llm_provider,
          llm_base_url,
          llm_api_key,
          is_default,
          updated_at,
          id,
        ] = rest;
      } else if (rest.length >= 6) {
        [llm_provider, llm_base_url, llm_api_key, is_default, updated_at, id] = rest;
      } else {
        [is_default, updated_at, id] = rest;
      }
      const existing = this.agents.get(id as string);
      if (existing) {
        Object.assign(existing, {
          name: name as string,
          description: (description as string) ?? null,
          system_prompt: system_prompt as string,
          model: model as string,
          temperature: temperature as number,
          context_size: context_size as number,
          reserve_tokens: reserve_tokens as number,
          keep_recent_tokens: keep_recent_tokens as number,
          enabled_skills: enabled_skills as string,
          enabled_builtin_tools: enabled_builtin_tools as string,
          approval_mode: approval_mode as string,
          reasoning: reasoning as string,
          reasoning_effort: reasoning_effort as string,
          ...(top_p !== undefined ? { top_p: top_p as number | null } : {}),
          ...(top_k !== undefined ? { top_k: top_k as number | null } : {}),
          ...(repeat_penalty !== undefined
            ? { repeat_penalty: repeat_penalty as number | null }
            : {}),
          ...(frequency_penalty !== undefined
            ? { frequency_penalty: frequency_penalty as number | null }
            : {}),
          ...(presence_penalty !== undefined
            ? { presence_penalty: presence_penalty as number | null }
            : {}),
          ...(seed !== undefined ? { seed: seed as number | null } : {}),
          ...(stop_sequences !== undefined
            ? { stop_sequences: stop_sequences as string }
            : {}),
          ...(max_output_tokens !== undefined
            ? { max_output_tokens: max_output_tokens as number | null }
            : {}),
          ...(llm_provider !== undefined ? { llm_provider: llm_provider as string } : {}),
          ...(llm_base_url !== undefined ? { llm_base_url: (llm_base_url as string) ?? null } : {}),
          ...(llm_api_key !== undefined ? { llm_api_key: (llm_api_key as string) ?? null } : {}),
          ...(auto_monitor !== undefined ? { auto_monitor: auto_monitor as number | null } : {}),
          is_default: is_default as number,
          updated_at: updated_at as string,
        });
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM agents WHERE id = ?')) {
      const [id] = bindValues;
      this.agents.delete(id as string);
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO sessions')) {
      const [id, agent_id, workspace_root, title, created_at, updated_at] =
        bindValues;
      this.sessions.set(id as string, {
        id: id as string,
        agent_id: agent_id as string,
        workspace_root: (workspace_root as string) ?? null,
        title: title as string,
        created_at: created_at as string,
        updated_at: updated_at as string,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE sessions SET')) {
      const [agent_id, workspace_root, title, updated_at, id] = bindValues;
      const existing = this.sessions.get(id as string);
      if (existing) {
        Object.assign(existing, {
          agent_id: agent_id as string,
          workspace_root: (workspace_root as string) ?? null,
          title: title as string,
          updated_at: updated_at as string,
        });
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM sessions WHERE id = ?')) {
      const [id] = bindValues;
      this.sessions.delete(id as string);
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO entries')) {
      const [id, session_id, parent_id, seq, type, payload, created_at] =
        bindValues;
      this.entries.push({
        id: id as string,
        session_id: session_id as string,
        parent_id: (parent_id as string) ?? null,
        seq: seq as number,
        type: type as string,
        payload: payload as string,
        created_at: created_at as string,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM entries WHERE session_id = ?')) {
      const [sessionId] = bindValues;
      this.entries = this.entries.filter((e) => e.session_id !== sessionId);
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO app_settings')) {
      const [
        id,
        open_tabs,
        active_tab_id,
        theme,
        language,
        ollama_base_url,
        default_context_size,
        default_approval_mode,
        trusted_workspaces,
        last_workspace_root,
        monitoring_interval_ms,
      ] = bindValues;
      this.app_settings.push({
        id: id as string,
        open_tabs: open_tabs as string,
        active_tab_id: (active_tab_id as string) ?? null,
        theme: theme as string,
        language: language as string,
        ollama_base_url: ollama_base_url as string,
        default_context_size: default_context_size as number,
        default_approval_mode: default_approval_mode as string,
        trusted_workspaces: trusted_workspaces as string,
        last_workspace_root: (last_workspace_root as string) ?? null,
        monitoring_interval_ms: (monitoring_interval_ms as number) ?? 1000,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE app_settings SET')) {
      const [
        open_tabs,
        active_tab_id,
        theme,
        language,
        ollama_base_url,
        default_context_size,
        default_approval_mode,
        trusted_workspaces,
        last_workspace_root,
        monitoring_interval_ms,
      ] = bindValues;
      if (this.app_settings.length > 0) {
        Object.assign(this.app_settings[0], {
          open_tabs: open_tabs as string,
          active_tab_id: (active_tab_id as string) ?? null,
          theme: theme as string,
          language: language as string,
          ollama_base_url: ollama_base_url as string,
          default_context_size: default_context_size as number,
          default_approval_mode: default_approval_mode as string,
          trusted_workspaces: trusted_workspaces as string,
          last_workspace_root: (last_workspace_root as string) ?? null,
          ...(monitoring_interval_ms !== undefined
            ? { monitoring_interval_ms: monitoring_interval_ms as number }
            : {}),
        });
      }
      return { rowsAffected: 1 };
    }

    throw new Error(`Unhandled execute query: ${q}`);
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    const q = query.trim();

    if (q.startsWith('SELECT COUNT(*) as count FROM agents')) {
      return [{ count: this.agents.size }] as unknown as T;
    }

    if (q.startsWith('SELECT * FROM agents WHERE is_default = 1')) {
      const found = Array.from(this.agents.values()).find(
        (a) => a.is_default === 1,
      );
      return (found ? [found] : []) as unknown as T;
    }

    if (q.startsWith('SELECT * FROM agents WHERE id = ?')) {
      const [id] = bindValues;
      const found = this.agents.get(id as string);
      return (found ? [found] : []) as unknown as T;
    }

    if (
      q.startsWith(
        'SELECT id FROM agents WHERE id != ? ORDER BY created_at ASC LIMIT 1',
      )
    ) {
      const [excludeId] = bindValues;
      const sorted = Array.from(this.agents.values())
        .filter((a) => a.id !== excludeId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      return (sorted.length > 0 ? [{ id: sorted[0].id }] : []) as unknown as T;
    }

    if (q.startsWith('SELECT id FROM agents ORDER BY created_at ASC LIMIT 1')) {
      const sorted = Array.from(this.agents.values()).sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
      return (sorted.length > 0 ? [{ id: sorted[0].id }] : []) as unknown as T;
    }

    if (q.startsWith('SELECT * FROM agents ORDER BY created_at ASC')) {
      const sorted = Array.from(this.agents.values()).sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
      return sorted as unknown as T;
    }

    if (q.startsWith('SELECT * FROM sessions ORDER BY updated_at DESC')) {
      const sorted = Array.from(this.sessions.values()).sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      );
      return sorted as unknown as T;
    }

    if (q.startsWith('SELECT * FROM sessions WHERE id = ?')) {
      const [id] = bindValues;
      const found = this.sessions.get(id as string);
      return (found ? [found] : []) as unknown as T;
    }

    if (
      q.startsWith(
        'SELECT MAX(seq) as max_seq FROM entries WHERE session_id = ?',
      )
    ) {
      const [sessionId] = bindValues;
      const sessionEntries = this.entries.filter(
        (e) => e.session_id === sessionId,
      );
      const maxSeq =
        sessionEntries.length > 0
          ? Math.max(...sessionEntries.map((e) => e.seq))
          : null;
      return [{ max_seq: maxSeq }] as unknown as T;
    }

    if (
      q.includes(
        "WHERE session_id = ? AND type = 'compaction' ORDER BY seq DESC LIMIT 1",
      )
    ) {
      const [sessionId] = bindValues;
      const compactions = this.entries
        .filter((e) => e.session_id === sessionId && e.type === 'compaction')
        .sort((a, b) => b.seq - a.seq);
      return (compactions.length > 0 ? [compactions[0]] : []) as unknown as T;
    }

    if (
      q.startsWith(
        'SELECT id, session_id, parent_id, seq, type, payload, created_at FROM entries WHERE session_id = ? ORDER BY seq ASC',
      )
    ) {
      const [sessionId] = bindValues;
      const sessionEntries = this.entries
        .filter((e) => e.session_id === sessionId)
        .sort((a, b) => a.seq - b.seq);
      return sessionEntries as unknown as T;
    }

    if (q.startsWith('SELECT id FROM agents WHERE id = ?')) {
      const [id] = bindValues;
      const found = this.agents.get(id as string);
      return (found ? [{ id: found.id }] : []) as unknown as T;
    }

    if (q.startsWith("SELECT * FROM app_settings WHERE id = 'singleton'")) {
      return this.app_settings as unknown as T;
    }

    throw new Error(`Unhandled select query: ${q}`);
  }
}

describe('SQLite Repositories (P4-02)', () => {
  let db: MemorySqlDatabase;

  beforeEach(() => {
    db = new MemorySqlDatabase();
  });

  describe('agentsRepo', () => {
    it('automatically makes first created agent the default agent', async () => {
      const a1 = await agentsRepo.createAgent(
        {
          id: 'agent-1',
          name: 'Agent 1',
          systemPrompt: 'prompt 1',
          model: 'qwen',
          temperature: 0.7,
          contextSize: 0,
          reserveTokens: 0,
          keepRecentTokens: 0,
          enabledSkills: [],
          enabledBuiltinTools: ['read'],
          approvalMode: 'dangerous-only',
          isDefault: false,
        },
        db,
      );

      expect(a1.isDefault).toBe(true);

      const def = await agentsRepo.getDefaultAgent(db);
      expect(def?.id).toBe('agent-1');
    });

    it('unsets other default agents when creating another with isDefault: true', async () => {
      await agentsRepo.createAgent(
        {
          id: 'agent-1',
          name: 'Agent 1',
          systemPrompt: 'prompt 1',
          model: 'qwen',
          temperature: 0.7,
          contextSize: 0,
          reserveTokens: 0,
          keepRecentTokens: 0,
          enabledSkills: [],
          enabledBuiltinTools: ['read'],
          approvalMode: 'dangerous-only',
          isDefault: true,
        },
        db,
      );

      const a2 = await agentsRepo.createAgent(
        {
          id: 'agent-2',
          name: 'Agent 2',
          systemPrompt: 'prompt 2',
          model: 'llama',
          temperature: 0.7,
          contextSize: 0,
          reserveTokens: 0,
          keepRecentTokens: 0,
          enabledSkills: [],
          enabledBuiltinTools: ['read'],
          approvalMode: 'dangerous-only',
          isDefault: true,
        },
        db,
      );

      expect(a2.isDefault).toBe(true);
      const a1 = await agentsRepo.getAgent('agent-1', db);
      expect(a1?.isDefault).toBe(false);

      const def = await agentsRepo.getDefaultAgent(db);
      expect(def?.id).toBe('agent-2');
    });

    it('promotes the next agent when the default agent is deleted', async () => {
      await agentsRepo.createAgent(
        {
          id: 'agent-1',
          name: 'Agent 1',
          systemPrompt: 'prompt 1',
          model: 'qwen',
          temperature: 0.7,
          contextSize: 0,
          reserveTokens: 0,
          keepRecentTokens: 0,
          enabledSkills: [],
          enabledBuiltinTools: [],
          approvalMode: 'dangerous-only',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00Z',
        },
        db,
      );

      await agentsRepo.createAgent(
        {
          id: 'agent-2',
          name: 'Agent 2',
          systemPrompt: 'prompt 2',
          model: 'llama',
          temperature: 0.7,
          contextSize: 0,
          reserveTokens: 0,
          keepRecentTokens: 0,
          enabledSkills: [],
          enabledBuiltinTools: [],
          approvalMode: 'dangerous-only',
          isDefault: false,
          createdAt: '2026-01-02T00:00:00Z',
        },
        db,
      );

      await agentsRepo.deleteAgent('agent-1', db);

      const def = await agentsRepo.getDefaultAgent(db);
      expect(def?.id).toBe('agent-2');
      expect(def?.isDefault).toBe(true);
    });

    it('persists reasoning mode and effort, defaulting legacy rows to model default', async () => {
      const created = await agentsRepo.createAgent(
        {
          id: 'agent-reason',
          name: 'Reasoner',
          systemPrompt: 'prompt',
          model: 'qwen',
          temperature: 0.7,
          contextSize: 0,
          reserveTokens: 0,
          keepRecentTokens: 0,
          enabledSkills: [],
          enabledBuiltinTools: ['read'],
          approvalMode: 'dangerous-only',
          reasoning: 'on',
          reasoningEffort: 'high',
          isDefault: true,
        },
        db,
      );
      expect(created.reasoning).toBe('on');
      expect(created.reasoningEffort).toBe('high');

      const updated = await agentsRepo.updateAgent(
        'agent-reason',
        { reasoning: 'off' },
        db,
      );
      expect(updated.reasoning).toBe('off');
      expect(updated.reasoningEffort).toBe('high');

      // Legacy row without reasoning columns resolves to model default
      db.agents.set('agent-legacy', {
        id: 'agent-legacy',
        name: 'Legacy',
        description: null,
        system_prompt: 'prompt',
        model: 'qwen',
        temperature: 0.7,
        context_size: 0,
        reserve_tokens: 0,
        keep_recent_tokens: 0,
        enabled_skills: '[]',
        enabled_builtin_tools: '[]',
        approval_mode: 'dangerous-only',
        reasoning: null,
        reasoning_effort: null,
        top_p: null,
        top_k: null,
        repeat_penalty: null,
        frequency_penalty: null,
        presence_penalty: null,
        seed: null,
        stop_sequences: '[]',
        max_output_tokens: null,
        llm_provider: null,
        llm_base_url: null,
        llm_api_key: null,
        is_default: 0,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      });
      const legacy = await agentsRepo.getAgent('agent-legacy', db);
      expect(legacy?.reasoning).toBe('default');
      expect(legacy?.reasoningEffort).toBe('medium');
      expect(legacy?.llmProvider).toBe('ollama');
      expect(legacy?.llmBaseUrl).toBeUndefined();
      expect(legacy?.llmApiKey).toBeUndefined();
      expect(legacy?.autoMonitor).toBe(true);
    });

    it('persists LLM provider, baseUrl and apiKey', async () => {
      const created = await agentsRepo.createAgent(
        {
          id: 'agent-provider',
          name: 'Cloud',
          systemPrompt: 'prompt',
          model: 'gpt-4o-mini',
          temperature: 0.7,
          contextSize: 32768,
          reserveTokens: 0,
          keepRecentTokens: 0,
          enabledSkills: [],
          enabledBuiltinTools: ['read'],
          approvalMode: 'dangerous-only',
          llmProvider: 'openai',
          llmBaseUrl: '',
          llmApiKey: 'sk-test',
          isDefault: true,
        },
        db,
      );
      expect(created.llmProvider).toBe('openai');
      expect(created.llmApiKey).toBe('sk-test');

      const loaded = await agentsRepo.getAgent('agent-provider', db);
      expect(loaded?.llmProvider).toBe('openai');
      expect(loaded?.llmApiKey).toBe('sk-test');

      const updated = await agentsRepo.updateAgent(
        'agent-provider',
        { llmProvider: 'lmstudio', llmBaseUrl: 'http://192.168.0.5:1234/v1', llmApiKey: '' },
        db,
      );
      expect(updated.llmProvider).toBe('lmstudio');
      expect(updated.llmBaseUrl).toBe('http://192.168.0.5:1234/v1');
    });

    it('persists generation params, defaulting legacy rows to auto', async () => {
      const created = await agentsRepo.createAgent(
        {
          id: 'agent-gen',
          name: 'Sampler',
          systemPrompt: 'prompt',
          model: 'qwen',
          temperature: 0.7,
          contextSize: 0,
          reserveTokens: 0,
          keepRecentTokens: 0,
          enabledSkills: [],
          enabledBuiltinTools: ['read'],
          approvalMode: 'dangerous-only',
          topP: 0.8,
          topK: 20,
          repeatPenalty: 1.2,
          frequencyPenalty: 0.3,
          presencePenalty: -0.2,
          seed: 42,
          stopSequences: ['###', '```'],
          maxOutputTokens: 1024,
          isDefault: true,
        },
        db,
      );
      expect(created.topP).toBe(0.8);
      expect(created.seed).toBe(42);
      expect(created.stopSequences).toEqual(['###', '```']);

      const loaded = await agentsRepo.getAgent('agent-gen', db);
      expect(loaded?.topP).toBe(0.8);
      expect(loaded?.topK).toBe(20);
      expect(loaded?.repeatPenalty).toBe(1.2);
      expect(loaded?.frequencyPenalty).toBe(0.3);
      expect(loaded?.presencePenalty).toBe(-0.2);
      expect(loaded?.seed).toBe(42);
      expect(loaded?.stopSequences).toEqual(['###', '```']);
      expect(loaded?.maxOutputTokens).toBe(1024);

      // 자동(auto)으로 비우면 저장값도 지워진다
      const cleared = await agentsRepo.updateAgent(
        'agent-gen',
        { seed: undefined, stopSequences: undefined, maxOutputTokens: undefined },
        db,
      );
      expect(cleared.seed).toBeUndefined();
      expect(cleared.stopSequences).toBeUndefined();
      const reloaded = await agentsRepo.getAgent('agent-gen', db);
      expect(reloaded?.seed).toBeUndefined();
      expect(reloaded?.stopSequences).toBeUndefined();
    });

    it('persists autoMonitor, defaulting legacy rows to on', async () => {
      const created = await agentsRepo.createAgent(
        {
          id: 'agent-automon',
          name: 'Watcher',
          systemPrompt: 'prompt',
          model: 'qwen',
          temperature: 0.7,
          contextSize: 0,
          reserveTokens: 0,
          keepRecentTokens: 0,
          enabledSkills: [],
          enabledBuiltinTools: ['read'],
          approvalMode: 'dangerous-only',
          isDefault: true,
        },
        db,
      );
      // 미지정 시 기본 on
      expect(created.autoMonitor).toBe(true);

      const loaded = await agentsRepo.getAgent('agent-automon', db);
      expect(loaded?.autoMonitor).toBe(true);

      const updated = await agentsRepo.updateAgent(
        'agent-automon',
        { autoMonitor: false },
        db,
      );
      expect(updated.autoMonitor).toBe(false);
      const reloaded = await agentsRepo.getAgent('agent-automon', db);
      expect(reloaded?.autoMonitor).toBe(false);
    });
  });

  describe('sessionsRepo', () => {
    it('creates, retrieves, updates and deletes a session', async () => {
      const session = await sessionsRepo.createSession(
        {
          id: 'session-1',
          agentId: 'agent-1',
          workspaceRoot: 'C:/proj',
          title: 'Initial Title',
        },
        db,
      );

      expect(session.title).toBe('Initial Title');

      const fetched = await sessionsRepo.getSession('session-1', db);
      expect(fetched?.id).toBe('session-1');

      const updated = await sessionsRepo.updateSession(
        'session-1',
        { title: 'Updated Title' },
        db,
      );
      expect(updated.title).toBe('Updated Title');

      await sessionsRepo.deleteSession('session-1', db);
      const deleted = await sessionsRepo.getSession('session-1', db);
      expect(deleted).toBeNull();
    });
  });

  describe('entriesRepo (append-only)', () => {
    it('monotonically assigns seq starting from 1', async () => {
      const newItems: Omit<MessageEntry, 'seq'>[] = [
        {
          id: 'e1',
          sessionId: 's1',
          parentId: null,
          type: 'message',
          createdAt: new Date().toISOString(),
          message: { role: 'user', content: 'Hello' },
        },
        {
          id: 'e2',
          sessionId: 's1',
          parentId: 'e1',
          type: 'message',
          createdAt: new Date().toISOString(),
          message: { role: 'assistant', content: 'Hi', stopReason: 'stop' },
        },
      ];

      const appended1 = await entriesRepo.appendEntries('s1', newItems, db);
      expect(appended1[0].seq).toBe(1);
      expect(appended1[1].seq).toBe(2);

      const compactionItem: Omit<CompactionEntry, 'seq'> = {
        id: 'e3',
        sessionId: 's1',
        parentId: 'e2',
        type: 'compaction',
        createdAt: new Date().toISOString(),
        summary: 'Summary text',
        firstKeptEntryId: 'e2',
        tokensBefore: 2000,
        details: { readFiles: ['file.ts'], modifiedFiles: [] },
      };

      const appended2 = await entriesRepo.appendEntries(
        's1',
        [compactionItem],
        db,
      );
      expect(appended2[0].seq).toBe(3);

      const allEntries = await entriesRepo.getEntries('s1', db);
      expect(allEntries).toHaveLength(3);
      expect(allEntries.map((e) => e.seq)).toEqual([1, 2, 3]);

      const lastCompaction = await entriesRepo.getLastCompaction('s1', db);
      expect(lastCompaction?.id).toBe('e3');
      expect(lastCompaction?.summary).toBe('Summary text');
    });
  });

  describe('settingsRepo', () => {
    it('creates default settings on first access and updates singleton', async () => {
      const initial = await settingsRepo.getSettings(db);
      expect(initial.id).toBe('singleton');
      expect(initial.theme).toBe('light');
      expect(initial.defaultContextSize).toBe(8192);

      const updated = await settingsRepo.updateSettings(
        { theme: 'light', defaultContextSize: 16384 },
        db,
      );
      expect(updated.theme).toBe('light');
      expect(updated.defaultContextSize).toBe(16384);

      const reFetched = await settingsRepo.getSettings(db);
      expect(reFetched.theme).toBe('light');
      expect(reFetched.defaultContextSize).toBe(16384);
    });
  });
});
