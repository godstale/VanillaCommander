import { getDatabase, type SqlDatabase } from '@/lib/db/client';
import type { Entry, CompactionEntry, EntryType } from '@/lib/types/chat';

interface EntryRow {
  id: string;
  session_id: string;
  parent_id: string | null;
  seq: number;
  type: EntryType;
  payload: string;
  created_at: string;
}

function parseEntryRow(row: EntryRow): Entry {
  const extra = JSON.parse(row.payload);
  return {
    id: row.id,
    sessionId: row.session_id,
    parentId: row.parent_id,
    seq: row.seq,
    type: row.type,
    createdAt: row.created_at,
    ...extra,
  } as Entry;
}

/**
 * Appends entries to a session with strictly monotonically increasing sequence numbers.
 * No UPDATE/DELETE functions are provided to enforce append-only invariants.
 */
export async function appendEntries(
  sessionId: string,
  newEntries: Omit<Entry, 'seq'>[],
  dbOverride?: SqlDatabase,
): Promise<Entry[]> {
  if (newEntries.length === 0) return [];

  const db = dbOverride ?? (await getDatabase());

  // Determine current max seq for this session
  const maxSeqRows = await db.select<{ max_seq: number | null }[]>(
    'SELECT MAX(seq) as max_seq FROM entries WHERE session_id = ?',
    [sessionId],
  );

  let currentSeq = maxSeqRows[0]?.max_seq ?? 0;
  const appended: Entry[] = [];

  for (const item of newEntries) {
    currentSeq += 1;
    const { id, sessionId: sid, parentId, type, createdAt, ...payloadData } = item;

    await db.execute(
      'INSERT INTO entries (id, session_id, parent_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        sid,
        parentId ?? null,
        currentSeq,
        type,
        JSON.stringify(payloadData),
        createdAt,
      ],
    );

    appended.push({
      ...item,
      seq: currentSeq,
    } as Entry);
  }

  return appended;
}

/**
 * Retrieves all entries for a session ordered by seq ascending.
 */
export async function getEntries(
  sessionId: string,
  dbOverride?: SqlDatabase,
): Promise<Entry[]> {
  const db = dbOverride ?? (await getDatabase());
  const rows = await db.select<EntryRow[]>(
    'SELECT id, session_id, parent_id, seq, type, payload, created_at FROM entries WHERE session_id = ? ORDER BY seq ASC',
    [sessionId],
  );

  return rows.map(parseEntryRow);
}

/**
 * Retrieves the most recent compaction entry for a session, or null if none exists.
 */
export async function getLastCompaction(
  sessionId: string,
  dbOverride?: SqlDatabase,
): Promise<CompactionEntry | null> {
  const db = dbOverride ?? (await getDatabase());
  const rows = await db.select<EntryRow[]>(
    "SELECT id, session_id, parent_id, seq, type, payload, created_at FROM entries WHERE session_id = ? AND type = 'compaction' ORDER BY seq DESC LIMIT 1",
    [sessionId],
  );

  if (rows.length === 0) return null;
  return parseEntryRow(rows[0]) as CompactionEntry;
}

/**
 * Deletes all entries for a session when clearing chat or removing session.
 */
export async function deleteEntriesForSession(
  sessionId: string,
  dbOverride?: SqlDatabase,
): Promise<void> {
  const db = dbOverride ?? (await getDatabase());
  await db.execute('DELETE FROM entries WHERE session_id = ?', [sessionId]);
}

/** Returns the number of entries stored for a session (0 = empty / not yet started). */
export async function countEntries(
  sessionId: string,
  dbOverride?: SqlDatabase,
): Promise<number> {
  const db = dbOverride ?? (await getDatabase());
  const rows = await db.select<{ n: number }[]>(
    'SELECT COUNT(*) as n FROM entries WHERE session_id = ?',
    [sessionId],
  );
  return rows[0]?.n ?? 0;
}
