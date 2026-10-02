import Database, { type QueryResult } from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_AGENT } from '@/lib/agent/defaultAgent';

export interface SqlDatabase {
  execute(query: string, bindValues?: unknown[]): Promise<QueryResult>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  close?(db?: string): Promise<boolean>;
}

export const MIGRATION_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT NOT NULL,
    model TEXT NOT NULL,
    temperature REAL NOT NULL DEFAULT 0.2,
    context_size INTEGER NOT NULL DEFAULT 0,
    reserve_tokens INTEGER NOT NULL DEFAULT 0,
    keep_recent_tokens INTEGER NOT NULL DEFAULT 0,
    enabled_skills TEXT NOT NULL DEFAULT '[]',
    enabled_builtin_tools TEXT NOT NULL DEFAULT '[]',
    approval_mode TEXT NOT NULL DEFAULT 'dangerous-only',
    reasoning TEXT NOT NULL DEFAULT 'default',
    reasoning_effort TEXT NOT NULL DEFAULT 'medium',
    top_p REAL,
    top_k INTEGER,
    repeat_penalty REAL,
    frequency_penalty REAL,
    presence_penalty REAL,
    seed INTEGER,
    stop_sequences TEXT NOT NULL DEFAULT '[]',
    max_output_tokens INTEGER,
    llm_provider TEXT NOT NULL DEFAULT 'ollama',
    llm_base_url TEXT,
    llm_api_key TEXT,
    external_agent_id TEXT,
    vision TEXT NOT NULL DEFAULT 'auto',
    auto_monitor INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    workspace_root TEXT,
    origin TEXT NOT NULL DEFAULT 'chat',
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    parent_id TEXT,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_session_seq ON entries(session_id, seq)`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    open_tabs TEXT NOT NULL DEFAULT '[]',
    active_tab_id TEXT,
    theme TEXT NOT NULL DEFAULT 'light',
    language TEXT NOT NULL DEFAULT 'ko',
    ollama_base_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:11434',
    default_context_size INTEGER NOT NULL DEFAULT 8192,
    default_temperature REAL NOT NULL DEFAULT 0.2,
    default_reserve_tokens INTEGER NOT NULL DEFAULT 0,
    default_keep_recent_tokens INTEGER NOT NULL DEFAULT 0,
    default_approval_mode TEXT NOT NULL DEFAULT 'dangerous-only',
    trusted_workspaces TEXT NOT NULL DEFAULT '[]',
    last_workspace_root TEXT,
    monitoring_interval_ms INTEGER NOT NULL DEFAULT 1000,
    setup_completed_at TEXT,
    work_folder TEXT,
    favorites TEXT NOT NULL DEFAULT '[]',
    agent_allowed_roots TEXT NOT NULL DEFAULT '[]',
    wiki_settings TEXT NOT NULL DEFAULT '{}',
    parser_settings TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS execution_logs (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT,
    session_id TEXT,
    agent_id TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_execution_logs_session ON execution_logs(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_logs_agent ON execution_logs(agent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_execution_logs_timestamp ON execution_logs(timestamp)`,
  `CREATE TABLE IF NOT EXISTS agent_monitoring_snapshots (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    timestamp TEXT NOT NULL,
    gpu_name TEXT,
    gpu_vram_total_mb INTEGER,
    gpu_vram_used_mb INTEGER,
    gpu_vram_free_mb INTEGER,
    gpu_utilization_pct REAL,
    gpu_temperature_c REAL,
    system_memory_total_mb INTEGER,
    system_memory_free_mb INTEGER,
    llm_model TEXT,
    llm_architecture TEXT,
    llm_parameter_size TEXT,
    context_size INTEGER,
    context_limit INTEGER,
    model_weight_bytes INTEGER,
    vram_allocated_bytes INTEGER,
    kv_cache_bytes INTEGER,
    gpu_offload_pct REAL,
    agent_status TEXT,
    current_task TEXT,
    prefill_tokens INTEGER,
    prefill_duration_ms REAL,
    prefill_speed REAL,
    decoding_tokens INTEGER,
    decoding_duration_ms REAL,
    decoding_speed REAL,
    total_duration_ms REAL,
    thinking_tokens INTEGER,
    conversation_id TEXT,
    conversation_seq INTEGER,
    details TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_monitoring_agent_timestamp ON agent_monitoring_snapshots(agent_id, timestamp)`,
  `CREATE TABLE IF NOT EXISTS conversation_token_summaries (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    session_id TEXT,
    seq INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    turn_count INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    thinking_tokens INTEGER NOT NULL,
    content_tokens INTEGER NOT NULL,
    status_tokens TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_conv_tokens_agent_started ON conversation_token_summaries(agent_id, started_at)`,
  `CREATE TABLE IF NOT EXISTS eval_runs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    config_json TEXT NOT NULL,
    hardware_json TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    progress_done INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS eval_candidates (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    label TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    model_meta_json TEXT,
    load_ms REAL,
    status TEXT NOT NULL,
    error TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_eval_candidates_run ON eval_candidates(run_id, position)`,
  `CREATE TABLE IF NOT EXISTS eval_trials (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    candidate_id TEXT NOT NULL REFERENCES eval_candidates(id) ON DELETE CASCADE,
    pack_id TEXT NOT NULL,
    sample_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    output_text TEXT,
    reasoning_text TEXT,
    transcript_json TEXT,
    final_state_json TEXT,
    extra_json TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    thinking_tokens INTEGER,
    ttft_ms REAL,
    prefill_tps REAL,
    decode_tps REAL,
    total_ms REAL,
    timing_source TEXT,
    cache_hit INTEGER,
    vram_peak_mb INTEGER,
    gpu_util_avg REAL,
    gpu_temp_max REAL,
    offload_ratio REAL,
    turns INTEGER,
    tool_calls INTEGER,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    UNIQUE(candidate_id, pack_id, sample_id, epoch)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_eval_trials_run ON eval_trials(run_id, candidate_id, pack_id)`,
  `CREATE TABLE IF NOT EXISTS eval_scores (
    id TEXT PRIMARY KEY,
    trial_id TEXT NOT NULL REFERENCES eval_trials(id) ON DELETE CASCADE,
    scorer_key TEXT NOT NULL,
    scorer_type TEXT NOT NULL,
    value REAL NOT NULL,
    verdict TEXT NOT NULL,
    reason TEXT,
    extracted TEXT,
    judge_raw TEXT,
    source TEXT NOT NULL DEFAULT 'auto',
    created_at TEXT NOT NULL,
    UNIQUE(trial_id, scorer_key, source)
  )`,
  `CREATE TABLE IF NOT EXISTS eval_aggregates (
    run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
    candidate_id TEXT NOT NULL,
    level TEXT NOT NULL,
    key TEXT NOT NULL,
    raw REAL,
    normalized REAL,
    ci_low REAL,
    ci_high REAL,
    n INTEGER,
    anchors_version TEXT,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (run_id, candidate_id, level, key)
  )`,
  `CREATE TABLE IF NOT EXISTS eval_profiles (
    id TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS arena_votes (
    id TEXT PRIMARY KEY,
    prompt_hash TEXT NOT NULL,
    prompt_preview TEXT,
    a_snapshot_json TEXT NOT NULL,
    b_snapshot_json TEXT NOT NULL,
    a_label TEXT NOT NULL,
    b_label TEXT NOT NULL,
    winner TEXT NOT NULL,
    workspace_root TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS external_integrations (
    id TEXT PRIMARY KEY,
    integration_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS integration_settings (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    settings_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS integration_audit_log (
    id TEXT PRIMARY KEY,
    integration_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    data_classes TEXT NOT NULL,
    run_id TEXT,
    request_count INTEGER NOT NULL,
    bytes_sent INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_integration_audit_created ON integration_audit_log(created_at)`,
  // P11-31: 위키 처리 이력. 패널/탭 표시 + P11-32 파이프라인 큐.
  `CREATE TABLE IF NOT EXISTS wiki_jobs (
    id TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    reason TEXT,
    title TEXT,
    slug TEXT,
    folder TEXT,
    agent_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_jobs_status ON wiki_jobs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_wiki_jobs_created ON wiki_jobs(created_at)`,
  // P11-40: 매크로 저장소.
  `CREATE TABLE IF NOT EXISTS macros (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompts_json TEXT NOT NULL DEFAULT '[]',
    agent_id TEXT,
    run_root TEXT NOT NULL DEFAULT '',
    schedule_json TEXT NOT NULL DEFAULT '{"kind":"none"}',
    last_result TEXT,
    last_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_macros_updated ON macros(updated_at)`,
  // P11-03: 평가 테이블 폐기. 외부 연동 3종(external_integrations/integration_settings/
  // integration_audit_log)은 유지한다. 기존 CREATE는 이력으로 남기고 DROP을 뒤에 둔다.
  `DROP TABLE IF EXISTS eval_scores`,
  `DROP TABLE IF EXISTS eval_trials`,
  `DROP TABLE IF EXISTS eval_candidates`,
  `DROP TABLE IF EXISTS arena_votes`,
  `DROP TABLE IF EXISTS eval_aggregates`,
  `DROP TABLE IF EXISTS eval_profiles`,
  `DROP TABLE IF EXISTS eval_runs`,
];

export class MemorySqlFallback implements SqlDatabase {
  private tables = new Map<string, Map<string, Record<string, unknown>>>();

  constructor() {
    this.tables.set('agents', new Map());
    this.tables.set('sessions', new Map());
    this.tables.set('entries', new Map());
    this.tables.set('app_settings', new Map());
    this.tables.set('execution_logs', new Map());
    this.tables.set('agent_monitoring_snapshots', new Map());
    this.tables.set('conversation_token_summaries', new Map());
    this.tables.set('wiki_jobs', new Map());
    this.tables.set('macros', new Map());
    this.tables.set('eval_runs', new Map());
    this.tables.set('eval_candidates', new Map());
    this.tables.set('eval_trials', new Map());
    this.tables.set('eval_scores', new Map());
    this.tables.set('eval_aggregates', new Map());
    this.tables.set('eval_profiles', new Map());
    this.tables.set('arena_votes', new Map());
    this.tables.set('external_integrations', new Map());
    this.tables.set('integration_settings', new Map());
    this.tables.set('integration_audit_log', new Map());
  }

  private evalTable(name: string): Map<string, Record<string, unknown>> {
    let table = this.tables.get(name);
    if (!table) {
      table = new Map();
      this.tables.set(name, table);
    }
    return table;
  }

  async execute(
    query: string,
    bindValues: unknown[] = [],
  ): Promise<QueryResult> {
    const q = query.trim().replace(/\s+/g, ' ');

    if (
      q.startsWith('CREATE TABLE') ||
      q.startsWith('CREATE UNIQUE INDEX') ||
      q.startsWith('CREATE INDEX')
    ) {
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
      // 신규 스키마(31개 바인드): [..., top_p, top_k, repeat_penalty, frequency_penalty,
      //   presence_penalty, seed, stop_sequences, max_output_tokens,
      //   llm_provider, llm_base_url, llm_api_key, external_agent_id, vision,
      //   auto_monitor, is_default, created_at, updated_at]
      // 이전 스키마(30개 바인드): vision 없음 → auto로 해석
      // 이전 스키마(29개 바인드): external_agent_id 없음
      // 이전 스키마(28개 바인드): auto_monitor 없음 → 켜짐(1)으로 해석
      // 과도기 스키마(20개 바인드): [..., llm_provider, llm_base_url, llm_api_key, is_default, created_at, updated_at]
      // 구 스키마(17개 바인드): [..., is_default, created_at, updated_at]
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
      let external_agent_id: unknown = null;
      let vision: unknown = 'auto';
      let auto_monitor: unknown = 1;
      let is_default: unknown;
      let created_at: unknown;
      let updated_at: unknown;
      if (rest.length >= 17) {
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
          external_agent_id,
          vision,
          auto_monitor,
          is_default,
          created_at,
          updated_at,
        ] = rest;
      } else if (rest.length >= 16) {
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
          external_agent_id,
          auto_monitor,
          is_default,
          created_at,
          updated_at,
        ] = rest;
      } else if (rest.length >= 15) {
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
      this.tables.get('agents')?.set(id as string, {
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
        external_agent_id,
        vision,
        auto_monitor,
        is_default,
        created_at,
        updated_at,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE agents SET is_default = 0 WHERE id != ?')) {
      const [excludeId] = bindValues;
      for (const [k, a] of this.tables.get('agents') ?? []) {
        if (k !== excludeId) a.is_default = 0;
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE agents SET is_default = 0')) {
      for (const a of this.tables.get('agents')?.values() ?? []) {
        a.is_default = 0;
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE agents SET is_default = 1 WHERE id = ?')) {
      const [targetId] = bindValues;
      const target = this.tables.get('agents')?.get(targetId as string);
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
      //   llm_provider, llm_base_url, llm_api_key, external_agent_id, vision,
      //   auto_monitor, is_default, updated_at, id]
      // 이전 스키마: vision 없음
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
      let external_agent_id: unknown;
      let vision: unknown;
      let auto_monitor: unknown;
      let is_default: unknown;
      let updated_at: unknown;
      let id: unknown;
      if (rest.length >= 17) {
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
          external_agent_id,
          vision,
          auto_monitor,
          is_default,
          updated_at,
          id,
        ] = rest;
      } else if (rest.length >= 16) {
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
          external_agent_id,
          auto_monitor,
          is_default,
          updated_at,
          id,
        ] = rest;
      } else if (rest.length >= 15) {
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
      const existing = this.tables.get('agents')?.get(id as string);
      if (existing) {
        Object.assign(existing, {
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
          ...(top_p !== undefined ? { top_p } : {}),
          ...(top_k !== undefined ? { top_k } : {}),
          ...(repeat_penalty !== undefined ? { repeat_penalty } : {}),
          ...(frequency_penalty !== undefined ? { frequency_penalty } : {}),
          ...(presence_penalty !== undefined ? { presence_penalty } : {}),
          ...(seed !== undefined ? { seed } : {}),
          ...(stop_sequences !== undefined ? { stop_sequences } : {}),
          ...(max_output_tokens !== undefined ? { max_output_tokens } : {}),
          ...(llm_provider !== undefined ? { llm_provider } : {}),
          ...(llm_base_url !== undefined ? { llm_base_url } : {}),
          ...(llm_api_key !== undefined ? { llm_api_key } : {}),
          ...(external_agent_id !== undefined ? { external_agent_id } : {}),
          ...(vision !== undefined ? { vision } : {}),
          ...(auto_monitor !== undefined ? { auto_monitor } : {}),
          is_default,
          updated_at,
        });
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM agents WHERE id = ?')) {
      const [id] = bindValues;
      this.tables.get('agents')?.delete(id as string);
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO sessions')) {
      const [id, agent_id, workspace_root, ...rest] = bindValues;
      // 신규 7컬럼(origin 포함) 또는 구 6컬럼.
      const [origin, title, created_at, updated_at] =
        rest.length === 4
          ? (rest as [unknown, unknown, unknown, unknown])
          : [ 'chat', ...(rest as [unknown, unknown, unknown]) ];
      this.tables.get('sessions')?.set(id as string, {
        id,
        agent_id,
        workspace_root,
        origin,
        title,
        created_at,
        updated_at,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE sessions SET')) {
      const [agent_id, workspace_root, title, updated_at, id] = bindValues;
      const existing = this.tables.get('sessions')?.get(id as string);
      if (existing) {
        Object.assign(existing, { agent_id, workspace_root, title, updated_at });
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM sessions WHERE id = ?')) {
      const [id] = bindValues;
      this.tables.get('sessions')?.delete(id as string);
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO entries')) {
      const [id, session_id, parent_id, seq, type, payload, created_at] =
        bindValues;
      this.tables.get('entries')?.set(id as string, {
        id,
        session_id,
        parent_id,
        seq,
        type,
        payload,
        created_at,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM entries WHERE session_id = ?')) {
      const [sessionId] = bindValues;
      const entriesMap = this.tables.get('entries');
      if (entriesMap) {
        for (const [k, v] of entriesMap) {
          if (v.session_id === sessionId) {
            entriesMap.delete(k);
          }
        }
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO app_settings')) {
      if (bindValues.length <= 11) {
        // Legacy 11-column insert (pre model-defaults).
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
        this.tables.get('app_settings')?.set(id as string, {
          id,
          open_tabs,
          active_tab_id,
          theme,
          language,
          ollama_base_url,
          default_context_size,
          default_temperature: 0.2,
          default_reserve_tokens: 0,
          default_keep_recent_tokens: 0,
          default_approval_mode,
          trusted_workspaces,
          last_workspace_root,
          monitoring_interval_ms: (monitoring_interval_ms as number) ?? 1000,
        });
        return { rowsAffected: 1 };
      }
      const [
        id,
        open_tabs,
        active_tab_id,
        theme,
        language,
        ollama_base_url,
        default_context_size,
        default_temperature,
        default_reserve_tokens,
        default_keep_recent_tokens,
        default_approval_mode,
        trusted_workspaces,
        last_workspace_root,
        monitoring_interval_ms,
        setup_completed_at,
        work_folder,
        favorites,
        agent_allowed_roots,
        wiki_settings,
        parser_settings,
      ] = bindValues;
      this.tables.get('app_settings')?.set(id as string, {
        id,
        open_tabs,
        active_tab_id,
        theme,
        language,
        ollama_base_url,
        default_context_size,
        default_temperature: (default_temperature as number) ?? 0.2,
        default_reserve_tokens: (default_reserve_tokens as number) ?? 0,
        default_keep_recent_tokens: (default_keep_recent_tokens as number) ?? 0,
        default_approval_mode,
        trusted_workspaces,
        last_workspace_root,
        monitoring_interval_ms: (monitoring_interval_ms as number) ?? 1000,
        setup_completed_at: (setup_completed_at as string | null) ?? null,
        work_folder: (work_folder as string | null) ?? null,
        favorites: (favorites as string | null) ?? '[]',
        agent_allowed_roots: (agent_allowed_roots as string | null) ?? '[]',
        wiki_settings: (wiki_settings as string | null) ?? '{}',
        parser_settings: (parser_settings as string | null) ?? '{}',
      });
      return { rowsAffected: 1 };
    }

    // P11-04: 바인드 2개일 때만 탭 전용 갱신이다. 전체 갱신(13/19개)도 같은
    // prefix로 시작하므로 길이 검사가 없으면 전체 값이 유실된다.
    if (
      q.startsWith('UPDATE app_settings SET open_tabs = ?, active_tab_id = ?') &&
      bindValues.length === 2
    ) {
      const [open_tabs, active_tab_id] = bindValues;
      const settings = this.tables.get('app_settings')?.get('singleton');
      if (settings) {
        Object.assign(settings, { open_tabs, active_tab_id });
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE app_settings SET')) {
      const settings = this.tables.get('app_settings')?.get('singleton');
      if (settings) {
        if (bindValues.length <= 10) {
          // Legacy 10-column update (pre model-defaults).
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
          Object.assign(settings, {
            open_tabs,
            active_tab_id,
            theme,
            language,
            ollama_base_url,
            default_context_size,
            default_approval_mode,
            trusted_workspaces,
            last_workspace_root,
            ...(monitoring_interval_ms !== undefined
              ? { monitoring_interval_ms }
              : {}),
          });
          return { rowsAffected: 1 };
        }
        const [
          open_tabs,
          active_tab_id,
          theme,
          language,
          ollama_base_url,
          default_context_size,
          default_temperature,
          default_reserve_tokens,
          default_keep_recent_tokens,
          default_approval_mode,
          trusted_workspaces,
          last_workspace_root,
          monitoring_interval_ms,
          setup_completed_at,
          work_folder,
          favorites,
          agent_allowed_roots,
          wiki_settings,
          parser_settings,
        ] = bindValues;
        Object.assign(settings, {
          open_tabs,
          active_tab_id,
          theme,
          language,
          ollama_base_url,
          default_context_size,
          default_temperature,
          default_reserve_tokens,
          default_keep_recent_tokens,
          default_approval_mode,
          trusted_workspaces,
          last_workspace_root,
          ...(monitoring_interval_ms !== undefined
            ? { monitoring_interval_ms }
            : {}),
          ...(setup_completed_at !== undefined ? { setup_completed_at } : {}),
          ...(work_folder !== undefined ? { work_folder } : {}),
          ...(favorites !== undefined ? { favorites } : {}),
          ...(agent_allowed_roots !== undefined ? { agent_allowed_roots } : {}),
          ...(wiki_settings !== undefined ? { wiki_settings } : {}),
          ...(parser_settings !== undefined ? { parser_settings } : {}),
        });
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO execution_logs')) {
      const [id, timestamp, level, category, message, details, session_id, agent_id] =
        bindValues;
      this.tables.get('execution_logs')?.set(id as string, {
        id,
        timestamp,
        level,
        category,
        message,
        details,
        session_id,
        agent_id,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM execution_logs WHERE session_id = ?')) {
      const [sessionId] = bindValues;
      const logsMap = this.tables.get('execution_logs');
      let affected = 0;
      if (logsMap) {
        for (const [k, v] of logsMap) {
          if (v.session_id === sessionId) {
            logsMap.delete(k);
            affected++;
          }
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('DELETE FROM execution_logs WHERE timestamp < ?')) {
      const [cutoff] = bindValues;
      const logsMap = this.tables.get('execution_logs');
      let affected = 0;
      if (logsMap) {
        for (const [k, v] of logsMap) {
          if ((v.timestamp as string) < (cutoff as string)) {
            logsMap.delete(k);
            affected++;
          }
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('DELETE FROM execution_logs WHERE id NOT IN')) {
      const [maxKeep] = bindValues;
      const logsMap = this.tables.get('execution_logs');
      if (!logsMap) return { rowsAffected: 0 };
      const sorted = Array.from(logsMap.values()).sort((a, b) =>
        (b.timestamp as string).localeCompare(a.timestamp as string),
      );
      const keepIds = new Set(sorted.slice(0, maxKeep as number).map((r) => r.id as string));
      let affected = 0;
      for (const [k] of logsMap) {
        if (!keepIds.has(k)) {
          logsMap.delete(k);
          affected++;
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('DELETE FROM execution_logs')) {
      const count = this.tables.get('execution_logs')?.size ?? 0;
      this.tables.get('execution_logs')?.clear();
      return { rowsAffected: count };
    }

    if (q.startsWith('INSERT INTO agent_monitoring_snapshots')) {
      const [
        id,
        agent_id,
        timestamp,
        gpu_name,
        gpu_vram_total_mb,
        gpu_vram_used_mb,
        gpu_vram_free_mb,
        gpu_utilization_pct,
        gpu_temperature_c,
        system_memory_total_mb,
        system_memory_free_mb,
        llm_model,
        llm_architecture,
        llm_parameter_size,
        context_size,
        context_limit,
        model_weight_bytes,
        vram_allocated_bytes,
        kv_cache_bytes,
        gpu_offload_pct,
        agent_status,
        current_task,
        prefill_tokens,
        prefill_duration_ms,
        prefill_speed,
        decoding_tokens,
        decoding_duration_ms,
        decoding_speed,
        total_duration_ms,
        thinking_tokens,
        conversation_id,
        conversation_seq,
        details,
        created_at,
      ] = bindValues;
      this.tables.get('agent_monitoring_snapshots')?.set(id as string, {
        id,
        agent_id,
        timestamp,
        gpu_name,
        gpu_vram_total_mb,
        gpu_vram_used_mb,
        gpu_vram_free_mb,
        gpu_utilization_pct,
        gpu_temperature_c,
        system_memory_total_mb,
        system_memory_free_mb,
        llm_model,
        llm_architecture,
        llm_parameter_size,
        context_size,
        context_limit,
        model_weight_bytes,
        vram_allocated_bytes,
        kv_cache_bytes,
        gpu_offload_pct,
        agent_status,
        current_task,
        prefill_tokens,
        prefill_duration_ms,
        prefill_speed,
        decoding_tokens,
        decoding_duration_ms,
        decoding_speed,
        total_duration_ms,
        thinking_tokens,
        conversation_id,
        conversation_seq,
        details,
        created_at,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO conversation_token_summaries')) {
      const [
        id,
        agent_id,
        session_id,
        seq,
        started_at,
        ended_at,
        turn_count,
        input_tokens,
        output_tokens,
        thinking_tokens,
        content_tokens,
        status_tokens,
        created_at,
      ] = bindValues;
      this.tables.get('conversation_token_summaries')?.set(id as string, {
        id,
        agent_id,
        session_id,
        seq,
        started_at,
        ended_at,
        turn_count,
        input_tokens,
        output_tokens,
        thinking_tokens,
        content_tokens,
        status_tokens,
        created_at,
      });
      return { rowsAffected: 1 };
    }

    // P11-31: 위키 처리 이력.
    if (q.startsWith('INSERT INTO wiki_jobs')) {
      const [
        id,
        source_path,
        status,
        reason,
        title,
        slug,
        folder,
        agent_id,
        created_at,
        updated_at,
      ] = bindValues;
      this.tables.get('wiki_jobs')?.set(id as string, {
        id,
        source_path,
        status,
        reason,
        title,
        slug,
        folder,
        agent_id,
        created_at,
        updated_at,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE wiki_jobs SET')) {
      const [status, reason, title, slug, folder, agent_id, updated_at, id] = bindValues;
      const row = this.tables.get('wiki_jobs')?.get(id as string);
      if (!row) return { rowsAffected: 0 };
      Object.assign(row, { status, reason, title, slug, folder, agent_id, updated_at });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM wiki_jobs WHERE id = ?')) {
      const [id] = bindValues;
      const removed = this.tables.get('wiki_jobs')?.delete(id as string) ?? false;
      return { rowsAffected: removed ? 1 : 0 };
    }

    // P11-40: 매크로 저장소.
    if (q.startsWith('INSERT INTO macros')) {
      const [
        id,
        name,
        prompts_json,
        agent_id,
        run_root,
        schedule_json,
        last_result,
        last_run_at,
        created_at,
        updated_at,
      ] = bindValues;
      this.tables.get('macros')?.set(id as string, {
        id,
        name,
        prompts_json,
        agent_id,
        run_root,
        schedule_json,
        last_result,
        last_run_at,
        created_at,
        updated_at,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE macros SET')) {
      const [name, prompts_json, agent_id, run_root, schedule_json, last_result, last_run_at, updated_at, id] =
        bindValues;
      const row = this.tables.get('macros')?.get(id as string);
      if (!row) return { rowsAffected: 0 };
      Object.assign(row, { name, prompts_json, agent_id, run_root, schedule_json, last_result, last_run_at, updated_at });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM macros WHERE id = ?')) {
      const [id] = bindValues;
      const removed = this.tables.get('macros')?.delete(id as string) ?? false;
      return { rowsAffected: removed ? 1 : 0 };
    }

    if (q.startsWith('DELETE FROM agent_monitoring_snapshots WHERE agent_id = ? AND timestamp < ?')) {
      const [agentId, cutoff] = bindValues;
      const snapMap = this.tables.get('agent_monitoring_snapshots');
      let affected = 0;
      if (snapMap) {
        for (const [k, v] of snapMap) {
          if (v.agent_id === agentId && (v.timestamp as string) < (cutoff as string)) {
            snapMap.delete(k);
            affected++;
          }
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('DELETE FROM agent_monitoring_snapshots WHERE timestamp < ?')) {
      const [cutoff] = bindValues;
      const snapMap = this.tables.get('agent_monitoring_snapshots');
      let affected = 0;
      if (snapMap) {
        for (const [k, v] of snapMap) {
          if ((v.timestamp as string) < (cutoff as string)) {
            snapMap.delete(k);
            affected++;
          }
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('DELETE FROM agent_monitoring_snapshots WHERE agent_id = ? AND id NOT IN')) {
      const [agentId, , maxKeep] = bindValues;
      const snapMap = this.tables.get('agent_monitoring_snapshots');
      if (!snapMap) return { rowsAffected: 0 };
      const agentRows = Array.from(snapMap.values())
        .filter((r) => r.agent_id === agentId)
        .sort((a, b) => (b.timestamp as string).localeCompare(a.timestamp as string));
      const keepIds = new Set(agentRows.slice(0, maxKeep as number).map((r) => r.id as string));
      let affected = 0;
      for (const [k, v] of snapMap) {
        if (v.agent_id === agentId && !keepIds.has(k)) {
          snapMap.delete(k);
          affected++;
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('DELETE FROM agent_monitoring_snapshots WHERE agent_id = ?')) {
      const [agentId] = bindValues;
      const snapMap = this.tables.get('agent_monitoring_snapshots');
      let affected = 0;
      if (snapMap) {
        for (const [k, v] of snapMap) {
          if (v.agent_id === agentId) {
            snapMap.delete(k);
            affected++;
          }
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('DELETE FROM agent_monitoring_snapshots WHERE id = ?')) {
      const [id] = bindValues;
      const snapMap = this.tables.get('agent_monitoring_snapshots');
      let affected = 0;
      if (snapMap?.delete(id as string)) {
        affected = 1;
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('DELETE FROM agent_monitoring_snapshots')) {
      const count = this.tables.get('agent_monitoring_snapshots')?.size ?? 0;
      this.tables.get('agent_monitoring_snapshots')?.clear();
      return { rowsAffected: count };
    }

    if (q.startsWith('DELETE FROM conversation_token_summaries WHERE agent_id = ?')) {
      const [agentId] = bindValues;
      const convMap = this.tables.get('conversation_token_summaries');
      let affected = 0;
      if (convMap) {
        for (const [k, v] of convMap) {
          if (v.agent_id === agentId) {
            convMap.delete(k);
            affected++;
          }
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('DELETE FROM conversation_token_summaries')) {
      const count = this.tables.get('conversation_token_summaries')?.size ?? 0;
      this.tables.get('conversation_token_summaries')?.clear();
      return { rowsAffected: count };
    }

    if (q === 'VACUUM') {
      return { rowsAffected: 0 };
    }

    // -- Phase 10 evaluation tables (global DB) --
    if (q.startsWith('INSERT INTO eval_runs')) {
      const [id, name, config_json, hardware_json, created_at, updated_at] = bindValues;
      this.evalTable('eval_runs').set(id as string, {
        id, name, config_json, hardware_json, status: 'pending', error: null,
        progress_done: 0, progress_total: 0, started_at: null, finished_at: null,
        created_at, updated_at,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith("UPDATE eval_runs SET status = 'interrupted'")) {
      const [updated_at] = bindValues;
      let affected = 0;
      for (const row of this.evalTable('eval_runs').values()) {
        if (row.status === 'running' || row.status === 'judging' || row.status === 'paused') {
          row.status = 'interrupted';
          row.updated_at = updated_at;
          affected++;
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('UPDATE eval_runs SET status = ?')) {
      const [status, error, started_at, finished_at, updated_at, id] = bindValues;
      const row = this.evalTable('eval_runs').get(id as string);
      if (row) {
        Object.assign(row, { status, error, started_at, finished_at, updated_at });
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE eval_runs SET progress_done = ?')) {
      const [progress_done, progress_total, updated_at, id] = bindValues;
      const row = this.evalTable('eval_runs').get(id as string);
      if (row) {
        Object.assign(row, { progress_done, progress_total, updated_at });
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE eval_runs SET name = ?')) {
      const [name, updated_at, id] = bindValues;
      const row = this.evalTable('eval_runs').get(id as string);
      if (row) {
        Object.assign(row, { name, updated_at });
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM eval_runs WHERE id = ?')) {
      const [id] = bindValues;
      this.evalTable('eval_runs').delete(id as string);
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO eval_candidates')) {
      const [id, run_id, position, label, snapshot_json] = bindValues;
      this.evalTable('eval_candidates').set(id as string, {
        id, run_id, position, label, snapshot_json,
        model_meta_json: null, load_ms: null, status: 'pending', error: null,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE eval_candidates SET status = ?')) {
      const [status, error, load_ms, model_meta_json, id] = bindValues;
      const row = this.evalTable('eval_candidates').get(id as string);
      if (row) {
        Object.assign(row, { status, error, load_ms, model_meta_json });
      }
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO eval_trials')) {
      const [
        id, run_id, candidate_id, pack_id, sample_id, epoch, outcome,
        output_text, reasoning_text, transcript_json, final_state_json, extra_json,
        input_tokens, output_tokens, thinking_tokens, ttft_ms, prefill_tps,
        decode_tps, total_ms, timing_source, cache_hit, vram_peak_mb,
        gpu_util_avg, gpu_temp_max, offload_ratio, turns, tool_calls,
        started_at, finished_at,
      ] = bindValues;
      const table = this.evalTable('eval_trials');
      const tupleKey = `${candidate_id}|${pack_id}|${sample_id}|${epoch}`;
      let existingId: string | null = null;
      for (const [key, row] of table) {
        if (`${row.candidate_id}|${row.pack_id}|${row.sample_id}|${row.epoch}` === tupleKey) {
          existingId = key;
          break;
        }
      }
      const record = {
        id: existingId ?? id, run_id, candidate_id, pack_id, sample_id, epoch, outcome,
        output_text, reasoning_text, transcript_json, final_state_json, extra_json,
        input_tokens, output_tokens, thinking_tokens, ttft_ms, prefill_tps,
        decode_tps, total_ms, timing_source, cache_hit, vram_peak_mb,
        gpu_util_avg, gpu_temp_max, offload_ratio, turns, tool_calls,
        started_at, finished_at,
      };
      table.set((existingId ?? id) as string, record);
      return { rowsAffected: 1 };
    }

    if (q.startsWith('UPDATE eval_trials SET output_text = NULL')) {
      const [cutoff] = bindValues;
      let affected = 0;
      for (const row of this.evalTable('eval_trials').values()) {
        if ((row.started_at as string) < (cutoff as string)) {
          row.output_text = null;
          row.reasoning_text = null;
          row.transcript_json = null;
          row.final_state_json = null;
          affected++;
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('DELETE FROM eval_trials WHERE run_id = ?')) {
      const [runId] = bindValues;
      const table = this.evalTable('eval_trials');
      let affected = 0;
      for (const [k, v] of table) {
        if (v.run_id === runId) {
          table.delete(k);
          affected++;
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('INSERT INTO eval_scores')) {
      const [id, trial_id, scorer_key, scorer_type, value, verdict, reason, extracted, judge_raw, source, created_at] = bindValues;
      const table = this.evalTable('eval_scores');
      const tripleKey = `${trial_id}|${scorer_key}|${source}`;
      let existingId: string | null = null;
      for (const [key, row] of table) {
        if (`${row.trial_id}|${row.scorer_key}|${row.source}` === tripleKey) {
          existingId = key;
          break;
        }
      }
      const record = {
        id: existingId ?? id, trial_id, scorer_key, scorer_type, value, verdict,
        reason, extracted, judge_raw, source, created_at,
      };
      table.set((existingId ?? id) as string, record);
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM eval_scores WHERE trial_id IN')) {
      const [runId] = bindValues;
      const trialIds = new Set<string>();
      for (const row of this.evalTable('eval_trials').values()) {
        if (row.run_id === runId) trialIds.add(row.id as string);
      }
      const table = this.evalTable('eval_scores');
      let affected = 0;
      for (const [k, v] of table) {
        if (trialIds.has(v.trial_id as string)) {
          table.delete(k);
          affected++;
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('DELETE FROM eval_candidates WHERE run_id = ?')) {
      const [runId] = bindValues;
      const table = this.evalTable('eval_candidates');
      let affected = 0;
      for (const [k, v] of table) {
        if (v.run_id === runId) {
          table.delete(k);
          affected++;
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('INSERT INTO eval_aggregates')) {
      const [run_id, candidate_id, level, key, raw, normalized, ci_low, ci_high, n, anchors_version, computed_at] = bindValues;
      this.evalTable('eval_aggregates').set(`${run_id}|${candidate_id}|${level}|${key}`, {
        run_id, candidate_id, level, key, raw, normalized, ci_low, ci_high, n,
        anchors_version, computed_at,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM eval_aggregates WHERE run_id = ?')) {
      const [runId] = bindValues;
      const table = this.evalTable('eval_aggregates');
      let affected = 0;
      for (const [k, v] of table) {
        if (v.run_id === runId) {
          table.delete(k);
          affected++;
        }
      }
      return { rowsAffected: affected };
    }

    if (q.startsWith('INSERT INTO eval_profiles')) {
      const [id, profile_json, created_at, updated_at] = bindValues;
      const table = this.evalTable('eval_profiles');
      const existing = table.get(id as string);
      table.set(id as string, {
        id, profile_json,
        created_at: existing?.created_at ?? created_at,
        updated_at,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM eval_profiles WHERE id = ?')) {
      const [id] = bindValues;
      this.evalTable('eval_profiles').delete(id as string);
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO arena_votes')) {
      const [id, prompt_hash, prompt_preview, a_snapshot_json, b_snapshot_json, a_label, b_label, winner, workspace_root, created_at] = bindValues;
      this.evalTable('arena_votes').set(id as string, {
        id, prompt_hash, prompt_preview, a_snapshot_json, b_snapshot_json,
        a_label, b_label, winner, workspace_root, created_at,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM arena_votes WHERE id = ?')) {
      const [id] = bindValues;
      this.evalTable('arena_votes').delete(id as string);
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO external_integrations')) {
      const [id, integration_json, created_at, updated_at] = bindValues;
      const table = this.evalTable('external_integrations');
      const existing = table.get(id as string);
      table.set(id as string, {
        id, integration_json,
        created_at: existing?.created_at ?? created_at,
        updated_at,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM external_integrations WHERE id = ?')) {
      const [id] = bindValues;
      this.evalTable('external_integrations').delete(id as string);
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO integration_settings')) {
      const [settings_json] = bindValues;
      this.evalTable('integration_settings').set('singleton', {
        id: 'singleton', settings_json,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('INSERT INTO integration_audit_log')) {
      const [id, integration_id, purpose, data_classes, run_id, request_count, bytes_sent, status, error, created_at] = bindValues;
      this.evalTable('integration_audit_log').set(id as string, {
        id, integration_id, purpose, data_classes, run_id, request_count,
        bytes_sent, status, error, created_at,
      });
      return { rowsAffected: 1 };
    }

    if (q.startsWith('DELETE FROM integration_audit_log')) {
      const count = this.evalTable('integration_audit_log').size;
      this.evalTable('integration_audit_log').clear();
      return { rowsAffected: count };
    }

    return { rowsAffected: 0 };
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    const q = query.trim();

    if (q.startsWith('SELECT COUNT(*) as count FROM agents')) {
      const count = this.tables.get('agents')?.size ?? 0;
      return [{ count }] as unknown as T;
    }

    if (q.startsWith('SELECT * FROM agents WHERE is_default = 1')) {
      const found = Array.from(this.tables.get('agents')?.values() ?? []).find(
        (a) => a.is_default === 1,
      );
      return (found ? [found] : []) as unknown as T;
    }

    if (
      q.startsWith('SELECT * FROM agents WHERE id = ?') ||
      q.startsWith('SELECT id FROM agents WHERE id = ?')
    ) {
      const [id] = bindValues;
      const found = this.tables.get('agents')?.get(id as string);
      return (found ? [found] : []) as unknown as T;
    }

    if (
      q.startsWith(
        'SELECT id FROM agents WHERE id != ? ORDER BY created_at ASC LIMIT 1',
      )
    ) {
      const [excludeId] = bindValues;
      const sorted = Array.from(this.tables.get('agents')?.values() ?? [])
        .filter((a) => a.id !== excludeId)
        .sort((a, b) =>
          (a.created_at as string).localeCompare(b.created_at as string),
        );
      return (sorted.length > 0 ? [{ id: sorted[0].id }] : []) as unknown as T;
    }

    if (q.startsWith('SELECT id FROM agents ORDER BY created_at ASC LIMIT 1')) {
      const sorted = Array.from(
        this.tables.get('agents')?.values() ?? [],
      ).sort((a, b) =>
        (a.created_at as string).localeCompare(b.created_at as string),
      );
      return (sorted.length > 0 ? [{ id: sorted[0].id }] : []) as unknown as T;
    }

    if (q.startsWith('SELECT * FROM agents ORDER BY created_at ASC')) {
      const sorted = Array.from(
        this.tables.get('agents')?.values() ?? [],
      ).sort((a, b) =>
        (a.created_at as string).localeCompare(b.created_at as string),
      );
      return sorted as unknown as T;
    }

    if (q.startsWith('SELECT * FROM sessions ORDER BY updated_at DESC')) {
      const sorted = Array.from(
        this.tables.get('sessions')?.values() ?? [],
      ).sort((a, b) =>
        (b.updated_at as string).localeCompare(a.updated_at as string),
      );
      return sorted as unknown as T;
    }

    if (q.startsWith('SELECT * FROM sessions WHERE id = ?')) {
      const [id] = bindValues;
      const found = this.tables.get('sessions')?.get(id as string);
      return (found ? [found] : []) as unknown as T;
    }

    if (
      q.startsWith(
        'SELECT MAX(seq) as max_seq FROM entries WHERE session_id = ?',
      )
    ) {
      const [sessionId] = bindValues;
      const sessionEntries = Array.from(
        this.tables.get('entries')?.values() ?? [],
      ).filter((e) => e.session_id === sessionId);
      const maxSeq =
        sessionEntries.length > 0
          ? Math.max(...sessionEntries.map((e) => e.seq as number))
          : null;
      return [{ max_seq: maxSeq }] as unknown as T;
    }

    if (
      q.includes(
        "WHERE session_id = ? AND type = 'compaction' ORDER BY seq DESC LIMIT 1",
      )
    ) {
      const [sessionId] = bindValues;
      const compactions = Array.from(
        this.tables.get('entries')?.values() ?? [],
      )
        .filter((e) => e.session_id === sessionId && e.type === 'compaction')
        .sort((a, b) => (b.seq as number) - (a.seq as number));
      return (compactions.length > 0 ? [compactions[0]] : []) as unknown as T;
    }

    if (
      q.startsWith(
        'SELECT id, session_id, parent_id, seq, type, payload, created_at FROM entries WHERE session_id = ? ORDER BY seq ASC',
      )
    ) {
      const [sessionId] = bindValues;
      const sessionEntries = Array.from(
        this.tables.get('entries')?.values() ?? [],
      )
        .filter((e) => e.session_id === sessionId)
        .sort((a, b) => (a.seq as number) - (b.seq as number));
      return sessionEntries as unknown as T;
    }

    if (q.startsWith("SELECT * FROM app_settings WHERE id = 'singleton'")) {
      const settings = this.tables.get('app_settings')?.get('singleton');
      return (settings ? [settings] : []) as unknown as T;
    }

    if (q.includes('FROM execution_logs WHERE session_id = ? AND agent_id = ?')) {
      const [sessionId, agentId] = bindValues;
      const logs = Array.from(this.tables.get('execution_logs')?.values() ?? [])
        .filter((l) => l.session_id === sessionId && l.agent_id === agentId)
        .sort((a, b) => (a.timestamp as string).localeCompare(b.timestamp as string));
      return logs as unknown as T;
    }

    if (q.includes('FROM execution_logs WHERE agent_id = ?')) {
      const [agentId] = bindValues;
      const logs = Array.from(this.tables.get('execution_logs')?.values() ?? [])
        .filter((l) => l.agent_id === agentId)
        .sort((a, b) => (a.timestamp as string).localeCompare(b.timestamp as string));
      return logs as unknown as T;
    }

    if (q.includes('FROM execution_logs WHERE session_id = ?')) {
      const [sessionId] = bindValues;
      const logs = Array.from(this.tables.get('execution_logs')?.values() ?? [])
        .filter((l) => l.session_id === sessionId)
        .sort((a, b) => (a.timestamp as string).localeCompare(b.timestamp as string));
      return logs as unknown as T;
    }

    if (q.includes('FROM execution_logs ORDER BY timestamp ASC')) {
      const logs = Array.from(this.tables.get('execution_logs')?.values() ?? [])
        .sort((a, b) => (a.timestamp as string).localeCompare(b.timestamp as string));
      return logs as unknown as T;
    }

    if (q.includes('FROM agent_monitoring_snapshots WHERE agent_id = ?')) {
      const [agentId] = bindValues;
      const snaps = Array.from(this.tables.get('agent_monitoring_snapshots')?.values() ?? [])
        .filter((s) => s.agent_id === agentId)
        .sort((a, b) => (b.timestamp as string).localeCompare(a.timestamp as string));
      return snaps as unknown as T;
    }

    if (q.includes('GROUP BY agent_id')) {
      const grouped = new Map<string, { count: number; latest_timestamp: string }>();
      for (const s of this.tables.get('agent_monitoring_snapshots')?.values() ?? []) {
        const agentId = s.agent_id as string;
        const timestamp = s.timestamp as string;
        const entry = grouped.get(agentId);
        if (entry) {
          entry.count += 1;
          if (timestamp > entry.latest_timestamp) entry.latest_timestamp = timestamp;
        } else {
          grouped.set(agentId, { count: 1, latest_timestamp: timestamp });
        }
      }
      const rows = Array.from(grouped.entries())
        .map(([agent_id, v]) => ({ agent_id, ...v }))
        .sort((a, b) => b.latest_timestamp.localeCompare(a.latest_timestamp));
      return rows as unknown as T;
    }

    if (q.includes('FROM agent_monitoring_snapshots')) {
      const snaps = Array.from(this.tables.get('agent_monitoring_snapshots')?.values() ?? [])
        .sort((a, b) => (b.timestamp as string).localeCompare(a.timestamp as string));
      const limit = bindValues.length > 0 ? bindValues[bindValues.length - 1] : undefined;
      const capped = typeof limit === 'number' ? snaps.slice(0, limit) : snaps;
      return capped as unknown as T;
    }

    if (q.includes('FROM conversation_token_summaries WHERE agent_id = ?')) {
      const [agentId, limit] = bindValues;
      const rows = Array.from(this.tables.get('conversation_token_summaries')?.values() ?? [])
        .filter((r) => r.agent_id === agentId)
        .sort((a, b) => (b.started_at as string).localeCompare(a.started_at as string));
      const capped = typeof limit === 'number' ? rows.slice(0, limit) : rows;
      return capped as unknown as T;
    }

    if (q.includes('FROM conversation_token_summaries')) {
      const rows = Array.from(this.tables.get('conversation_token_summaries')?.values() ?? [])
        .sort((a, b) => (b.started_at as string).localeCompare(a.started_at as string));
      return rows as unknown as T;
    }

    // P11-31: 위키 처리 이력.
    if (q.includes('FROM wiki_jobs WHERE id = ?')) {
      const [id] = bindValues;
      const row = this.tables.get('wiki_jobs')?.get(id as string);
      return (row ? [row] : []) as unknown as T;
    }

    if (q.includes('FROM wiki_jobs WHERE status = ?')) {
      const [status] = bindValues;
      const rows = Array.from(this.tables.get('wiki_jobs')?.values() ?? [])
        .filter((r) => r.status === status)
        .sort((a, b) => (a.created_at as string).localeCompare(b.created_at as string));
      return rows as unknown as T;
    }

    if (q.includes('FROM wiki_jobs')) {
      const rows = Array.from(this.tables.get('wiki_jobs')?.values() ?? [])
        .sort((a, b) => (b.created_at as string).localeCompare(a.created_at as string));
      const [limit] = bindValues;
      const capped = typeof limit === 'number' ? rows.slice(0, limit) : rows;
      return capped as unknown as T;
    }

    // P11-40: 매크로 저장소.
    if (q.includes('FROM macros WHERE id = ?')) {
      const [id] = bindValues;
      const row = this.tables.get('macros')?.get(id as string);
      return (row ? [row] : []) as unknown as T;
    }

    if (q.includes('FROM macros')) {
      const rows = Array.from(this.tables.get('macros')?.values() ?? [])
        .sort((a, b) => (b.updated_at as string).localeCompare(a.updated_at as string));
      return rows as unknown as T;
    }

    // -- Phase 10 evaluation tables (global DB) --
    if (q.startsWith('SELECT * FROM eval_runs WHERE id = ?')) {
      const [id] = bindValues;
      const found = this.evalTable('eval_runs').get(id as string);
      return (found ? [found] : []) as unknown as T;
    }

    if (q.startsWith('SELECT * FROM eval_runs ORDER BY created_at DESC')) {
      const rows = Array.from(this.evalTable('eval_runs').values())
        .sort((a, b) => (b.created_at as string).localeCompare(a.created_at as string));
      return rows as unknown as T;
    }

    if (q.startsWith('SELECT * FROM eval_candidates WHERE id = ?')) {
      const [id] = bindValues;
      const found = this.evalTable('eval_candidates').get(id as string);
      return (found ? [found] : []) as unknown as T;
    }

    if (q.startsWith('SELECT * FROM eval_candidates WHERE run_id = ?')) {
      const [runId] = bindValues;
      const rows = Array.from(this.evalTable('eval_candidates').values())
        .filter((r) => r.run_id === runId)
        .sort((a, b) => (a.position as number) - (b.position as number));
      return rows as unknown as T;
    }

    if (q.startsWith('SELECT * FROM eval_trials WHERE run_id = ?')) {
      const [runId] = bindValues;
      const rows = Array.from(this.evalTable('eval_trials').values())
        .filter((r) => r.run_id === runId);
      return rows as unknown as T;
    }

    if (q.startsWith('SELECT s.* FROM eval_scores s INNER JOIN eval_trials t')) {
      const [runId] = bindValues;
      const trialIds = new Set<string>();
      for (const row of this.evalTable('eval_trials').values()) {
        if (row.run_id === runId) trialIds.add(row.id as string);
      }
      const rows = Array.from(this.evalTable('eval_scores').values())
        .filter((r) => trialIds.has(r.trial_id as string));
      return rows as unknown as T;
    }

    if (q.startsWith('SELECT * FROM eval_aggregates WHERE run_id = ?')) {
      const [runId] = bindValues;
      const rows = Array.from(this.evalTable('eval_aggregates').values())
        .filter((r) => r.run_id === runId);
      return rows as unknown as T;
    }

    if (q.startsWith('SELECT * FROM eval_profiles ORDER BY id ASC')) {
      const rows = Array.from(this.evalTable('eval_profiles').values())
        .sort((a, b) => (a.id as string).localeCompare(b.id as string));
      return rows as unknown as T;
    }

    if (q.startsWith('SELECT * FROM arena_votes ORDER BY created_at DESC')) {
      const rows = Array.from(this.evalTable('arena_votes').values())
        .sort((a, b) => (b.created_at as string).localeCompare(a.created_at as string));
      return rows as unknown as T;
    }

    if (q.startsWith('SELECT * FROM external_integrations')) {
      const rows = Array.from(this.evalTable('external_integrations').values());
      return rows as unknown as T;
    }

    if (q.startsWith("SELECT * FROM integration_settings WHERE id = 'singleton'")) {
      const found = this.evalTable('integration_settings').get('singleton');
      return (found ? [found] : []) as unknown as T;
    }

    if (q.startsWith('SELECT * FROM integration_audit_log ORDER BY created_at DESC')) {
      const rows = Array.from(this.evalTable('integration_audit_log').values())
        .sort((a, b) => (b.created_at as string).localeCompare(a.created_at as string));
      return rows as unknown as T;
    }

    return [] as unknown as T;
  }
}

let mockDb: SqlDatabase | null = null;
let globalDb: SqlDatabase | null = null;
let globalMigrationDone = false;
const projectDbs = new Map<string, SqlDatabase>();

let activeWorkspaceRoot: string | null =
  typeof window !== 'undefined'
    ? localStorage.getItem('vanilla-commander_current_workspace_root')
    : null;

export function setActiveWorkspaceRoot(root: string | null): void {
  activeWorkspaceRoot = root;
}

export function getActiveWorkspaceRoot(): string | null {
  return activeWorkspaceRoot;
}

export function setDatabase(db: SqlDatabase | null): void {
  mockDb = db;
  globalDb = db;
  globalMigrationDone = false;
  if (!db) {
    projectDbs.clear();
  }
}

export async function runMigrations(db: SqlDatabase): Promise<void> {
  for (const stmt of MIGRATION_STATEMENTS) {
    await db.execute(stmt);
  }

  // Safe migration for existing DBs to add prefill & decoding columns
  const alterColumns = [
    'ALTER TABLE agent_monitoring_snapshots ADD COLUMN prefill_tokens INTEGER',
    'ALTER TABLE agent_monitoring_snapshots ADD COLUMN prefill_duration_ms REAL',
    'ALTER TABLE agent_monitoring_snapshots ADD COLUMN prefill_speed REAL',
    'ALTER TABLE agent_monitoring_snapshots ADD COLUMN decoding_tokens INTEGER',
    'ALTER TABLE agent_monitoring_snapshots ADD COLUMN decoding_duration_ms REAL',
    'ALTER TABLE agent_monitoring_snapshots ADD COLUMN decoding_speed REAL',
    'ALTER TABLE agent_monitoring_snapshots ADD COLUMN total_duration_ms REAL',
    'ALTER TABLE agent_monitoring_snapshots ADD COLUMN thinking_tokens INTEGER',
    'ALTER TABLE agent_monitoring_snapshots ADD COLUMN conversation_id TEXT',
    'ALTER TABLE agent_monitoring_snapshots ADD COLUMN conversation_seq INTEGER',
    'ALTER TABLE app_settings ADD COLUMN monitoring_interval_ms INTEGER NOT NULL DEFAULT 1000',
    'ALTER TABLE app_settings ADD COLUMN default_temperature REAL NOT NULL DEFAULT 0.2',
    'ALTER TABLE app_settings ADD COLUMN default_reserve_tokens INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE app_settings ADD COLUMN default_keep_recent_tokens INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE agents ADD COLUMN reasoning TEXT NOT NULL DEFAULT 'default'",
    "ALTER TABLE agents ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'medium'",
    'ALTER TABLE agents ADD COLUMN top_p REAL',
    'ALTER TABLE agents ADD COLUMN top_k INTEGER',
    'ALTER TABLE agents ADD COLUMN repeat_penalty REAL',
    'ALTER TABLE agents ADD COLUMN frequency_penalty REAL',
    'ALTER TABLE agents ADD COLUMN presence_penalty REAL',
    'ALTER TABLE agents ADD COLUMN seed INTEGER',
    "ALTER TABLE agents ADD COLUMN stop_sequences TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE agents ADD COLUMN max_output_tokens INTEGER',
    "ALTER TABLE agents ADD COLUMN llm_provider TEXT NOT NULL DEFAULT 'ollama'",
    'ALTER TABLE agents ADD COLUMN llm_base_url TEXT',
    'ALTER TABLE agents ADD COLUMN llm_api_key TEXT',
    'ALTER TABLE agents ADD COLUMN auto_monitor INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE agents ADD COLUMN external_agent_id TEXT',
    "ALTER TABLE agents ADD COLUMN vision TEXT NOT NULL DEFAULT 'auto'",
    'ALTER TABLE app_settings ADD COLUMN setup_completed_at TEXT',
    'ALTER TABLE app_settings ADD COLUMN work_folder TEXT',
    "ALTER TABLE app_settings ADD COLUMN favorites TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE app_settings ADD COLUMN agent_allowed_roots TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE app_settings ADD COLUMN wiki_settings TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE app_settings ADD COLUMN parser_settings TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'chat'",
  ];
  for (const alter of alterColumns) {
    try {
      await db.execute(alter);
    } catch {
      // Column may already exist or table created with it; safe to ignore
    }
  }

  // Fortress 시절 시드된 기본 에이전트 이름만 바꾼다(사용자가 바꾼 이름은 유지)
  try {
    await db.execute(`UPDATE agents SET name = ? WHERE name = 'Fortress Default'`, [
      DEFAULT_AGENT.name,
    ]);
  } catch {
    // 메모리 폴백 등에서 UPDATE 미지원 시 무시
  }

  // Ensure default agent exists if agents table is empty
  try {
    const countRows = await db.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM agents',
    );
    if ((countRows[0]?.count ?? 0) === 0) {
      const now = new Date().toISOString();
      await db.execute(
        `INSERT OR IGNORE INTO agents (
          id, name, description, system_prompt, model, temperature,
          context_size, reserve_tokens, keep_recent_tokens, enabled_skills,
          enabled_builtin_tools, approval_mode, reasoning, reasoning_effort,
          top_p, top_k, repeat_penalty, frequency_penalty, presence_penalty,
          seed, stop_sequences, max_output_tokens,
          llm_provider, llm_base_url, llm_api_key, auto_monitor,
          is_default, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_AGENT.id,
          DEFAULT_AGENT.name,
          DEFAULT_AGENT.description ?? null,
          DEFAULT_AGENT.systemPrompt,
          DEFAULT_AGENT.model,
          DEFAULT_AGENT.temperature,
          DEFAULT_AGENT.contextSize,
          DEFAULT_AGENT.reserveTokens,
          DEFAULT_AGENT.keepRecentTokens,
          JSON.stringify(DEFAULT_AGENT.enabledSkills),
          JSON.stringify(DEFAULT_AGENT.enabledBuiltinTools),
          DEFAULT_AGENT.approvalMode,
          DEFAULT_AGENT.reasoning ?? 'default',
          DEFAULT_AGENT.reasoningEffort ?? 'medium',
          DEFAULT_AGENT.topP ?? null,
          DEFAULT_AGENT.topK ?? null,
          DEFAULT_AGENT.repeatPenalty ?? null,
          DEFAULT_AGENT.frequencyPenalty ?? null,
          DEFAULT_AGENT.presencePenalty ?? null,
          DEFAULT_AGENT.seed ?? null,
          JSON.stringify(DEFAULT_AGENT.stopSequences ?? []),
          DEFAULT_AGENT.maxOutputTokens ?? null,
          DEFAULT_AGENT.llmProvider ?? 'ollama',
          DEFAULT_AGENT.llmBaseUrl ?? null,
          DEFAULT_AGENT.llmApiKey ?? null,
          (DEFAULT_AGENT.autoMonitor ?? true) ? 1 : 0,
          1,
          now,
          now,
        ],
      );
    }
  } catch (err) {
    console.warn('Failed to seed default agent during migrations:', err);
  }
}

function isTauriEnvironment(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__,
    )
  );
}

export async function getGlobalDatabase(): Promise<SqlDatabase> {
  if (mockDb) {
    if (!globalMigrationDone) {
      await runMigrations(mockDb);
      globalMigrationDone = true;
    }
    return mockDb;
  }

  if (globalDb) {
    if (!globalMigrationDone) {
      await runMigrations(globalDb);
      globalMigrationDone = true;
    }
    return globalDb;
  }

  if (!isTauriEnvironment()) {
    globalDb = new MemorySqlFallback();
    await runMigrations(globalDb);
    globalMigrationDone = true;
    return globalDb;
  }

  const db = await Database.load('sqlite:vanilla-commander.db');
  globalDb = db;
  await runMigrations(db);
  globalMigrationDone = true;
  return db;
}

export async function getProjectDatabase(
  workspaceRoot?: string | null,
): Promise<SqlDatabase> {
  if (mockDb) {
    if (!globalMigrationDone) {
      await runMigrations(mockDb);
      globalMigrationDone = true;
    }
    return mockDb;
  }

  const root =
    workspaceRoot ??
    activeWorkspaceRoot ??
    (typeof window !== 'undefined'
      ? localStorage.getItem('vanilla-commander_current_workspace_root')
      : null);

  if (!root) {
    return getGlobalDatabase();
  }

  const cached = projectDbs.get(root);
  if (cached) {
    return cached;
  }

  if (!isTauriEnvironment()) {
    const memDb = new MemorySqlFallback();
    await runMigrations(memDb);
    projectDbs.set(root, memDb);
    return memDb;
  }

  // Ensure .vanilla-commander directory exists before attempting Database.load
  try {
    await invoke('ensure_app_data_dir', { workspaceRoot: root });
  } catch (err) {
    console.warn(
      'ensure_app_data_dir invoke failed, proceeding with Database.load:',
      err,
    );
  }

  const normalized = root.replace(/\\/g, '/');
  const connUrl = `sqlite:${normalized}/.vanilla-commander/vanilla-commander.db`;
  const db = await Database.load(connUrl);
  await runMigrations(db);
  projectDbs.set(root, db);
  return db;
}

export async function getDatabase(
  workspaceRoot?: string | null,
): Promise<SqlDatabase> {
  if (mockDb) {
    if (!globalMigrationDone) {
      await runMigrations(mockDb);
      globalMigrationDone = true;
    }
    return mockDb;
  }

  const root =
    workspaceRoot ??
    activeWorkspaceRoot ??
    (typeof window !== 'undefined'
      ? localStorage.getItem('vanilla-commander_current_workspace_root')
      : null);

  if (root) {
    return getProjectDatabase(root);
  }

  return getGlobalDatabase();
}

export async function vacuumDatabase(workspaceRoot?: string | null): Promise<void> {
  const db = await getDatabase(workspaceRoot);
  try {
    await db.execute('VACUUM');
  } catch (err) {
    console.warn('Failed to VACUUM database:', err);
  }
}

