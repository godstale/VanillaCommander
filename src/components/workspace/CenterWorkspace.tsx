import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  MessageSquare,
  FileCode,
  Image as ImageIcon,
  Bot,
  Puzzle,
  Activity,
  FlaskConical,
  X,
  Plus,
  Columns2,
  Rows2,
  type LucideIcon,
} from 'lucide-react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { Button } from '@/components/ui/button';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useWorkspace } from '@/lib/context/WorkspaceContext';
import type { WorkspaceTab, WorkspaceTabType } from '@/lib/types/workspaceTab';
import { ChatTab } from '@/components/workspace/ChatTab';
import { EditorTab } from '@/components/workspace/EditorTab';
import { ImageViewerTab } from '@/components/workspace/ImageViewerTab';
import { SkillViewerTab } from '@/components/workspace/SkillViewerTab';
import { AgentEditorTab } from '@/components/workspace/AgentEditorTab';
import { AgentStatsTab } from '@/components/workspace/AgentStatsTab';
import { AgentMonitorTab } from '@/components/workspace/AgentMonitorTab';
import { EvalTab } from '@/components/workspace/EvalTab';
import { WelcomeGuide } from '@/components/workspace/WelcomeGuide';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n/LanguageContext';

// Global reference for drag operations to avoid React state update latency
let activeDragTabId: string | null = null;

const TAB_ICONS: Record<WorkspaceTabType, LucideIcon> = {
  chat: MessageSquare,
  editor: FileCode,
  'image-viewer': ImageIcon,
  'agent-editor': Bot,
  'agent-stats': Activity,
  'agent-monitor': Activity,
  'skill-viewer': Puzzle,
  eval: FlaskConical,
};

function renderTabContent(tab: WorkspaceTab) {
  switch (tab.type) {
    case 'chat':
      return <ChatTab tab={tab} />;
    case 'editor':
      return <EditorTab tab={tab} />;
    case 'image-viewer':
      return <ImageViewerTab tab={tab} />;
    case 'agent-editor':
      return <AgentEditorTab tab={tab} />;
    case 'agent-stats':
      return <AgentStatsTab tab={tab} />;
    case 'agent-monitor':
      return <AgentMonitorTab tab={tab} />;
    case 'skill-viewer':
      return <SkillViewerTab tab={tab} />;
    case 'eval':
      return <EvalTab tab={tab} />;
    default:
      return null;
  }
}

function SplitResizeHandle({ direction }: { direction: 'horizontal' | 'vertical' }) {
  return (
    <PanelResizeHandle
      className={cn(
        direction === 'horizontal'
          ? 'w-1.5 hover:w-2 -mx-0.5 cursor-col-resize'
          : 'h-1.5 hover:h-2 -my-0.5 cursor-row-resize',
        'z-20 bg-border/80 hover:bg-primary/80 transition-colors flex items-center justify-center select-none data-[resize-handle-active]:bg-primary',
      )}
    />
  );
}

interface WorkspacePaneProps {
  pane: 'primary' | 'secondary';
  paneTabs: WorkspaceTab[];
  activeTabId: string | null;
  workspaceRoot: string | null;
  isSplit: boolean;
  splitDirection: 'horizontal' | 'vertical';
  draggedTabId: string | null;
  dragOverTarget: { id: string; position: 'left' | 'right' } | null;
  splitDropTarget: {
    pane: 'primary' | 'secondary';
    side: 'left' | 'right' | 'top' | 'bottom' | 'center';
  } | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, tabId: string, pane: 'primary' | 'secondary') => void;
  onNewChat: (pane: 'primary' | 'secondary') => void;
  onSplitTab: (tabId: string, direction: 'horizontal' | 'vertical', side: 'left' | 'right' | 'top' | 'bottom') => void;
  onToggleSplitDirection: () => void;
  onCloseSplit: () => void;
  onDragStart: (e: React.DragEvent, tabId: string) => void;
  onDragOver: (e: React.DragEvent, tabId: string) => void;
  onDragLeave: (e: React.DragEvent, tabId: string) => void;
  onDrop: (e: React.DragEvent, targetId: string, pane: 'primary' | 'secondary') => void;
  onContainerDragOver: (e: React.DragEvent) => void;
  onContainerDrop: (e: React.DragEvent, pane: 'primary' | 'secondary') => void;
  onDragEnd: () => void;
  onContentDragOver: (e: React.DragEvent, pane: 'primary' | 'secondary') => void;
  onContentDragLeave: (e: React.DragEvent) => void;
  onContentDrop: (e: React.DragEvent, pane: 'primary' | 'secondary') => void;
}

function WorkspacePane({
  pane,
  paneTabs,
  activeTabId,
  workspaceRoot,
  isSplit,
  splitDirection,
  draggedTabId,
  dragOverTarget,
  splitDropTarget,
  onSelectTab,
  onCloseTab,
  onContextMenu,
  onNewChat,
  onSplitTab,
  onToggleSplitDirection,
  onCloseSplit,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onContainerDragOver,
  onContainerDrop,
  onDragEnd,
  onContentDragOver,
  onContentDragLeave,
  onContentDrop,
}: WorkspacePaneProps) {
  const { t } = useLanguage();
  const isThisPaneDropping = splitDropTarget?.pane === pane;

  return (
    <div className="flex flex-col h-full w-full min-h-0 bg-background overflow-hidden relative">
      {/* Tab Strip */}
      <div
        onDragOver={onContainerDragOver}
        onDrop={(e) => onContainerDrop(e, pane)}
        className="min-h-9 shrink-0 flex flex-wrap items-center bg-card/60 border-b border-border select-none p-0"
      >
        <div className="flex flex-wrap items-center min-w-0 flex-1">
          {paneTabs.map((tab) => {
            const Icon = TAB_ICONS[tab.type] || FileCode;
            const isActive = tab.id === activeTabId;
            const isBeingDragged = draggedTabId === tab.id;
            const isLeftIndicator =
              dragOverTarget?.id === tab.id &&
              dragOverTarget.position === 'left';
            const isRightIndicator =
              dragOverTarget?.id === tab.id &&
              dragOverTarget.position === 'right';

            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                draggable
                onDragStart={(e) => onDragStart(e, tab.id)}
                onDragOver={(e) => onDragOver(e, tab.id)}
                onDragLeave={(e) => onDragLeave(e, tab.id)}
                onDrop={(e) => onDrop(e, tab.id, pane)}
                onDragEnd={onDragEnd}
                onClick={() => onSelectTab(tab.id)}
                onContextMenu={(e) => onContextMenu(e, tab.id, pane)}
                className={cn(
                  'h-9 box-border flex items-center gap-2 px-3.5 text-xs border-t-2 border-r border-b cursor-pointer transition-colors max-w-[15rem] shrink-0 relative group select-none cursor-grab active:cursor-grabbing',
                  isActive
                    ? 'border-t-primary border-r-border/80 border-b-transparent bg-background text-foreground font-medium shadow-xs'
                    : 'border-t-transparent border-r-border/80 border-b-border/80 text-muted-foreground hover:text-foreground hover:bg-accent/40',
                  isBeingDragged &&
                    'opacity-40 scale-95 border-dashed border-primary',
                  isLeftIndicator &&
                    'before:absolute before:left-0 before:top-1 before:bottom-1 before:w-1 before:bg-primary before:rounded-full before:z-30 before:shadow-sm',
                  isRightIndicator &&
                    'after:absolute after:right-0 after:top-1 after:bottom-1 after:w-1 after:bg-primary after:rounded-full after:z-30 after:shadow-sm',
                )}
                title={tab.title}
              >
                <Icon
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 pointer-events-none',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
                <span className="truncate py-0.5 pointer-events-none">
                  {tab.title}
                </span>
                <button
                  type="button"
                  aria-label={t('workspace.closeTab')}
                  draggable={false}
                  onDragStart={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="ml-1 p-1 rounded-sm opacity-60 hover:opacity-100 hover:bg-muted shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          {/* Action buttons */}
          <div className="h-9 px-1.5 shrink-0 flex items-center gap-1 border-t-2 border-t-transparent border-b border-b-transparent">
            <Button
              variant="ghost"
              size="icon"
              disabled={!workspaceRoot}
              className={cn(
                'h-7 w-7 transition-colors',
                !workspaceRoot
                  ? 'text-muted-foreground/30 cursor-not-allowed hover:bg-transparent'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => onNewChat(pane)}
              title={
                workspaceRoot
                  ? t('workspace.openNewChat')
                  : t('topMenu.selectFolderFirst')
              }
            >
              <Plus className="h-4 w-4" />
            </Button>

            {/* Split trigger or layout control */}
            {!isSplit && pane === 'primary' && paneTabs.length >= 2 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() =>
                  activeTabId && onSplitTab(activeTabId, 'horizontal', 'right')
                }
                title={t('workspace.splitRight')}
              >
                <Columns2 className="h-3.5 w-3.5" />
              </Button>
            )}

            {isSplit && pane === 'secondary' && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={onToggleSplitDirection}
                  title={
                    splitDirection === 'horizontal'
                      ? t('workspace.switchToVertical')
                      : t('workspace.switchToHorizontal')
                  }
                >
                  {splitDirection === 'horizontal' ? (
                    <Rows2 className="h-3.5 w-3.5" />
                  ) : (
                    <Columns2 className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive transition-colors"
                  onClick={onCloseSplit}
                  title={t('workspace.closeSplit')}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div
        onDragOver={(e) => onContentDragOver(e, pane)}
        onDragLeave={onContentDragLeave}
        onDrop={(e) => onContentDrop(e, pane)}
        className="flex-1 min-h-0 relative overflow-hidden"
      >
        {!workspaceRoot ? (
          <WelcomeGuide />
        ) : paneTabs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full w-full text-center text-muted-foreground gap-3">
            <MessageSquare className="h-10 w-10 opacity-30" />
            <p className="text-xs">{t('workspace.noTabs')}</p>
            <Button
              size="sm"
              onClick={() => onNewChat(pane)}
              className="text-xs cursor-pointer"
            >
              {t('workspace.startNewChat')}
            </Button>
          </div>
        ) : (
          paneTabs.map((tab) => {
            const isHidden = tab.id !== activeTabId;
            return (
              <div
                key={tab.id}
                className={cn(
                  'absolute inset-0 h-full w-full',
                  isHidden && 'hidden',
                )}
              >
                {renderTabContent(tab)}
              </div>
            );
          })
        )}

        {/* Visual Drop Overlay for Screen Splitting */}
        {isThisPaneDropping && !isSplit && (
          <>
            {splitDropTarget.side === 'right' && (
              <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-primary/10 border-2 border-dashed border-primary rounded-xl m-2 flex flex-col items-center justify-center pointer-events-none z-30 transition-all backdrop-blur-[1px]">
                <div className="p-3 rounded-full bg-primary/20 text-primary mb-2 animate-bounce">
                  <Columns2 className="h-6 w-6" />
                </div>
                <span className="text-xs font-semibold text-primary">
                  {t('workspace.splitRight')}
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5">
                  {t('workspace.dropToSplit')}
                </span>
              </div>
            )}
            {splitDropTarget.side === 'left' && (
              <div className="absolute left-0 top-0 bottom-0 w-1/2 bg-primary/10 border-2 border-dashed border-primary rounded-xl m-2 flex flex-col items-center justify-center pointer-events-none z-30 transition-all backdrop-blur-[1px]">
                <div className="p-3 rounded-full bg-primary/20 text-primary mb-2 animate-bounce">
                  <Columns2 className="h-6 w-6" />
                </div>
                <span className="text-xs font-semibold text-primary">
                  {t('workspace.splitLeft')}
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5">
                  {t('workspace.dropToSplit')}
                </span>
              </div>
            )}
            {splitDropTarget.side === 'bottom' && (
              <div className="absolute left-0 right-0 bottom-0 h-1/2 bg-primary/10 border-2 border-dashed border-primary rounded-xl m-2 flex flex-col items-center justify-center pointer-events-none z-30 transition-all backdrop-blur-[1px]">
                <div className="p-3 rounded-full bg-primary/20 text-primary mb-2 animate-bounce">
                  <Rows2 className="h-6 w-6" />
                </div>
                <span className="text-xs font-semibold text-primary">
                  {t('workspace.splitBottom')}
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5">
                  {t('workspace.dropToSplit')}
                </span>
              </div>
            )}
            {splitDropTarget.side === 'top' && (
              <div className="absolute left-0 right-0 top-0 h-1/2 bg-primary/10 border-2 border-dashed border-primary rounded-xl m-2 flex flex-col items-center justify-center pointer-events-none z-30 transition-all backdrop-blur-[1px]">
                <div className="p-3 rounded-full bg-primary/20 text-primary mb-2 animate-bounce">
                  <Rows2 className="h-6 w-6" />
                </div>
                <span className="text-xs font-semibold text-primary">
                  {t('workspace.splitTop')}
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5">
                  {t('workspace.dropToSplit')}
                </span>
              </div>
            )}
          </>
        )}

        {isThisPaneDropping && isSplit && (
          <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-xl m-2 flex flex-col items-center justify-center pointer-events-none z-30 transition-all backdrop-blur-[1px]">
            <span className="text-xs font-semibold text-primary">
              {t('workspace.moveTabHere')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function CenterWorkspace() {
  const { t } = useLanguage();
  const { workspaceRoot } = useWorkspace();
  const {
    tabs,
    activeTabId,
    secondaryActiveTabId,
    splitDirection,
    isSplit,
    setActiveTab,
    closeTab,
    closeTabs,
    closeAllTabs,
    openTab,
    moveTab,
    moveTabToPane,
    splitTab,
    closeSplit,
    setSplitDirection,
  } = useWorkspaceTabs();

  const [contextMenuState, setContextMenuState] = useState<{
    tabId: string;
    pane: 'primary' | 'secondary';
    x: number;
    y: number;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!contextMenuState) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenuState(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenuState(null);
      }
    };

    const handleScroll = () => {
      setContextMenuState(null);
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleScroll);
    };
  }, [contextMenuState]);

  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);

  const [dragOverTarget, setDragOverTarget] = useState<{
    id: string;
    position: 'left' | 'right';
  } | null>(null);

  const [splitDropTarget, setSplitDropTarget] = useState<{
    pane: 'primary' | 'secondary';
    side: 'left' | 'right' | 'top' | 'bottom' | 'center';
  } | null>(null);

  const primaryTabs = tabs.filter((t) => (t.pane ?? 'primary') === 'primary');
  const secondaryTabs = tabs.filter((t) => t.pane === 'secondary');

  const handleTabContextMenu = (
    e: React.MouseEvent,
    tabId: string,
    pane: 'primary' | 'secondary',
  ) => {
    e.preventDefault();
    setContextMenuState({ tabId, pane, x: e.clientX, y: e.clientY });
  };

  const handleNewChat = (pane: 'primary' | 'secondary' = 'primary') => {
    if (!workspaceRoot) return;
    openTab(
      {
        type: 'chat',
        title: t('workspace.newChat'),
      },
      pane,
    );
  };

  const handleCloseOthers = (targetId: string, pane: 'primary' | 'secondary') => {
    const paneTabs = tabs.filter((t) => (t.pane ?? 'primary') === pane);
    const otherIds = paneTabs.filter((t) => t.id !== targetId).map((t) => t.id);
    closeTabs(otherIds);
  };

  const handleCloseToLeft = (targetId: string, pane: 'primary' | 'secondary') => {
    const paneTabs = tabs.filter((t) => (t.pane ?? 'primary') === pane);
    const targetIdx = paneTabs.findIndex((t) => t.id === targetId);
    if (targetIdx > 0) {
      const leftIds = paneTabs.slice(0, targetIdx).map((t) => t.id);
      if (leftIds.length > 0) {
        closeTabs(leftIds);
      }
    }
  };

  const handleCloseToRight = (targetId: string, pane: 'primary' | 'secondary') => {
    const paneTabs = tabs.filter((t) => (t.pane ?? 'primary') === pane);
    const targetIdx = paneTabs.findIndex((t) => t.id === targetId);
    if (targetIdx !== -1) {
      const rightIds = paneTabs.slice(targetIdx + 1).map((t) => t.id);
      if (rightIds.length > 0) {
        closeTabs(rightIds);
      }
    }
  };

  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    e.dataTransfer.setData('text/plain', tabId);
    e.dataTransfer.effectAllowed = 'move';
    activeDragTabId = tabId;
    setDraggedTabId(tabId);
  };

  const handleDragOver = (e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const activeId = activeDragTabId || draggedTabId;
    if (!activeId || activeId === tabId) {
      if (dragOverTarget) setDragOverTarget(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const position = e.clientX > rect.left + rect.width / 2 ? 'right' : 'left';
    if (
      !dragOverTarget ||
      dragOverTarget.id !== tabId ||
      dragOverTarget.position !== position
    ) {
      setDragOverTarget({ id: tabId, position });
    }
  };

  const handleDragLeave = (e: React.DragEvent, tabId: string) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    if (dragOverTarget?.id === tabId) {
      setDragOverTarget(null);
    }
  };

  const handleDrop = (
    e: React.DragEvent,
    targetId: string,
    targetPane: 'primary' | 'secondary',
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceId =
      e.dataTransfer.getData('text/plain') ||
      activeDragTabId ||
      draggedTabId;
    activeDragTabId = null;
    setDraggedTabId(null);
    setDragOverTarget(null);
    setSplitDropTarget(null);

    if (!sourceId || sourceId === targetId) return;

    const sourceTab = tabs.find((t) => t.id === sourceId);
    if (!sourceTab) return;
    const sourcePane = sourceTab.pane ?? 'primary';

    const paneTabs = tabs.filter((t) => (t.pane ?? 'primary') === targetPane);
    const targetIdx = paneTabs.findIndex((t) => t.id === targetId);
    if (targetIdx === -1) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const dropAfter = e.clientX > rect.left + rect.width / 2;

    if (sourcePane === targetPane) {
      const sourceIdx = paneTabs.findIndex((t) => t.id === sourceId);
      if (sourceIdx === -1) return;
      let toIdx = targetIdx;
      if (sourceIdx < targetIdx) {
        toIdx = dropAfter
          ? targetIdx
          : targetIdx === sourceIdx + 1
          ? targetIdx
          : targetIdx - 1;
      } else if (sourceIdx > targetIdx) {
        toIdx = !dropAfter
          ? targetIdx
          : targetIdx === sourceIdx - 1
          ? targetIdx
          : targetIdx + 1;
      }
      moveTab(sourceIdx, toIdx, targetPane);
    } else {
      const insertIdx = dropAfter ? targetIdx + 1 : targetIdx;
      moveTabToPane(sourceId, targetPane, insertIdx);
    }
  };

  const handleContainerDragOver = (e: React.DragEvent) => {
    const activeId = activeDragTabId || draggedTabId;
    if (activeId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleContainerDrop = (
    e: React.DragEvent,
    targetPane: 'primary' | 'secondary',
  ) => {
    e.preventDefault();
    const sourceId =
      e.dataTransfer.getData('text/plain') ||
      activeDragTabId ||
      draggedTabId;
    activeDragTabId = null;
    setDraggedTabId(null);
    setDragOverTarget(null);
    setSplitDropTarget(null);

    if (!sourceId) return;

    const sourceTab = tabs.find((t) => t.id === sourceId);
    if (!sourceTab) return;
    const sourcePane = sourceTab.pane ?? 'primary';
    const paneTabs = tabs.filter((t) => (t.pane ?? 'primary') === targetPane);

    if (sourcePane === targetPane) {
      const sourceIdx = paneTabs.findIndex((t) => t.id === sourceId);
      if (sourceIdx !== -1 && sourceIdx !== paneTabs.length - 1) {
        moveTab(sourceIdx, paneTabs.length - 1, targetPane);
      }
    } else {
      moveTabToPane(sourceId, targetPane, paneTabs.length);
    }
  };

  const handleDragEnd = () => {
    activeDragTabId = null;
    setDraggedTabId(null);
    setDragOverTarget(null);
    setSplitDropTarget(null);
  };

  const handleContentDragOver = (
    e: React.DragEvent,
    pane: 'primary' | 'secondary',
  ) => {
    const activeId = activeDragTabId || draggedTabId;
    if (!activeId) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const nx = x / rect.width;
    const ny = y / rect.height;

    if (!isSplit) {
      if (nx > 0.65) {
        setSplitDropTarget({ pane, side: 'right' });
      } else if (nx < 0.35) {
        setSplitDropTarget({ pane, side: 'left' });
      } else if (ny > 0.65) {
        setSplitDropTarget({ pane, side: 'bottom' });
      } else if (ny < 0.35) {
        setSplitDropTarget({ pane, side: 'top' });
      } else {
        setSplitDropTarget({ pane, side: 'right' });
      }
    } else {
      setSplitDropTarget({ pane, side: 'center' });
    }
  };

  const handleContentDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    setSplitDropTarget(null);
  };

  const handleContentDrop = (
    e: React.DragEvent,
    pane: 'primary' | 'secondary',
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceId =
      e.dataTransfer.getData('text/plain') ||
      activeDragTabId ||
      draggedTabId;
    const target = splitDropTarget;

    setSplitDropTarget(null);
    activeDragTabId = null;
    setDraggedTabId(null);
    setDragOverTarget(null);

    if (!sourceId) return;

    if (!isSplit && target) {
      if (target.side === 'left' || target.side === 'right') {
        splitTab(sourceId, 'horizontal', target.side);
      } else if (target.side === 'top' || target.side === 'bottom') {
        splitTab(sourceId, 'vertical', target.side);
      }
    } else if (isSplit) {
      moveTabToPane(sourceId, pane);
    }
  };

  return (
    <div className="flex flex-col h-full w-full min-h-0 bg-background overflow-hidden relative">
      {!isSplit ? (
        <WorkspacePane
          pane="primary"
          paneTabs={primaryTabs}
          activeTabId={activeTabId}
          workspaceRoot={workspaceRoot}
          isSplit={isSplit}
          splitDirection={splitDirection}
          draggedTabId={draggedTabId}
          dragOverTarget={dragOverTarget}
          splitDropTarget={splitDropTarget}
          onSelectTab={setActiveTab}
          onCloseTab={closeTab}
          onContextMenu={handleTabContextMenu}
          onNewChat={handleNewChat}
          onSplitTab={splitTab}
          onToggleSplitDirection={() =>
            setSplitDirection(
              splitDirection === 'horizontal' ? 'vertical' : 'horizontal',
            )
          }
          onCloseSplit={closeSplit}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onContainerDragOver={handleContainerDragOver}
          onContainerDrop={handleContainerDrop}
          onDragEnd={handleDragEnd}
          onContentDragOver={handleContentDragOver}
          onContentDragLeave={handleContentDragLeave}
          onContentDrop={handleContentDrop}
        />
      ) : (
        <PanelGroup
          direction={splitDirection}
          className="h-full w-full overflow-hidden"
        >
          <Panel
            id="fortress-pane-primary"
            defaultSize={50}
            minSize={20}
            className="min-w-0 h-full overflow-hidden"
          >
            <WorkspacePane
              pane="primary"
              paneTabs={primaryTabs}
              activeTabId={activeTabId}
              workspaceRoot={workspaceRoot}
              isSplit={isSplit}
              splitDirection={splitDirection}
              draggedTabId={draggedTabId}
              dragOverTarget={dragOverTarget}
              splitDropTarget={splitDropTarget}
              onSelectTab={setActiveTab}
              onCloseTab={closeTab}
              onContextMenu={handleTabContextMenu}
              onNewChat={handleNewChat}
              onSplitTab={splitTab}
              onToggleSplitDirection={() =>
                setSplitDirection(
                  splitDirection === 'horizontal' ? 'vertical' : 'horizontal',
                )
              }
              onCloseSplit={closeSplit}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onContainerDragOver={handleContainerDragOver}
              onContainerDrop={handleContainerDrop}
              onDragEnd={handleDragEnd}
              onContentDragOver={handleContentDragOver}
              onContentDragLeave={handleContentDragLeave}
              onContentDrop={handleContentDrop}
            />
          </Panel>
          <SplitResizeHandle direction={splitDirection} />
          <Panel
            id="fortress-pane-secondary"
            defaultSize={50}
            minSize={20}
            className="min-w-0 h-full overflow-hidden"
          >
            <WorkspacePane
              pane="secondary"
              paneTabs={secondaryTabs}
              activeTabId={secondaryActiveTabId}
              workspaceRoot={workspaceRoot}
              isSplit={isSplit}
              splitDirection={splitDirection}
              draggedTabId={draggedTabId}
              dragOverTarget={dragOverTarget}
              splitDropTarget={splitDropTarget}
              onSelectTab={setActiveTab}
              onCloseTab={closeTab}
              onContextMenu={handleTabContextMenu}
              onNewChat={handleNewChat}
              onSplitTab={splitTab}
              onToggleSplitDirection={() =>
                setSplitDirection(
                  splitDirection === 'horizontal' ? 'vertical' : 'horizontal',
                )
              }
              onCloseSplit={closeSplit}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onContainerDragOver={handleContainerDragOver}
              onContainerDrop={handleContainerDrop}
              onDragEnd={handleDragEnd}
              onContentDragOver={handleContentDragOver}
              onContentDragLeave={handleContentDragLeave}
              onContentDrop={handleContentDrop}
            />
          </Panel>
        </PanelGroup>
      )}

      {/* Floating Context Menu */}
      {contextMenuState &&
        createPortal(
          <div
            ref={contextMenuRef}
            role="menu"
            className="fixed z-50 w-44 rounded-md border border-border bg-popover/95 p-1 text-popover-foreground shadow-md backdrop-blur-sm text-xs select-none"
            style={{
              left: Math.max(8, Math.min(contextMenuState.x, window.innerWidth - 184)),
              top: Math.max(8, Math.min(contextMenuState.y, window.innerHeight - 200)),
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left cursor-pointer"
              onClick={() => {
                closeTab(contextMenuState.tabId);
                setContextMenuState(null);
              }}
            >
              {t('workspace.close')}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={
                tabs
                  .filter(
                    (t) => (t.pane ?? 'primary') === contextMenuState.pane,
                  )
                  .findIndex((t) => t.id === contextMenuState.tabId) <= 0
              }
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
              onClick={() => {
                handleCloseToLeft(contextMenuState.tabId, contextMenuState.pane);
                setContextMenuState(null);
              }}
            >
              {t('workspace.closeLeft')}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={
                tabs
                  .filter(
                    (t) => (t.pane ?? 'primary') === contextMenuState.pane,
                  )
                  .findIndex((t) => t.id === contextMenuState.tabId) ===
                tabs.filter(
                  (t) => (t.pane ?? 'primary') === contextMenuState.pane,
                ).length -
                  1
              }
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
              onClick={() => {
                handleCloseToRight(contextMenuState.tabId, contextMenuState.pane);
                setContextMenuState(null);
              }}
            >
              {t('workspace.closeRight')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left cursor-pointer"
              onClick={() => {
                handleCloseOthers(contextMenuState.tabId, contextMenuState.pane);
                setContextMenuState(null);
              }}
            >
              {t('workspace.closeOthers')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left cursor-pointer"
              onClick={() => {
                closeAllTabs(contextMenuState.pane);
                setContextMenuState(null);
              }}
            >
              {t('workspace.closeAll')}
            </button>

            <div className="-mx-1 my-1 h-px bg-border" />

            {!isSplit && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    splitTab(contextMenuState.tabId, 'horizontal', 'right');
                    setContextMenuState(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left cursor-pointer"
                >
                  <Columns2 className="h-3.5 w-3.5 text-primary" />
                  <span>{t('workspace.splitRight')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    splitTab(contextMenuState.tabId, 'vertical', 'bottom');
                    setContextMenuState(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left cursor-pointer"
                >
                  <Rows2 className="h-3.5 w-3.5 text-primary" />
                  <span>{t('workspace.splitBottom')}</span>
                </button>
              </>
            )}

            {isSplit && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  moveTabToPane(
                    contextMenuState.tabId,
                    contextMenuState.pane === 'primary'
                      ? 'secondary'
                      : 'primary',
                  );
                  setContextMenuState(null);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left cursor-pointer"
              >
                <Columns2 className="h-3.5 w-3.5 text-primary" />
                <span>
                  {contextMenuState.pane === 'primary'
                    ? t('workspace.moveToOpposite')
                    : t('workspace.moveToPrimary')}
                </span>
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

export default CenterWorkspace;
