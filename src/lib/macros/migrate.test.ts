import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { migrateLocalStorageMacrosOnce } from './migrate';
import { CHAT_MACRO_STORAGE_KEY } from './chatMacros';
import { listMacros } from './macrosRepo';

describe('migrateLocalStorageMacrosOnce', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('imports legacy macros once and clears the old key', async () => {
    window.localStorage.setItem(
      CHAT_MACRO_STORAGE_KEY,
      JSON.stringify([
        { id: 'm1', name: 'Old', createdAt: new Date().toISOString(), items: ['a', 'b'] },
        { id: 'm2', name: 'Empty', createdAt: new Date().toISOString(), items: ['  '] },
      ]),
    );
    expect(await migrateLocalStorageMacrosOnce()).toBe(1);
    expect(window.localStorage.getItem(CHAT_MACRO_STORAGE_KEY)).toBeNull();
    const macros = await listMacros();
    expect(macros).toHaveLength(1);
    expect(macros[0].prompts).toEqual(['a', 'b']);
    expect(macros[0].schedule).toEqual({ kind: 'none' });

    // 두 번째 호출은 0을 반환한다.
    expect(await migrateLocalStorageMacrosOnce()).toBe(0);
  });

  it('does nothing when there is nothing to migrate', async () => {
    expect(await migrateLocalStorageMacrosOnce()).toBe(0);
  });
});
