import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useWorkspace } from '@/lib/context/WorkspaceContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useStatusBar } from '@/lib/context/StatusBarContext';
import { useChatQueue } from '@/lib/agent/chatQueueManager';
import { fcSystemFolders } from '@/lib/commander/ipc';
import { formatBytes } from '@/lib/commander/format';
import type { FcSystemFolder } from '@/lib/commander/types';
import { ExplorerToolbar, type ExplorerSplit } from './ExplorerToolbar';
import {
  ExplorerPane,
  type ExplorerPaneHandle,
  type ExplorerPaneState,
  type PaneStats,
} from './ExplorerPane';
import { FolderTree } from './FolderTree';
import { ExplorerStatusBar, type ExplorerStatusInfo } from './ExplorerStatusBar';
import { ExplorerChatDock } from './ExplorerChatDock';
import { cn } from '@/lib/utils';

interface ExplorerTabMeta {
  path?: string;
  back?: string[];
  fwd?: string[];
  sortKey?: ExplorerPaneState['sortKey'];
  sortDir?: ExplorerPaneState['sortDir'];
  showHidden?: boolean;
  panes?: ExplorerPaneState[];
  activePane?: number;
  // 구버전: 1 | 2 | 4 숫자. 신버전: 'single' | 'dual-h' | 'dual-v'.
  split?: ExplorerSplit | 1 | 2 | 4;
  treeOpen?: boolean;
  treeOpenByPane?: Record<number, boolean>;
  chatOpen?: boolean;
}

function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function normalizeSplit(raw: ExplorerTabMeta['split']): ExplorerSplit {
  if (raw === 'dual-h' || raw === 'dual-v' || raw === 'single') return raw;
  if (raw === 2) return 'dual-v';
  return 'single';
}

function normalizePane(raw: Partial<ExplorerPaneState>, fallbackPath: string): ExplorerPaneState {
  return {
    path: typeof raw.path === 'string' ? raw.path : fallbackPath,
    back: Array.isArray(raw.back) ? raw.back : [],
    fwd: Array.isArray(raw.fwd) ? raw.fwd : [],
    sortKey: raw.sortKey === 'size' || raw.sortKey === 'kind' || raw.sortKey === 'modified' ? raw.sortKey : 'name',
    sortDir: raw.sortDir === 'desc' ? 'desc' : 'asc',
    showHidden: raw.showHidden === true,
  };
}

function statsEqual(a: PaneStats | undefined, b: PaneStats): boolean {
  return (
    a !== undefined &&
    a.path === b.path &&
    a.total === b.total &&
    a.totalBytes === b.totalBytes &&
    a.selCount === b.selCount &&
    a.selBytes === b.selBytes &&
    a.canBack === b.canBack &&
    a.canForward === b.canForward &&
    a.canUp === b.canUp &&
    a.showHidden === b.showHidden &&
    a.searching === b.searching &&
    a.selNames.join('\n') === b.selNames.join('\n')
  );
}

export function FileExplorerTab({ tab }: { tab: WorkspaceTab }) {
  const { t } = useLanguage();
  const { openTab, updateTab } = useWorkspaceTabs();
  const { workspaceRoot, workFolder } = useWorkspace();
  const { settings, updateSettings } = useSettings();
  const { publish, clear } = useStatusBar();

  const meta = (tab.meta ?? {}) as ExplorerTabMeta;
  const fallbackPath = useMemo(
    () => workFolder ?? workspaceRoot ?? '',
    [workFolder, workspaceRoot],
  );
  const [panes, setPanes] = useState<ExplorerPaneState[]>(() => {
    if (Array.isArray(meta.panes) && meta.panes.length > 0) {
      return meta.panes.map((p) => normalizePane(p, fallbackPath));
    }
    return [
      normalizePane(
        {
          path: meta.path,
          back: meta.back,
          fwd: meta.fwd,
          sortKey: meta.sortKey,
          sortDir: meta.sortDir,
          showHidden: meta.showHidden,
        },
        fallbackPath,
      ),
    ];
  });
  const [activePane, setActivePane] = useState(meta.activePane ?? 0);
  const [split, setSplit] = useState<ExplorerSplit>(() => normalizeSplit(meta.split));
  // 폴더 트리 열림 상태는 탭당 하나만 유지한다. 분할 창을 클릭해도 바뀌지 않는다.
  // 구 treeOpenByPane 저장값은 첫 로드 시에만 활성 창의 값으로 승계한다.
  const [treeOpen, setTreeOpen] = useState<boolean>(() => {
    if (typeof meta.treeOpen === 'boolean') return meta.treeOpen;
    const idx = meta.activePane ?? 0;
    if (meta.treeOpenByPane && typeof meta.treeOpenByPane[idx] === 'boolean') {
      return meta.treeOpenByPane[idx] as boolean;
    }
    return true;
  });
  const [chatOpen, setChatOpen] = useState(meta.chatOpen ?? false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [systemFolders, setSystemFolders] = useState<FcSystemFolder[]>([]);
  const [statsByPane, setStatsByPane] = useState<Record<number, PaneStats>>({});
  const paneRefs = useRef<(ExplorerPaneHandle | null)[]>([]);

  const visibleCount = split === 'single' ? 1 : 2;
  const visiblePanes = useMemo(() => {
    const base = [...panes];
    while (base.length < visibleCount) {
      const src = base[activePane] ?? base[0] ?? normalizePane({}, fallbackPath);
      base.push({ ...src, back: [], fwd: [] });
    }
    return base.slice(0, visibleCount);
  }, [panes, visibleCount, activePane, fallbackPath]);

  const sessionId = `explorer-chat-${tab.id}`;
  const { isThisSessionBusy } = useChatQueue(sessionId);
  const wasBusyRef = useRef(false);

  // 에이전트 채팅이 끝나면 목록을 새로고침한다 (도구 결과로 파일이 바뀌었을 수 있음).
  useEffect(() => {
    if (wasBusyRef.current && !isThisSessionBusy) {
      setRefreshSignal((s) => s + 1);
    }
    wasBusyRef.current = isThisSessionBusy;
  }, [isThisSessionBusy]);

  useEffect(() => {
    let active = true;
    void fcSystemFolders()
      .then((list) => {
        if (active) setSystemFolders(list);
      })
      .catch(() => {
        if (active) setSystemFolders([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const persist = useCallback(
    (next: {
      panes: ExplorerPaneState[];
      activePane: number;
      split: ExplorerSplit;
      treeOpen: boolean;
      chatOpen: boolean;
    }) => {
      const activePath = next.panes[next.activePane]?.path ?? '';
      updateTab(tab.id, {
        title: baseNameOf(activePath) || t('activityBar.explorer'),
        meta: { ...(tab.meta ?? {}), ...next, treeOpenByPane: undefined },
      });
    },
    [updateTab, tab.id, tab.meta, t],
  );

  const handlePaneChange = useCallback(
    (index: number, patch: ExplorerPaneState) => {
      const next = [...panes];
      while (next.length <= index) {
        const src = next[activePane] ?? next[0] ?? normalizePane({}, fallbackPath);
        next.push({ ...src, back: [], fwd: [] });
      }
      next[index] = patch;
      setPanes(next);
      persist({ panes: next, activePane, split, treeOpen, chatOpen });
    },
    [panes, activePane, fallbackPath, persist, split, treeOpen, chatOpen],
  );

  const handlePaneStats = useCallback((index: number, s: PaneStats) => {
    setStatsByPane((prev) => (statsEqual(prev[index], s) ? prev : { ...prev, [index]: s }));
  }, []);

  const activeStats = statsByPane[activePane];
  const activePath = activeStats?.path ?? visiblePanes[activePane]?.path ?? '';

  const statusInfo: ExplorerStatusInfo = useMemo(
    () => ({
      path: activePath,
      total: activeStats?.total ?? 0,
      totalBytes: activeStats?.totalBytes ?? 0,
      selCount: activeStats?.selCount ?? 0,
      selBytes: activeStats?.selBytes ?? 0,
      selNames: activeStats?.selNames ?? [],
    }),
    [activePath, activeStats],
  );

  // 전역 StatusBar 현재 탭 슬롯 (활성 탭만, 기존 동작 유지).
  const { activeTabId } = useWorkspaceTabs();
  const isActive = activeTabId === tab.id;
  useEffect(() => {
    if (!isActive) {
      clear('tab', 'explorer-tab');
      return;
    }
    publish('tab', {
      id: 'explorer-tab',
      content: (
        <>
          {statusInfo.selCount > 0 && (
            <span className="font-medium">{t('explorer.statusSelected', { sel: String(statusInfo.selCount) })} · </span>
          )}
          <span>{t('explorer.statusTotal', { total: String(statusInfo.total), size: formatBytes(statusInfo.totalBytes) })}</span>
        </>
      ),
      title: statusInfo.path,
    });
    return () => clear('tab', 'explorer-tab');
  }, [isActive, statusInfo, publish, clear, t]);

  const activeHandle = () => paneRefs.current[activePane] ?? null;

  const handleSplitChange = useCallback(
    (next: ExplorerSplit) => {
      setSplit(next);
      setActivePane((prev) => Math.min(prev, next === 'single' ? 0 : 1));
      persist({ panes, activePane: Math.min(activePane, next === 'single' ? 0 : 1), split: next, treeOpen, chatOpen });
    },
    [panes, activePane, treeOpen, chatOpen, persist],
  );

  const toggleTree = useCallback(() => {
    const next = !treeOpen;
    setTreeOpen(next);
    persist({ panes, activePane, split, treeOpen: next, chatOpen });
  }, [panes, activePane, split, chatOpen, treeOpen, persist]);

  const toggleChat = useCallback(() => {
    const next = !chatOpen;
    setChatOpen(next);
    persist({ panes, activePane, split, treeOpen, chatOpen: next });
  }, [panes, activePane, split, treeOpen, chatOpen, persist]);

  const handleAddFavorite = useCallback(() => {
    if (!activePath) return;
    if (settings.favorites.includes(activePath)) return;
    void updateSettings({ favorites: [...settings.favorites, activePath] });
  }, [activePath, settings.favorites, updateSettings]);

  const handleOpenPath = useCallback(
    (next: string) => {
      activeHandle()?.navigate(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activePane, panes],
  );

  const sessionTitle = t('explorer.chatSessionTitle', { path: activePath || t('activityBar.explorer') });
  const handleOpenInChatTab = useCallback(() => {
    openTab({
      id: `chat:${sessionId}`,
      type: 'chat',
      title: sessionTitle,
      meta: { sessionId },
    });
  }, [openTab, sessionId, sessionTitle]);

  // 채팅 도크는 포커스된 창을 추가 분할하는 형태로 표시한다.
  // 이미 좌우로 나뉜 상태(dual-v)에서는 상하로, 그 외에는 좌우로 나눠 좁아짐을 방지한다.
  const chatOrientation: 'row' | 'col' = split === 'dual-v' ? 'col' : 'row';

  const renderPane = (pane: ExplorerPaneState, index: number) => {
    const isFocused = index === activePane;
    const paneEl = (
      <ExplorerPane
        initial={pane}
        active={isFocused}
        oppositePath={visiblePanes[(index + 1) % visiblePanes.length]?.path ?? null}
        refreshSignal={refreshSignal}
        handleRef={{
          get current() {
            return paneRefs.current[index] ?? null;
          },
          set current(v: ExplorerPaneHandle | null) {
            paneRefs.current[index] = v;
          },
        }}
        onActivate={() => setActivePane(index)}
        onChange={(patch) => handlePaneChange(index, patch)}
        onStats={(s) => handlePaneStats(index, s)}
      />
    );
    if (!(chatOpen && isFocused)) {
      return paneEl;
    }
    return (
      <div className={cn('flex flex-1 min-h-0 min-w-0', chatOrientation === 'row' ? 'flex-row' : 'flex-col')}>
        <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">{paneEl}</div>
        <div className={cn('flex min-h-0 min-w-0 overflow-hidden', chatOrientation === 'row' ? 'w-1/2' : 'h-1/2')}>
          <ExplorerChatDock
            sessionId={sessionId}
            title={sessionTitle}
            cwd={activePath}
            selCount={activeStats?.selCount ?? 0}
            orientation={chatOrientation}
            onClose={toggleChat}
            onOpenInChatTab={handleOpenInChatTab}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="relative flex flex-col h-full w-full min-h-0 bg-editor">
      <ExplorerToolbar
        canBack={activeStats?.canBack ?? false}
        canForward={activeStats?.canForward ?? false}
        canUp={activeStats?.canUp ?? false}
        showHidden={activeStats?.showHidden ?? false}
        treeOpen={treeOpen}
        split={split}
        favorites={settings.favorites}
        systemFolders={systemFolders}
        onBack={() => activeHandle()?.goBack()}
        onForward={() => activeHandle()?.goForward()}
        onUp={() => activeHandle()?.goUp()}
        onRefresh={() => setRefreshSignal((s) => s + 1)}
        onNewFolder={() => activeHandle()?.newFolder()}
        onToggleHidden={() => activeHandle()?.toggleHidden()}
        onToggleTree={toggleTree}
        onSplitChange={handleSplitChange}
        onOpenPath={handleOpenPath}
        onAddFavorite={handleAddFavorite}
      />
      <div className="flex flex-1 min-h-0 min-w-0">
        {treeOpen && (
          <div className="w-56 shrink-0 h-full min-h-0 overflow-y-auto border-r border-border bg-panel">
            <FolderTree currentPath={activePath} onNavigate={handleOpenPath} />
          </div>
        )}
        <div
          className={cn(
            'flex-1 min-h-0 min-w-0 grid gap-[1px] bg-border/60',
            split === 'dual-v' && 'grid-cols-2',
            split === 'dual-h' && 'grid-rows-2 grid-cols-1',
            split === 'single' && 'grid-cols-1',
          )}
        >
          {visiblePanes.map((pane, index) => (
            <div key={`${tab.id}-pane-${index}`} className="min-h-0 min-w-0 bg-editor overflow-hidden flex flex-col">
              {renderPane(pane, index)}
            </div>
          ))}
        </div>
      </div>
      <ExplorerStatusBar info={statusInfo} />
      {!chatOpen && (
        <button
          type="button"
          onClick={toggleChat}
          title={t('explorer.agentChat')}
          aria-label={t('explorer.agentChat')}
          className="absolute bottom-8 right-4 z-30 h-11 w-11 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform cursor-pointer"
        >
          <MessageSquare className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

export default FileExplorerTab;
