-- P11-31: 위키 처리 이력. 파이프라인(P11-32)이 행을 만들고 갱신하며,
-- 위키 패널/탭이 대기열·최근 처리를 표시한다.
CREATE TABLE IF NOT EXISTS wiki_jobs (
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
);
CREATE INDEX IF NOT EXISTS idx_wiki_jobs_status ON wiki_jobs(status);
CREATE INDEX IF NOT EXISTS idx_wiki_jobs_created ON wiki_jobs(created_at);
