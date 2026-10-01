import { getDatabase, getGlobalDatabase, type SqlDatabase } from '@/lib/db/client';
import type { ChatSession } from '@/lib/types/chat';
import { DEFAULT_AGENT } from '@/lib/agent/defaultAgent';

interface SessionRow {
  id: string;
  agent_id: string;
  workspace_root: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

function parseSessionRow(row: SessionRow): ChatSession {
  return {
    id: row.id,
    agentId: row.agent_id,
    workspaceRoot: row.workspace_root,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSessions(
  dbOverride?: SqlDatabase,
): Promise<ChatSession[]> {
  const db = dbOverride ?? (await getDatabase());
  const rows = await db.select<SessionRow[]>(
    'SELECT * FROM sessions ORDER BY updated_at DESC',
  );
  return rows.map(parseSessionRow);
}

export async function getSession(
  id: string,
  dbOverride?: SqlDatabase,
): Promise<ChatSession | null> {
  const db = dbOverride ?? (await getDatabase());
  const rows = await db.select<SessionRow[]>(
    'SELECT * FROM sessions WHERE id = ?',
    [id],
  );
  if (rows.length === 0) return null;
  return parseSessionRow(rows[0]);
}

export async function createSession(
  session: Omit<ChatSession, 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
    updatedAt?: string;
  },
  dbOverride?: SqlDatabase,
): Promise<ChatSession> {
  const db = dbOverride ?? (await getDatabase(session.workspaceRoot));
  const now = new Date().toISOString();
  const createdAt = session.createdAt || now;
  const updatedAt = session.updatedAt || now;

  // 프로젝트 DB와 전역 DB 분리로 인해 대상 DB에 agent_id가 없는 경우,
  // 외래 키 제약조건(REFERENCES agents(id)) 위반을 방지하기 위해 전역 DB에서 에이전트를 조회하여 복사(동기화)
  try {
    const existingAgent = await db.select<{ id: string }[]>(
      'SELECT id FROM agents WHERE id = ?',
      [session.agentId],
    );
    if (existingAgent.length === 0) {
      const globalDb = await getGlobalDatabase();
      const globalAgents = await globalDb.select<{
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
        is_default: number;
        created_at: string;
        updated_at: string;
      }[]>('SELECT * FROM agents WHERE id = ?', [session.agentId]);

      if (globalAgents.length > 0) {
        const ag = globalAgents[0];
        await db.execute(
          `INSERT OR IGNORE INTO agents (
            id, name, description, system_prompt, model, temperature,
            context_size, reserve_tokens, keep_recent_tokens, enabled_skills,
            enabled_builtin_tools, approval_mode, is_default, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ag.id,
            ag.name,
            ag.description,
            ag.system_prompt,
            ag.model,
            ag.temperature,
            ag.context_size,
            ag.reserve_tokens,
            ag.keep_recent_tokens,
            ag.enabled_skills,
            ag.enabled_builtin_tools,
            ag.approval_mode,
            ag.is_default,
            ag.created_at,
            ag.updated_at,
          ],
        );
      } else {
        const fallbackAg = DEFAULT_AGENT;
        await db.execute(
          `INSERT OR IGNORE INTO agents (
            id, name, description, system_prompt, model, temperature,
            context_size, reserve_tokens, keep_recent_tokens, enabled_skills,
            enabled_builtin_tools, approval_mode, is_default, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            fallbackAg.id,
            fallbackAg.name,
            fallbackAg.description ?? null,
            fallbackAg.systemPrompt,
            fallbackAg.model,
            fallbackAg.temperature,
            fallbackAg.contextSize,
            fallbackAg.reserveTokens,
            fallbackAg.keepRecentTokens,
            JSON.stringify(fallbackAg.enabledSkills),
            JSON.stringify(fallbackAg.enabledBuiltinTools),
            fallbackAg.approvalMode,
            1,
            now,
            now,
          ],
        );
      }
    }
  } catch (err) {
    console.warn('Agent auto-sync to project database skipped:', err);
  }

  await db.execute(
    'INSERT INTO sessions (id, agent_id, workspace_root, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [
      session.id,
      session.agentId,
      session.workspaceRoot ?? null,
      session.title,
      createdAt,
      updatedAt,
    ],
  );

  return {
    id: session.id,
    agentId: session.agentId,
    workspaceRoot: session.workspaceRoot ?? null,
    title: session.title,
    createdAt,
    updatedAt,
  };
}

export async function updateSession(
  id: string,
  updates: Partial<Pick<ChatSession, 'title' | 'workspaceRoot' | 'agentId'>>,
  dbOverride?: SqlDatabase,
): Promise<ChatSession> {
  const db = dbOverride ?? (await getDatabase());
  const existing = await getSession(id, db);
  if (!existing) {
    throw new Error(`Session with id "${id}" not found.`);
  }

  const now = new Date().toISOString();
  const merged: ChatSession = {
    ...existing,
    ...updates,
    updatedAt: now,
  };

  await db.execute(
    'UPDATE sessions SET agent_id = ?, workspace_root = ?, title = ?, updated_at = ? WHERE id = ?',
    [
      merged.agentId,
      merged.workspaceRoot ?? null,
      merged.title,
      merged.updatedAt,
      id,
    ],
  );

  return merged;
}

export async function deleteSession(
  id: string,
  dbOverride?: SqlDatabase,
): Promise<void> {
  const db = dbOverride ?? (await getDatabase());
  // Cascade delete entries
  await db.execute('DELETE FROM entries WHERE session_id = ?', [id]);
  await db.execute('DELETE FROM sessions WHERE id = ?', [id]);
}
