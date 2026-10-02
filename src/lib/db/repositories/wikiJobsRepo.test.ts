import { describe, it, expect, beforeEach } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import {
  createWikiJob,
  updateWikiJob,
  getWikiJob,
  listWikiJobs,
  getWikiJobsByStatus,
  deleteWikiJob,
} from './wikiJobsRepo';

describe('wikiJobsRepo', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
  });

  it('creates, updates, and lists jobs', async () => {
    const a = await createWikiJob({ sourcePath: 'C:/dl/a.pdf' });
    expect(a.status).toBe('queued');
    const b = await createWikiJob({ sourcePath: 'C:/dl/b.pdf', agentId: 'agent-1' });
    expect(b.agentId).toBe('agent-1');

    await updateWikiJob(a.id, { status: 'done', title: 'A', slug: 'a', folder: '2026/01-01' });
    const loaded = await getWikiJob(a.id);
    expect(loaded?.status).toBe('done');
    expect(loaded?.title).toBe('A');

    const recent = await listWikiJobs(10);
    expect(recent).toHaveLength(2);
    expect(recent[0].createdAt >= recent[1].createdAt).toBe(true);

    const queued = await getWikiJobsByStatus('queued');
    expect(queued.map((j) => j.id)).toEqual([b.id]);

    await deleteWikiJob(b.id);
    expect(await getWikiJob(b.id)).toBeNull();
  });

  it('returns null for unknown ids and ignores unknown updates', async () => {
    expect(await getWikiJob('missing')).toBeNull();
    await updateWikiJob('missing', { status: 'done' });
  });
});
