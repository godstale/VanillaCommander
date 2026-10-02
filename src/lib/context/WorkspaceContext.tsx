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

const TRUST_STORAGE_KEY = 'vanilla-commander_trusted_workspaces';

/** 마지막으로 Rust에 동기화한 허용 루트 (D1, 프롬프트 표시용). */
let lastAllowedRoots: string[] = [];

export function getLastAllowedRoots(): string[] {
  return [...lastAllowedRoots];
}

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

const RECENT_WORKSPACES_KEY = 'vanilla-commander_recent_workspaces';

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

export interface WorkFolderLayout {
  workFolder: string;
  wikiDir: string;
  inboxDir: string;
  backupDir: string;
  configDir: string;
  skillsDir: string;
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
  /** 작업 폴더 (D2, P11-04). null이면 workspaceRoot를 그대로 쓴다. */
  workFolder: string | null;
  /** 작업 폴더 변경 + 레이아웃 생성 + 허용 루트 동기화. busy면 false. */
  setWorkFolder: (folder: string | null) => Promise<boolean>;
  /** 현재 작업 폴더에 wiki/wiki-inbox/backup/config/skills를 만든다. */
  ensureWorkFolderLayout: () => Promise<WorkFolderLayout | null>;
  /**
   * `@` 참조 경로를 허용 루트에 세션 한정으로 추가한다 (D1, P11-16).
   * 폴더 변경 시 초기화된다.
   */
  addSessionRoots: (paths: string[]) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaceRoot, setWorkspaceRootState] = useState<string | null>(() => {
    return localStorage.getItem('vanilla-commander_current_workspace_root');
  });
  const workspaceRootRef = useRef<string | null>(workspaceRoot);
  useEffect(() => {
    workspaceRootRef.current = workspaceRoot;
  }, [workspaceRoot]);

  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(getStoredRecentWorkspaces);

  const [workFolder, setWorkFolderState] = useState<string | null>(null);
  const workFolderRef = useRef<string | null>(null);
  useEffect(() => {
    workFolderRef.current = workFolder;
  }, [workFolder]);

  const sessionRootsRef = useRef<string[]>([]);

  /** 에이전트 허용 루트(작업 폴더 + 등록 폴더)를 Rust에 동기화한다 (D1). */
  const pushAllowedRoots = useCallback(async (extraRoots: string[]) => {
    try {
      const settings = await settingsRepo.getSettings();
      const roots = Array.from(
        new Set(
          [...extraRoots, ...(settings.agentAllowedRoots ?? []), ...sessionRootsRef.current].filter(
            (r): r is string => typeof r === 'string' && r.length > 0,
          ),
        ),
      );
      if (roots.length > 0) {
        await invoke('set_agent_allowed_roots', { roots });
        lastAllowedRoots = roots;
      }
    } catch {
      // ignore in non-Tauri
    }
  }, []);

  const addSessionRoots = useCallback((paths: string[]) => {
    const next = Array.from(
      new Set(
        [...sessionRootsRef.current, ...paths].filter(
          (p): p is string => typeof p === 'string' && p.length > 0,
        ),
      ),
    );
    sessionRootsRef.current = next;
    void pushAllowedRoots(next);
  }, [pushAllowedRoots]);

  const [trustModalOpen, setTrustModalOpen] = useState<boolean>(() => {
    const initialRoot = localStorage.getItem('vanilla-commander_current_workspace_root');
    if (!initialRoot) return false;
    const map = getStoredTrustMap();
    return map[initialRoot] === undefined;
  });

  const [isTrusted, setIsTrusted] = useState<boolean>(() => {
    const initialRoot = localStorage.getItem('vanilla-commander_current_workspace_root');
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
          localStorage.setItem('vanilla-commander_current_workspace_root', settings.lastWorkspaceRoot);
        } else if (workspaceRoot) {
          setActiveWorkspaceRoot(workspaceRoot);
        }
        if (settings.workFolder) {
          setWorkFolderState(settings.workFolder);
        }
        void pushAllowedRoots(
          [settings.workFolder, workspaceRoot, settings.lastWorkspaceRoot].filter(
            (r): r is string => typeof r === 'string' && r.length > 0,
          ),
        );

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
  }, [workspaceRoot, pushAllowedRoots]);

  const setWorkspaceRoot = useCallback((root: string | null) => {
    if (root !== workspaceRootRef.current && chatQueueManager.getBusySessionId() !== null) {
      console.warn('Workspace change blocked: LLM session is running.');
      return false;
    }
    // 폴더가 바뀌면 세션 한정 루트를 초기화한다.
    sessionRootsRef.current = [];
    setActiveWorkspaceRoot(root);
    setWorkspaceRootState(root);
    void pushAllowedRoots(
      [workFolderRef.current, root].filter(
        (r): r is string => typeof r === 'string' && r.length > 0,
      ),
    );
    if (root) {
      localStorage.setItem('vanilla-commander_current_workspace_root', root);
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
      localStorage.removeItem('vanilla-commander_current_workspace_root');
      setIsTrusted(false);
      setTrustModalOpen(false);
      void settingsRepo.updateSettings({ lastWorkspaceRoot: null });
    }
    return true;
  }, [pushAllowedRoots]);

  const ensureWorkFolderLayout = useCallback(async (): Promise<WorkFolderLayout | null> => {
    const folder = workFolderRef.current ?? workspaceRootRef.current;
    if (!folder) return null;
    try {
      return await invoke<WorkFolderLayout>('ensure_work_folder_layout', {
        workFolder: folder,
      });
    } catch {
      // ignore in non-Tauri
      return null;
    }
  }, []);

  const setWorkFolder = useCallback(async (folder: string | null): Promise<boolean> => {
    if (folder !== workFolderRef.current && chatQueueManager.getBusySessionId() !== null) {
      console.warn('Work folder change blocked: LLM session is running.');
      return false;
    }
    // 폴더가 바뀌면 세션 한정 루트를 초기화한다.
    sessionRootsRef.current = [];
    if (folder) {
      try {
        await invoke('ensure_work_folder_layout', { workFolder: folder });
      } catch {
        // ignore in non-Tauri (DB 저장은 계속한다)
      }
      setWorkFolderState(folder);
      workFolderRef.current = folder;
      try {
        await settingsRepo.updateSettings({ workFolder: folder });
      } catch {
        // ignore
      }
    } else {
      setWorkFolderState(null);
      workFolderRef.current = null;
      try {
        await settingsRepo.updateSettings({ workFolder: null });
      } catch {
        // ignore
      }
    }
    void pushAllowedRoots(
      [folder].filter((r): r is string => typeof r === 'string' && r.length > 0),
    );
    return true;
  }, [pushAllowedRoots]);

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
      workFolder,
      setWorkFolder,
      ensureWorkFolderLayout,
      addSessionRoots,
    }),
    [
      workspaceRoot,
      setWorkspaceRoot,
      recentWorkspaces,
      isTrusted,
      trustModalOpen,
      trustCurrentWorkspace,
      rejectCurrentWorkspace,
      workFolder,
      setWorkFolder,
      ensureWorkFolderLayout,
      addSessionRoots,
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
