// P11-40: localStorage 매크로 → DB 1회 이관.
import { loadChatMacros, CHAT_MACRO_STORAGE_KEY } from './chatMacros';
import { buildMacroName } from './types';
import { createMacro, listMacros } from './macrosRepo';

const MIGRATED_FLAG = 'vanilla-commander:macros-migrated';

/** 이관済이면 0을 반환한다. 반환값은 새로 만든 매크로 수다. */
export async function migrateLocalStorageMacrosOnce(
  workspaceRoot?: string | null,
): Promise<number> {
  try {
    if (window.localStorage.getItem(MIGRATED_FLAG) === '1') return 0;
  } catch {
    return 0;
  }
  const legacy = loadChatMacros();
  let created = 0;
  if (legacy.length > 0) {
    const existing = await listMacros(workspaceRoot);
    const names = existing.map((m) => m.name);
    for (const item of legacy) {
      const prompts = item.items.map((s) => s.trim()).filter((s) => s.length > 0);
      if (prompts.length === 0) continue;
      const name = buildMacroName(prompts, names);
      names.push(name);
      await createMacro(
        {
          name,
          prompts,
          agentId: item.agentId ?? null,
          runRoot: '',
          schedule: { kind: 'none' },
        },
        workspaceRoot,
      );
      created++;
    }
  }
  try {
    window.localStorage.setItem(MIGRATED_FLAG, '1');
    window.localStorage.removeItem(CHAT_MACRO_STORAGE_KEY);
  } catch {
    // ignore quota errors
  }
  return created;
}
