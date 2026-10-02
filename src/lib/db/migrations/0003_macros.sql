-- P11-40: 매크로 저장소. localStorage에서 DB로 이관한다.
CREATE TABLE IF NOT EXISTS macros (
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
);
CREATE INDEX IF NOT EXISTS idx_macros_updated ON macros(updated_at);
