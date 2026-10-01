CREATE TABLE IF NOT EXISTS agents (
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
  auto_monitor INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  workspace_root TEXT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- append-only entries table
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  parent_id TEXT,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_session_seq ON entries(session_id, seq);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  open_tabs TEXT NOT NULL DEFAULT '[]',
  active_tab_id TEXT,
  theme TEXT NOT NULL DEFAULT 'dark',
  language TEXT NOT NULL DEFAULT 'ko',
  ollama_base_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:11434',
  default_context_size INTEGER NOT NULL DEFAULT 8192,
  default_temperature REAL NOT NULL DEFAULT 0.2,
  default_reserve_tokens INTEGER NOT NULL DEFAULT 0,
  default_keep_recent_tokens INTEGER NOT NULL DEFAULT 0,
  default_approval_mode TEXT NOT NULL DEFAULT 'dangerous-only',
  trusted_workspaces TEXT NOT NULL DEFAULT '[]',
  last_workspace_root TEXT,
  monitoring_interval_ms INTEGER NOT NULL DEFAULT 1000
);

CREATE TABLE IF NOT EXISTS agent_monitoring_snapshots (
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
);
CREATE INDEX IF NOT EXISTS idx_monitoring_agent_timestamp ON agent_monitoring_snapshots(agent_id, timestamp);

CREATE TABLE IF NOT EXISTS conversation_token_summaries (
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
);
CREATE INDEX IF NOT EXISTS idx_conv_tokens_agent_started ON conversation_token_summaries(agent_id, started_at);

-- Phase 10: automated evaluation (global DB only)
CREATE TABLE IF NOT EXISTS eval_runs (
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
);
CREATE TABLE IF NOT EXISTS eval_candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  model_meta_json TEXT,
  load_ms REAL,
  status TEXT NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_eval_candidates_run ON eval_candidates(run_id, position);
CREATE TABLE IF NOT EXISTS eval_trials (
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
);
CREATE INDEX IF NOT EXISTS idx_eval_trials_run ON eval_trials(run_id, candidate_id, pack_id);
CREATE TABLE IF NOT EXISTS eval_scores (
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
);
CREATE TABLE IF NOT EXISTS eval_aggregates (
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
);
CREATE TABLE IF NOT EXISTS eval_profiles (
  id TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS arena_votes (
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
);
CREATE TABLE IF NOT EXISTS external_integrations (
  id TEXT PRIMARY KEY,
  integration_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS integration_settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  settings_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS integration_audit_log (
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
);
CREATE INDEX IF NOT EXISTS idx_integration_audit_created ON integration_audit_log(created_at);
