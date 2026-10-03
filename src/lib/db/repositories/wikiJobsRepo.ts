import { getDatabase } from '@/lib/db/client';

export type WikiJobStatus =
  | 'queued'
  | 'processing'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'waiting-vision';

export interface WikiJob {
  id: string;
  sourcePath: string;
  status: WikiJobStatus;
  reason: string | null;
  title: string | null;
  slug: string | null;
  folder: string | null;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbWikiJobRow {
  id: string;
  source_path: string;
  status: string;
  reason: string | null;
  title: string | null;
  slug: string | null;
  folder: string | null;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_STATUSES: WikiJobStatus[] = [
  'queued',
  'processing',
  'done',
  'failed',
  'skipped',
  'waiting-vision',
];

function mapRowToJob(row: DbWikiJobRow): WikiJob {
  return {
    id: row.id,
    sourcePath: row.source_path,
    status: (VALID_STATUSES as string[]).includes(row.status)
      ? (row.status as WikiJobStatus)
      : 'queued',
    reason: row.reason ?? null,
    title: row.title ?? null,
    slug: row.slug ?? null,
    folder: row.folder ?? null,
    agentId: row.agent_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 처리 대기 행을 만든다 (감시 이벤트·수동 재처리). */
export async function createWikiJob(
  input: { sourcePath: string; agentId?: string | null },
  workspaceRoot?: string | null,
): Promise<WikiJob> {
  const db = await getDatabase(workspaceRoot);
  const now = nowIso();
  const job: WikiJob = {
    id: crypto.randomUUID(),
    sourcePath: input.sourcePath,
    status: 'queued',
    reason: null,
    title: null,
    slug: null,
    folder: null,
    agentId: input.agentId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.execute(
    'INSERT INTO wiki_jobs (id, source_path, status, reason, title, slug, folder, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      job.id,
      job.sourcePath,
      job.status,
      job.reason,
      job.title,
      job.slug,
      job.folder,
      job.agentId,
      job.createdAt,
      job.updatedAt,
    ],
  );
  return job;
}

/** 파이프라인이 상태·결과를 갱신한다. */
export async function updateWikiJob(
  id: string,
  patch: Partial<Pick<WikiJob, 'status' | 'reason' | 'title' | 'slug' | 'folder' | 'agentId'>>,
  workspaceRoot?: string | null,
): Promise<void> {
  const db = await getDatabase(workspaceRoot);
  const current = await getWikiJob(id, workspaceRoot);
  if (!current) return;
  const next: WikiJob = {
    ...current,
    ...patch,
    reason: patch.reason !== undefined ? patch.reason : current.reason,
    updatedAt: nowIso(),
  };
  await db.execute(
    'UPDATE wiki_jobs SET status = ?, reason = ?, title = ?, slug = ?, folder = ?, agent_id = ?, updated_at = ? WHERE id = ?',
    [
      next.status,
      next.reason,
      next.title,
      next.slug,
      next.folder,
      next.agentId,
      next.updatedAt,
      id,
    ],
  );
}

export async function getWikiJob(
  id: string,
  workspaceRoot?: string | null,
): Promise<WikiJob | null> {
  const db = await getDatabase(workspaceRoot);
  const rows = await db.select<DbWikiJobRow[]>(
    'SELECT * FROM wiki_jobs WHERE id = ?',
    [id],
  );
  return rows.length > 0 ? mapRowToJob(rows[0]) : null;
}

/** 최근 처리 이력 (패널·탭 표시용, 최신순). */
export async function listWikiJobs(
  limit = 50,
  workspaceRoot?: string | null,
): Promise<WikiJob[]> {
  const db = await getDatabase(workspaceRoot);
  const rows = await db.select<DbWikiJobRow[]>(
    'SELECT * FROM wiki_jobs ORDER BY created_at DESC LIMIT ?',
    [limit],
  );
  return rows.map(mapRowToJob);
}

/** 파이프라인이 다음 작업으로 꺼낸다 (오래된 순). */
export async function getWikiJobsByStatus(
  status: WikiJobStatus,
  workspaceRoot?: string | null,
): Promise<WikiJob[]> {
  const db = await getDatabase(workspaceRoot);
  const rows = await db.select<DbWikiJobRow[]>(
    'SELECT * FROM wiki_jobs WHERE status = ? ORDER BY created_at ASC',
    [status],
  );
  return rows.map(mapRowToJob);
}

export async function deleteWikiJob(
  id: string,
  workspaceRoot?: string | null,
): Promise<void> {
  const db = await getDatabase(workspaceRoot);
  await db.execute('DELETE FROM wiki_jobs WHERE id = ?', [id]);
}
