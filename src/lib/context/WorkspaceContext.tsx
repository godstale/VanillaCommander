import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import * as settingsRepo from '@/lib/db/repositories/settingsRepo';
import { setActiveWorkspaceRoot } from '@/lib/db/client';
import { chatQueueManager } from '@/lib/agent/chatQueueManager';

const TRUST_STORAGE_KEY = 'fortress_trusted_workspaces';

function getStoredTrustMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(TRUST_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveTrustMap(map: Record<string, boolean>): void {
  try {
    localStorage.setItem(TRUST_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

const RECENT_WORKSPACES_KEY = 'fortress_recent_workspaces';

function getStoredRecentWorkspaces(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_WORKSPACES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecentWorkspaces(list: string[]): void {
  try {
    localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(list.slice(0, 10)));
  } catch {
    // ignore
  }
}

export interface WorkspaceContextValue {
  workspaceRoot: string | null;
  /**
   * 워크스페이스 변경. LLM 추론/대기 큐가 진행 중이면 변경을 거부하고 false를 반환한다.
   * 동일 값으로의 호출(멱등)은 허용하고 true를 반환한다.
   */
  setWorkspaceRoot: (root: string | null) => boolean;
  recentWorkspaces: string[];
  isTrusted: boolean;
  trustModalOpen: boolean;
  setTrustModalOpen: (open: boolean) => void;
  trustCurrentWorkspace: () => void;
  rejectCurrentWorkspace: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaceRoot, setWorkspaceRootState] = useState<string | null>(() => {
    return localStorage.getItem('fortress_current_workspace_root');
  });
  const workspaceRootRef = useRef<string | null>(workspaceRoot);
  useEffect(() => {
    workspaceRootRef.current = workspaceRoot;
  }, [workspaceRoot]);

  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(getStoredRecentWorkspaces);

  const [trustModalOpen, setTrustModalOpen] = useState<boolean>(() => {
    const initialRoot = localStorage.getItem('fortress_current_workspace_root');
    if (!initialRoot) return false;
    const map = getStoredTrustMap();
    return map[initialRoot] === undefined;
  });

  const [isTrusted, setIsTrusted] = useState<boolean>(() => {
    const initialRoot = localStorage.getItem('fortress_current_workspace_root');
    if (!initialRoot) return false;
    const map = getStoredTrustMap();
    return Boolean(map[initialRoot]);
  });

  // Load and sync from app_settings (P4-05 migration from localStorage)
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const settings = await settingsRepo.getSettings();
        if (!active) return;

        // If no workspaceRoot is currently selected, restore last used workspace
        if (!workspaceRoot && settings.lastWorkspaceRoot) {
          setActiveWorkspaceRoot(settings.lastWorkspaceRoot);
          setWorkspaceRootState(settings.lastWorkspaceRoot);
          localStorage.setItem('fortress_current_workspace_root', settings.lastWorkspaceRoot);
          try {
            await invoke('set_active_workspace', { path: settings.lastWorkspaceRoot });
          } catch {
            // ignore in non-Tauri
          }
        } else if (workspaceRoot) {
          setActiveWorkspaceRoot(workspaceRoot);
          try {
            await invoke('set_active_workspace', { path: workspaceRoot });
          } catch {
            // ignore in non-Tauri
          }
        }

        if (settings.trustedWorkspaces) {
          const map = getStoredTrustMap();
          let changed = false;
          for (const ws of settings.trustedWorkspaces) {
            if (!map[ws]) {
              map[ws] = true;
              changed = true;
            }
          }
          if (changed) {
            saveTrustMap(map);
          }
          const targetRoot = workspaceRoot || settings.lastWorkspaceRoot;
          if (targetRoot && settings.trustedWorkspaces.includes(targetRoot)) {
            setIsTrusted(true);
            setTrustModalOpen(false);
          }
        }
      } catch (err) {
        console.error('Failed to sync trusted workspaces from app_settings:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, [workspaceRoot]);

  const setWorkspaceRoot = useCallback((root: string | null) => {
    if (root !== workspaceRootRef.current && chatQueueManager.getBusySessionId() !== null) {
      console.warn('Workspace change blocked: LLM session is running.');
      return false;
    }
    setActiveWorkspaceRoot(root);
    setWorkspaceRootState(root);
    try {
      void invoke('set_active_workspace', { path: root });
    } catch {
      // ignore in non-Tauri
    }
    if (root) {
      localStorage.setItem('fortress_current_workspace_root', root);
      setRecentWorkspaces((prev) => {
        const next = [root, ...prev.filter((p) => p !== root)].slice(0, 10);
        saveRecentWorkspaces(next);
        return next;
      });

      const map = getStoredTrustMap();
      if (map[root] !== undefined) {
        setIsTrusted(map[root]);
        setTrustModalOpen(false);
      } else {
        setIsTrusted(false);
        setTrustModalOpen(true);
      }
      void settingsRepo.updateSettings({ lastWorkspaceRoot: root });
    } else {
      localStorage.removeItem('fortress_current_workspace_root');
      setIsTrusted(false);
      setTrustModalOpen(false);
      void settingsRepo.updateSettings({ lastWorkspaceRoot: null });
    }
    return true;
  }, []);

  const trustCurrentWorkspace = useCallback(() => {
    if (!workspaceRoot) return;
    const map = getStoredTrustMap();
    map[workspaceRoot] = true;
    saveTrustMap(map);
    setIsTrusted(true);
    setTrustModalOpen(false);

    // Sync to SQLite app_settings
    void (async () => {
      try {
        const current = await settingsRepo.getSettings();
        const next = Array.from(new Set([...current.trustedWorkspaces, workspaceRoot]));
        await settingsRepo.updateSettings({ trustedWorkspaces: next });
      } catch {
        // ignore
      }
    })();
  }, [workspaceRoot]);

  const rejectCurrentWorkspace = useCallback(() => {
    if (!workspaceRoot) return;
    const map = getStoredTrustMap();
    map[workspaceRoot] = false;
    saveTrustMap(map);
    setIsTrusted(false);
    setTrustModalOpen(false);

    // Sync to SQLite app_settings
    void (async () => {
      try {
        const current = await settingsRepo.getSettings();
        const next = current.trustedWorkspaces.filter((w) => w !== workspaceRoot);
        await settingsRepo.updateSettings({ trustedWorkspaces: next });
      } catch {
        // ignore
      }
    })();
  }, [workspaceRoot]);

  const value = useMemo(
    () => ({
      workspaceRoot,
      setWorkspaceRoot,
      recentWorkspaces,
      isTrusted,
      trustModalOpen,
      setTrustModalOpen,
      trustCurrentWorkspace,
      rejectCurrentWorkspace,
    }),
    [
      workspaceRoot,
      setWorkspaceRoot,
      recentWorkspaces,
      isTrusted,
      trustModalOpen,
      trustCurrentWorkspace,
      rejectCurrentWorkspace,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return ctx;
}

export function useSafeWorkspace(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}
