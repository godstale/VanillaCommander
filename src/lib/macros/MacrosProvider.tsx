// P11-40: 매크로 저장소 컨텍스트. 첫 마운트 시 localStorage 1회 이관.
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import {
  createMacro as repoCreate,
  deleteMacro as repoDelete,
  listMacros as repoList,
  updateMacro as repoUpdate,
} from './macrosRepo';
import type { Macro, MacroDraft } from './types';
import { migrateLocalStorageMacrosOnce } from './migrate';
import { MacrosContext } from './macrosContext';

export function MacrosProvider({ children }: { children: React.ReactNode }) {
  const workspace = useSafeWorkspace();
  const workspaceRoot = workspace?.workspaceRoot ?? null;
  const [macros, setMacros] = useState<Macro[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMacros(await repoList(workspaceRoot));
    } catch (err) {
      console.error('Failed to load macros:', err);
    } finally {
      setLoading(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await migrateLocalStorageMacrosOnce(workspaceRoot);
      } catch (err) {
        console.error('Failed to migrate legacy macros:', err);
      }
      if (!cancelled) void refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, refresh]);

  const create = useCallback(async (draft: MacroDraft) => {
    const created = await repoCreate(draft, workspace?.workspaceRoot ?? null);
    setMacros((prev) => [created, ...prev.filter((m) => m.id !== created.id)]);
    return created;
  }, [workspace]);

  const update = useCallback(async (id: string, patch: Partial<MacroDraft>) => {
    const updated = await repoUpdate(id, patch, workspace?.workspaceRoot ?? null);
    if (updated) {
      setMacros((prev) => prev.map((m) => (m.id === id ? updated : m)));
    }
    return updated;
  }, [workspace]);

  const remove = useCallback(async (id: string) => {
    await repoDelete(id, workspace?.workspaceRoot ?? null);
    setMacros((prev) => prev.filter((m) => m.id !== id));
  }, [workspace]);

  const value = useMemo(
    () => ({ macros, loading, refresh, create, update, remove }),
    [macros, loading, refresh, create, update, remove],
  );
  return <MacrosContext.Provider value={value}>{children}</MacrosContext.Provider>;
}
