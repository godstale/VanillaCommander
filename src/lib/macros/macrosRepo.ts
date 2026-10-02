import { getDatabase } from '@/lib/db/client';
import {
  parseSchedule,
  type Macro,
  type MacroDraft,
} from './types';

interface DbMacroRow {
  id: string;
  name: string;
  prompts_json: string;
  agent_id: string | null;
  run_root: string;
  schedule_json: string;
  last_result: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

function parsePrompts(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string')
      : [];
  } catch {
    return [];
  }
}

function mapRowToMacro(row: DbMacroRow): Macro {
  let schedule;
  try {
    schedule = parseSchedule(JSON.parse(row.schedule_json));
  } catch {
    schedule = parseSchedule(null);
  }
  return {
    id: row.id,
    name: row.name,
    prompts: parsePrompts(row.prompts_json),
    agentId: row.agent_id ?? null,
    runRoot: row.run_root ?? '',
    schedule,
    lastResult: row.last_result ?? null,
    lastRunAt: row.last_run_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function listMacros(workspaceRoot?: string | null): Promise<Macro[]> {
  const db = await getDatabase(workspaceRoot);
  const rows = await db.select<DbMacroRow[]>(
    'SELECT * FROM macros ORDER BY updated_at DESC',
  );
  return rows.map(mapRowToMacro);
}

export async function getMacro(
  id: string,
  workspaceRoot?: string | null,
): Promise<Macro | null> {
  const db = await getDatabase(workspaceRoot);
  const rows = await db.select<DbMacroRow[]>('SELECT * FROM macros WHERE id = ?', [id]);
  return rows.length > 0 ? mapRowToMacro(rows[0]) : null;
}

export async function createMacro(
  draft: MacroDraft,
  workspaceRoot?: string | null,
): Promise<Macro> {
  const db = await getDatabase(workspaceRoot);
  const now = nowIso();
  const macro: Macro = {
    id: crypto.randomUUID(),
    name: draft.name.trim(),
    prompts: draft.prompts.map((s) => s.trim()).filter((s) => s.length > 0),
    agentId: draft.agentId,
    runRoot: draft.runRoot.trim(),
    schedule: draft.schedule,
    lastResult: null,
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.execute(
    'INSERT INTO macros (id, name, prompts_json, agent_id, run_root, schedule_json, last_result, last_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      macro.id,
      macro.name,
      JSON.stringify(macro.prompts),
      macro.agentId,
      macro.runRoot,
      JSON.stringify(macro.schedule),
      macro.lastResult,
      macro.lastRunAt,
      macro.createdAt,
      macro.updatedAt,
    ],
  );
  return macro;
}

export async function updateMacro(
  id: string,
  patch: Partial<MacroDraft & Pick<Macro, 'lastResult' | 'lastRunAt'>>,
  workspaceRoot?: string | null,
): Promise<Macro | null> {
  const current = await getMacro(id, workspaceRoot);
  if (!current) return null;
  const next: Macro = {
    ...current,
    name: patch.name !== undefined ? patch.name.trim() : current.name,
    prompts:
      patch.prompts !== undefined
        ? patch.prompts.map((s) => s.trim()).filter((s) => s.length > 0)
        : current.prompts,
    agentId: patch.agentId !== undefined ? patch.agentId : current.agentId,
    runRoot: patch.runRoot !== undefined ? patch.runRoot.trim() : current.runRoot,
    schedule: patch.schedule !== undefined ? patch.schedule : current.schedule,
    lastResult: patch.lastResult !== undefined ? patch.lastResult : current.lastResult,
    lastRunAt: patch.lastRunAt !== undefined ? patch.lastRunAt : current.lastRunAt,
    updatedAt: nowIso(),
  };
  const db = await getDatabase(workspaceRoot);
  await db.execute(
    'UPDATE macros SET name = ?, prompts_json = ?, agent_id = ?, run_root = ?, schedule_json = ?, last_result = ?, last_run_at = ?, updated_at = ? WHERE id = ?',
    [
      next.name,
      JSON.stringify(next.prompts),
      next.agentId,
      next.runRoot,
      JSON.stringify(next.schedule),
      next.lastResult,
      next.lastRunAt,
      next.updatedAt,
      id,
    ],
  );
  return next;
}

export async function deleteMacro(
  id: string,
  workspaceRoot?: string | null,
): Promise<void> {
  const db = await getDatabase(workspaceRoot);
  await db.execute('DELETE FROM macros WHERE id = ?', [id]);
}
