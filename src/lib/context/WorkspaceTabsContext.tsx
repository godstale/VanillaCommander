import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  useEffect,
  useRef,
} from 'react';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import * as settingsRepo from '@/lib/db/repositories/settingsRepo';
import { useSafeWorkspace } from './WorkspaceContext';

export interface WorkspaceTabsContextValue {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  secondaryActiveTabId: string | null;
  splitDirection: 'horizontal' | 'vertical';
  isSplit: boolean;
  openTab: (
    tab: Omit<WorkspaceTab, 'id'> & { id?: string },
    pane?: 'primary' | 'secondary',
  ) => string;
  closeTab: (id: string) => void;
  closeTabs: (ids: string[]) => void;
  closeAllTabs: (pane?: 'primary' | 'secondary') => void;
  setActiveTab: (id: string) => void;
  setSecondaryActiveTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<Omit<WorkspaceTab, 'id'>>) => void;
  moveTab: (fromIndex: number, toIndex: number, pane?: 'primary' | 'secondary') => void;
  moveTabToPane: (
    tabId: string,
    targetPane: 'primary' | 'secondary',
    targetIndex?: number,
  ) => void;
  splitTab: (
    tabId: string,
    direction: 'horizontal' | 'vertical',
    side: 'left' | 'right' | 'top' | 'bottom',
  ) => void;
  closeSplit: () => void;
  setSplitDirection: (dir: 'horizontal' | 'vertical') => void;
  isTabsLoaded: boolean;
}

const WorkspaceTabsContext = createContext<
  WorkspaceTabsContextValue | undefined
>(undefined);

let tabCounter = 0;
function generateTabId(type: string): string {
  tabCounter += 1;
  return `${type}:${Date.now()}-${tabCounter}`;
}

export function WorkspaceTabsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const workspace = useSafeWorkspace();
  const hasWorkspaceContext = workspace !== null;
  const workspaceRoot = workspace?.workspaceRoot ?? null;

  const [internalTabs, setInternalTabs] = useState<WorkspaceTab[]>([]);
  const [internalActiveTabId, setInternalActiveTabId] = useState<string | null>(null);
  const [internalSecondaryActiveTabId, setInternalSecondaryActiveTabId] = useState<string | null>(null);
  const [splitDirection, setSplitDirection] = useState<'horizontal' | 'vertical'>('horizontal');
  const [isLoaded, setIsLoaded] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // 폴더 전환 시 이전 프로젝트의 탭이 디바운스 저장 전에 유실되지 않도록 스냅샷을 유지한다.
  const prevRootRef = useRef<string | null | undefined>(undefined);
  const tabsSnapshotRef = useRef<WorkspaceTab[]>([]);
  const activeTabSnapshotRef = useRef<string | null>(null);
  const isLoadedRef = useRef(false);

  const isWithoutWorkspace = hasWorkspaceContext && !workspaceRoot;
  const tabs = isWithoutWorkspace ? [] : internalTabs;
  const activeTabId = isWithoutWorkspace ? null : internalActiveTabId;
  const secondaryActiveTabId = isWithoutWorkspace ? null : internalSecondaryActiveTabId;

  const primaryTabs = tabs.filter((t) => (t.pane ?? 'primary') === 'primary');
  const secondaryTabs = tabs.filter((t) => t.pane === 'secondary');
  const isSplit = secondaryTabs.length > 0 && primaryTabs.length > 0;

  // Restore saved tabs from app_settings on mount
  // 프로젝트별 탭 영속화: 전환 직전에 이전 프로젝트의 탭을 해당 프로젝트 DB에 먼저
  // 플러시한 뒤 새 프로젝트의 탭을 로드한다. (디바운스 500ms 경합으로 인한 유실 방지)
  useEffect(() => {
    const prevRoot = prevRootRef.current;
    if (
      prevRoot !== undefined &&
      prevRoot !== workspaceRoot &&
      isLoadedRef.current &&
      prevRoot
    ) {
      const snapshotTabs = tabsSnapshotRef.current;
      const snapshotActive = activeTabSnapshotRef.current;
      void settingsRepo
        .saveProjectTabs(prevRoot, snapshotTabs, snapshotActive)
        .catch((err) => {
          console.error('Failed to flush workspace tabs before switch:', err);
        });
    }
    prevRootRef.current = workspaceRoot;

    let active = true;
    void (async () => {
      try {
        const settings = await settingsRepo.getSettings();
        if (active && (!hasWorkspaceContext || workspaceRoot)) {
          if (settings.openTabs && settings.openTabs.length > 0) {
            setInternalTabs(settings.openTabs);
            const savedPrimary = settings.openTabs.filter((t) => (t.pane ?? 'primary') === 'primary');
            const savedSecondary = settings.openTabs.filter((t) => t.pane === 'secondary');
            setInternalActiveTabId(
              settings.activeTabId && savedPrimary.some((t) => t.id === settings.activeTabId)
                ? settings.activeTabId
                : savedPrimary[0]?.id ?? null,
            );
            if (savedSecondary.length > 0) {
              setInternalSecondaryActiveTabId(savedSecondary[0]?.id ?? null);
            }
          } else {
            setInternalTabs((prev) => (prev.length > 0 ? prev : []));
            setInternalActiveTabId((prev) => (prev ? prev : null));
          }
        }
      } catch (err) {
        console.error('Failed to restore workspace tabs:', err);
      } finally {
        if (active) {
          setIsLoaded(true);
          isLoadedRef.current = true;
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [hasWorkspaceContext, workspaceRoot]);

  // 500ms debounced persistence to app_settings
  useEffect(() => {
    if (!isLoaded || isWithoutWorkspace) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      void settingsRepo.updateSettings({
        openTabs: internalTabs,
        activeTabId: internalActiveTabId,
      });
    }, 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [internalTabs, internalActiveTabId, isLoaded, isWithoutWorkspace]);

  // 전환 시 플러시용 스냅샷을 최신으로 유지한다.
  useEffect(() => {
    tabsSnapshotRef.current = internalTabs;
    activeTabSnapshotRef.current = internalActiveTabId;
  }, [internalTabs, internalActiveTabId]);

  const openTab = useCallback(
    (
      tab: Omit<WorkspaceTab, 'id'> & { id?: string },
      pane: 'primary' | 'secondary' = 'primary',
    ) => {
      if (hasWorkspaceContext && !workspaceRoot) {
        return '';
      }
      const targetId = tab.id ?? generateTabId(tab.type);

      setInternalTabs((prev) => {
        const existing = prev.find((t) => t.id === targetId);
        if (existing) {
          return prev;
        }
        return [...prev, { ...tab, id: targetId, pane: tab.pane ?? pane }];
      });

      if (pane === 'secondary') {
        setInternalSecondaryActiveTabId(targetId);
      } else {
        setInternalActiveTabId(targetId);
      }
      return targetId;
    },
    [hasWorkspaceContext, workspaceRoot],
  );

  const closeTab = useCallback((id: string) => {
    setInternalTabs((prev) => {
      const targetTab = prev.find((t) => t.id === id);
      const isSecondary = targetTab?.pane === 'secondary';
      const next = prev.filter((t) => t.id !== id);

      const nextPrimary = next.filter((t) => (t.pane ?? 'primary') === 'primary');
      const nextSecondary = next.filter((t) => t.pane === 'secondary');

      if (nextPrimary.length === 0 && nextSecondary.length > 0) {
        const migrated = nextSecondary.map((t) => ({ ...t, pane: 'primary' as const }));
        setInternalActiveTabId(migrated[0]?.id ?? null);
        setInternalSecondaryActiveTabId(null);
        return migrated;
      }

      if (isSecondary) {
        setInternalSecondaryActiveTabId((curr) => {
          if (curr !== id) return curr;
          const closedIdx = prev.filter((t) => t.pane === 'secondary').findIndex((t) => t.id === id);
          const fallback = nextSecondary[closedIdx] ?? nextSecondary[closedIdx - 1] ?? nextSecondary[0];
          return fallback ? fallback.id : null;
        });
      } else {
        setInternalActiveTabId((curr) => {
          if (curr !== id) return curr;
          const closedIdx = prev.filter((t) => (t.pane ?? 'primary') === 'primary').findIndex((t) => t.id === id);
          const fallback = nextPrimary[closedIdx] ?? nextPrimary[closedIdx - 1] ?? nextPrimary[0];
          return fallback ? fallback.id : null;
        });
      }

      return next;
    });
  }, []);

  const closeTabs = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setInternalTabs((prev) => {
      const next = prev.filter((t) => !idSet.has(t.id));
      const nextPrimary = next.filter((t) => (t.pane ?? 'primary') === 'primary');
      const nextSecondary = next.filter((t) => t.pane === 'secondary');

      if (nextPrimary.length === 0 && nextSecondary.length > 0) {
        const migrated = nextSecondary.map((t) => ({ ...t, pane: 'primary' as const }));
        setInternalActiveTabId(migrated[0]?.id ?? null);
        setInternalSecondaryActiveTabId(null);
        return migrated;
      }

      setInternalActiveTabId((current) => {
        if (!current || !idSet.has(current)) return current;
        return nextPrimary[0]?.id ?? null;
      });

      setInternalSecondaryActiveTabId((current) => {
        if (!current || !idSet.has(current)) return current;
        return nextSecondary[0]?.id ?? null;
      });

      return next;
    });
  }, []);

  const closeSplit = useCallback(() => {
    setInternalTabs((prev) => {
      const next = prev.map((t) => ({ ...t, pane: 'primary' as const }));
      setInternalSecondaryActiveTabId(null);
      return next;
    });
  }, []);

  const closeAllTabs = useCallback(
    (pane?: 'primary' | 'secondary') => {
      if (!pane) {
        setInternalTabs([]);
        setInternalActiveTabId(null);
        setInternalSecondaryActiveTabId(null);
      } else if (pane === 'secondary') {
        closeSplit();
      } else {
        setInternalTabs((prev) => {
          const secondary = prev.filter((t) => t.pane === 'secondary');
          const migrated = secondary.map((t) => ({ ...t, pane: 'primary' as const }));
          setInternalActiveTabId(migrated[0]?.id ?? null);
          setInternalSecondaryActiveTabId(null);
          return migrated;
        });
      }
    },
    [closeSplit],
  );

  const setActiveTab = useCallback((id: string) => {
    setInternalTabs((prev) => {
      const tab = prev.find((t) => t.id === id);
      if (tab?.pane === 'secondary') {
        setInternalSecondaryActiveTabId(id);
      } else {
        setInternalActiveTabId(id);
      }
      return prev;
    });
  }, []);

  const setSecondaryActiveTab = useCallback((id: string) => {
    setInternalSecondaryActiveTabId(id);
  }, []);

  const updateTab = useCallback(
    (id: string, patch: Partial<Omit<WorkspaceTab, 'id'>>) => {
      setInternalTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
    },
    [],
  );

  const moveTab = useCallback(
    (fromIndex: number, toIndex: number, pane: 'primary' | 'secondary' = 'primary') => {
      if (fromIndex === toIndex) return;
      setInternalTabs((prev) => {
        const paneTabs = prev.filter((t) => (t.pane ?? 'primary') === pane);
        if (
          fromIndex < 0 ||
          fromIndex >= paneTabs.length ||
          toIndex < 0 ||
          toIndex >= paneTabs.length
        ) {
          return prev;
        }
        const otherTabs = prev.filter((t) => (t.pane ?? 'primary') !== pane);
        const updatedPaneTabs = [...paneTabs];
        const [moved] = updatedPaneTabs.splice(fromIndex, 1);
        updatedPaneTabs.splice(toIndex, 0, moved);
        return pane === 'primary'
          ? [...updatedPaneTabs, ...otherTabs]
          : [...otherTabs, ...updatedPaneTabs];
      });
    },
    [],
  );

  const moveTabToPane = useCallback(
    (tabId: string, targetPane: 'primary' | 'secondary', targetIndex?: number) => {
      setInternalTabs((prev) => {
        const tab = prev.find((t) => t.id === tabId);
        if (!tab) return prev;
        const currentPane = tab.pane ?? 'primary';
        if (currentPane === targetPane && targetIndex === undefined) return prev;

        const updatedTab = { ...tab, pane: targetPane };
        const remainingCurrent = prev.filter(
          (t) => t.id !== tabId && (t.pane ?? 'primary') === currentPane,
        );
        const targetList = prev.filter(
          (t) => t.id !== tabId && (t.pane ?? 'primary') === targetPane,
        );

        const newTargetList = [...targetList];
        if (
          targetIndex !== undefined &&
          targetIndex >= 0 &&
          targetIndex <= newTargetList.length
        ) {
          newTargetList.splice(targetIndex, 0, updatedTab);
        } else {
          newTargetList.push(updatedTab);
        }

        if (targetPane === 'secondary') {
          setInternalSecondaryActiveTabId(tabId);
        } else {
          setInternalActiveTabId(tabId);
        }

        if (currentPane === 'secondary') {
          setInternalSecondaryActiveTabId((curr) => {
            if (curr !== tabId) return curr;
            return remainingCurrent[0]?.id ?? null;
          });
        } else {
          setInternalActiveTabId((curr) => {
            if (curr !== tabId) return curr;
            return remainingCurrent[0]?.id ?? null;
          });
        }

        return targetPane === 'primary'
          ? [...newTargetList, ...remainingCurrent]
          : [...remainingCurrent, ...newTargetList];
      });
    },
    [],
  );

  const splitTab = useCallback(
    (
      tabId: string,
      direction: 'horizontal' | 'vertical',
      side: 'left' | 'right' | 'top' | 'bottom',
    ) => {
      setSplitDirection(direction);
      setInternalTabs((prev) => {
        const tab = prev.find((t) => t.id === tabId);
        if (!tab) return prev;

        if (side === 'right' || side === 'bottom') {
          const next = prev.map((t) =>
            t.id === tabId ? { ...t, pane: 'secondary' as const } : t,
          );
          const primary = next.filter((t) => (t.pane ?? 'primary') === 'primary');
          setInternalSecondaryActiveTabId(tabId);
          setInternalActiveTabId((curr) => {
            if (curr !== tabId) return curr;
            return primary[0]?.id ?? null;
          });
          return next;
        } else {
          const next = prev.map((t) =>
            t.id === tabId
              ? { ...t, pane: 'primary' as const }
              : { ...t, pane: 'secondary' as const },
          );
          setInternalActiveTabId(tabId);
          const secondary = next.filter((t) => t.pane === 'secondary');
          setInternalSecondaryActiveTabId(secondary[0]?.id ?? null);
          return next;
        }
      });
    },
    [],
  );

  return (
    <WorkspaceTabsContext.Provider
      value={{
        tabs,
        activeTabId,
        secondaryActiveTabId,
        splitDirection,
        isSplit,
        openTab,
        closeTab,
        closeTabs,
        closeAllTabs,
        setActiveTab,
        setSecondaryActiveTab,
        updateTab,
        moveTab,
        moveTabToPane,
        splitTab,
        closeSplit,
        setSplitDirection,
        isTabsLoaded: isLoaded,
      }}
    >
      {children}
    </WorkspaceTabsContext.Provider>
  );
}

export function useWorkspaceTabs(): WorkspaceTabsContextValue {
  const context = useContext(WorkspaceTabsContext);
  if (!context) {
    throw new Error(
      'useWorkspaceTabs must be used within a WorkspaceTabsProvider',
    );
  }
  return context;
}
