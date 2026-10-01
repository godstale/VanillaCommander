import { getDatabase, type SqlDatabase } from '@/lib/db/client';
import type { LogEntry, LogLevel, LogCategory } from '@/lib/logger/logger';

interface LogRow {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details: string | null;
  session_id: string | null;
  agent_id: string | null;
}

export const DEFAULT_MAX_LOGS = 3000;
export const DEFAULT_MAX_LOG_AGE_DAYS = 14;
const LOG_PRUNE_FREQUENCY = 50;
let logSaveCounter = 0;

export async function insertLogEntry(
  entry: LogEntry,
  dbOverride?: SqlDatabase,
): Promise<void> {
  const db = dbOverride ?? (await getDatabase());
  const serializedDetails =
    entry.details !== undefined ? JSON.stringify(entry.details) : null;
  await db.execute(
    'INSERT INTO execution_logs (id, timestamp, level, category, message, details, session_id, agent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      entry.id,
      entry.timestamp,
      entry.level,
      entry.category,
      entry.message,
      serializedDetails,
      entry.sessionId ?? null,
      entry.agentId ?? null,
    ],
  );

  // Periodic automatic pruning to prevent unlimited DB bloat
  logSaveCounter++;
  if (logSaveCounter % LOG_PRUNE_FREQUENCY === 0) {
    void pruneOldLogs({}, db).catch((err) => {
      console.warn('Auto-pruning execution logs failed:', err);
    });
  }
}

export async function getLogs(
  options: { sessionId?: string; agentId?: string; limit?: number } = {},
  dbOverride?: SqlDatabase,
): Promise<LogEntry[]> {
  const db = dbOverride ?? (await getDatabase());
  let rows: LogRow[];

  const limitClause = options.limit ? ` LIMIT ${options.limit}` : '';

  if (options.sessionId && options.agentId) {
    rows = await db.select<LogRow[]>(
      `SELECT id, timestamp, level, category, message, details, session_id, agent_id FROM execution_logs WHERE session_id = ? AND agent_id = ? ORDER BY timestamp ASC${limitClause}`,
      [options.sessionId, options.agentId],
    );
  } else if (options.sessionId) {
    rows = await db.select<LogRow[]>(
      `SELECT id, timestamp, level, category, message, details, session_id, agent_id FROM execution_logs WHERE session_id = ? ORDER BY timestamp ASC${limitClause}`,
      [options.sessionId],
    );
  } else if (options.agentId) {
    rows = await db.select<LogRow[]>(
      `SELECT id, timestamp, level, category, message, details, session_id, agent_id FROM execution_logs WHERE agent_id = ? ORDER BY timestamp ASC${limitClause}`,
      [options.agentId],
    );
  } else {
    rows = await db.select<LogRow[]>(
      `SELECT id, timestamp, level, category, message, details, session_id, agent_id FROM execution_logs ORDER BY timestamp ASC${limitClause}`,
    );
  }

  return rows.map((r) => {
    let parsedDetails: unknown = undefined;
    if (r.details) {
      try {
        parsedDetails = JSON.parse(r.details);
      } catch {
        parsedDetails = r.details;
      }
    }
    return {
      id: r.id,
      timestamp: r.timestamp,
      level: r.level,
      category: r.category,
      message: r.message,
      details: parsedDetails,
      sessionId: r.session_id ?? undefined,
      agentId: r.agent_id ?? undefined,
    };
  });
}

export async function clearLogs(
  sessionId?: string,
  dbOverride?: SqlDatabase,
  agentId?: string,
): Promise<void> {
  const db = dbOverride ?? (await getDatabase());
  if (sessionId && agentId) {
    await db.execute(
      'DELETE FROM execution_logs WHERE session_id = ? AND agent_id = ?',
      [sessionId, agentId],
    );
  } else if (sessionId) {
    await db.execute('DELETE FROM execution_logs WHERE session_id = ?', [
      sessionId,
    ]);
  } else if (agentId) {
    await db.execute('DELETE FROM execution_logs WHERE agent_id = ?', [agentId]);
  } else {
    await db.execute('DELETE FROM execution_logs');
  }
}

export async function pruneOldLogs(
  options: { maxKeep?: number; maxAgeDays?: number } = {},
  dbOverride?: SqlDatabase,
): Promise<number> {
  const db = dbOverride ?? (await getDatabase());
  const maxKeep = options.maxKeep ?? DEFAULT_MAX_LOGS;
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_LOG_AGE_DAYS;
  const cutoffTime = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

  let affected = 0;

  // 1. Delete logs older than maxAgeDays
  try {
    const ageRes = await db.execute(
      'DELETE FROM execution_logs WHERE timestamp < ?',
      [cutoffTime],
    );
    affected += ageRes.rowsAffected ?? 0;
  } catch (err) {
    console.warn('Failed to prune execution logs by age:', err);
  }

  // 2. Keep at most maxKeep total logs
  try {
    const countRes = await db.execute(
      `DELETE FROM execution_logs
       WHERE id NOT IN (
         SELECT id FROM execution_logs
         ORDER BY timestamp DESC
         LIMIT ?
       )`,
      [maxKeep],
    );
    affected += countRes.rowsAffected ?? 0;
  } catch (err) {
    console.warn('Failed to prune execution logs by count limit:', err);
  }

  return affected;
}
