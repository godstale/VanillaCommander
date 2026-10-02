import { useState, useEffect } from 'react';
import {
  Folder,
  FolderOpen,
  FolderX,
  FilePlus,
  Settings,
  Bot,
  MessageSquare,
  Files,
  Clock,
  Minus,
  Square,
  X,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspace } from '@/lib/context/WorkspaceContext';
import { useSidePanel } from '@/lib/context/SidePanelContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useAgents } from '@/lib/context/AgentsContext';
import { useGlobalLlmBusy } from '@/lib/agent/chatQueueManager';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AppMark } from '@/components/brand/AppMark';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export function TopMenuBar() {
  const { t } = useLanguage();
  const { workspaceRoot, setWorkspaceRoot, recentWorkspaces = [] } = useWorkspace();
  const { setActiveView } = useSidePanel();
  const { openTab } = useWorkspaceTabs();
  const { agents, defaultAgent } = useAgents();
  const navigate = useNavigate();
  const hasWorkspace = Boolean(workspaceRoot);
  // LLM 동작 중에는 폴더(프로젝트) 변경을 금지한다.
  const busySessionId = useGlobalLlmBusy();
  const isLlmBusy = busySessionId !== null;
  const folderChangeBlockedTitle = isLlmBusy ? t('topMenu.folderChangeBlocked') : undefined;

  const handlePickFolder = async () => {
    if (isLlmBusy) return;
    try {
      const picked = await invoke<string | null>('pick_project_folder');
      if (picked) {
        const ok = setWorkspaceRoot(picked);
        if (!ok) {
          console.warn('Workspace change blocked: LLM session is running.');
        }
      }
    } catch (err) {
      console.error('Failed to pick project folder:', err);
    }
  };

  const handleCloseFolder = () => {
    if (isLlmBusy) return;
    setWorkspaceRoot(null);
  };

  const handleRecentFolder = (path: string) => {
    if (isLlmBusy) return;
    setWorkspaceRoot(path);
  };

  const handleNewChat = () => {
    if (!hasWorkspace) return;
    // Lazy: open an empty tab only. DB session is created on first send.
    const sessionId = crypto.randomUUID();
    openTab({
      id: `chat:${sessionId}`,
      type: 'chat',
      title: t('topMenu.newChatDefault'),
      meta: { sessionId },
    });
  };

  const handleCreateAgent = () => {
    openTab({
      id: `agent-editor:new-${Date.now()}`,
      type: 'agent-editor',
      title: t('topMenu.newAgent'),
    });
  };

  // P11-01(V3): 모니터링 진입점은 상단 에이전트 메뉴의 직접 열기 하나.
  const handleOpenMonitor = () => {
    if (agents.length === 0) {
      setActiveView('agents');
      return;
    }
    openTab({
      id: `agent-monitor:${defaultAgent.id}`,
      type: 'agent-monitor',
      title: t('agentList.monitor', { name: defaultAgent.name }),
      meta: { agentId: defaultAgent.id },
    });
  };

  const folderName = workspaceRoot
    ? workspaceRoot.split(/[\\/]/).filter(Boolean).pop() || workspaceRoot
    : null;

  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    try {
      const appWindow = getCurrentWindow();
      void appWindow.isMaximized().then(setIsMaximized);
      void appWindow.onResized(() => {
        void appWindow.isMaximized().then(setIsMaximized);
      }).then((fn) => {
        unlisten = fn;
      });
    } catch {
      // Fallback in non-tauri web environment
    }
    return () => {
      unlisten?.();
    };
  }, []);

  const handleMinimize = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.minimize();
    } catch (err) {
      console.warn('Window minimize not available:', err);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      const max = await appWindow.isMaximized();
      setIsMaximized(max);
    } catch (err) {
      console.warn('Window toggle maximize not available:', err);
    }
  };

  const handleClose = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.close();
    } catch (err) {
      console.warn('Window close not available:', err);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (e.buttons === 1) {
      const target = e.target as HTMLElement;
      const isInteractive = target.closest('button, [role="button"], [role="menuitem"], input, a, [data-no-drag="true"]');
      if (!isInteractive) {
        try {
          const appWindow = getCurrentWindow();
          void appWindow.startDragging();
        } catch {
          // ignore
        }
      }
    }
  };

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleMouseDown}
      className="h-8 w-full bg-titlebar border-b border-border/80 flex items-center justify-between pl-2 pr-0 select-none text-xs text-muted-foreground shrink-0 z-40"
    >
      {/* Left: App title & Dropdown Menus */}
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex items-center gap-1.5 px-2 font-semibold text-foreground tracking-wide mr-1">
          <AppMark compact className="h-4 w-4 text-brand" />
          <span className="text-[11px]">Vanilla Commander</span>
        </div>

        {/* File Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08] transition-colors"
            >
              {t('topMenu.file')}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 text-[11px] p-1 [&_[role=menuitem]]:text-[11px] [&_[role=menuitem]]:py-1 [&_[role=menuitem]]:gap-2 [&_[role=menuitem]_svg]:size-3.5">
            <DropdownMenuItem
              disabled={isLlmBusy}
              title={folderChangeBlockedTitle}
              onClick={handlePickFolder}
              className="gap-2 text-[11px] py-1 data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed"
            >
              <FolderOpen className="h-3.5 w-3.5 text-warning" />
              <span>{t('topMenu.openFolder')}</span>
            </DropdownMenuItem>

            {recentWorkspaces.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  disabled={isLlmBusy}
                  title={folderChangeBlockedTitle}
                  className="gap-2 text-[11px] py-1 data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed"
                >
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t('topMenu.openRecent')}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-64 text-[11px] p-1 [&_[role=menuitem]]:text-[11px] [&_[role=menuitem]]:py-1 [&_[role=menuitem]]:gap-2 [&_[role=menuitem]_svg]:size-3.5">
                  {recentWorkspaces.map((path) => (
                    <DropdownMenuItem
                      key={path}
                      disabled={isLlmBusy}
                      title={isLlmBusy ? folderChangeBlockedTitle : path}
                      onClick={() => handleRecentFolder(path)}
                      className="cursor-pointer truncate text-[11px] py-1 data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed"
                    >
                      <span className="truncate">{path}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}

            {workspaceRoot && (
              <DropdownMenuItem
                disabled={isLlmBusy}
                title={folderChangeBlockedTitle}
                onClick={handleCloseFolder}
                className="gap-2 text-[11px] py-1 data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed"
              >
                <FolderX className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{t('topMenu.closeFolder')}</span>
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem
              disabled={!hasWorkspace}
              onClick={() => {
                if (hasWorkspace) {
                  void handleNewChat();
                }
              }}
              className={cn(
                'gap-2 text-[11px] py-1',
                !hasWorkspace
                  ? 'opacity-40 cursor-not-allowed pointer-events-none'
                  : 'cursor-pointer',
              )}
            >
              <FilePlus className="h-3.5 w-3.5 text-primary" />
              <span>{t('topMenu.startNewChat')}</span>
            </DropdownMenuItem>

            <DropdownMenuItem onClick={() => navigate('/settings')} className="gap-2 cursor-pointer text-[11px] py-1">
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{t('topMenu.settings')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Agent Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!hasWorkspace}>
            <button
              type="button"
              disabled={!hasWorkspace}
              title={!hasWorkspace ? t('topMenu.selectFolderFirst') : undefined}
              className={cn(
                'px-2 py-0.5 rounded text-[11px] transition-colors',
                !hasWorkspace
                  ? 'opacity-40 cursor-not-allowed hover:bg-transparent pointer-events-none'
                  : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08] cursor-pointer',
              )}
            >
              {t('topMenu.agent')}
            </button>
          </DropdownMenuTrigger>
          {hasWorkspace && (
            <DropdownMenuContent align="start" className="w-48 text-[11px] p-1 [&_[role=menuitem]]:text-[11px] [&_[role=menuitem]]:py-1 [&_[role=menuitem]]:gap-2 [&_[role=menuitem]_svg]:size-3.5">
              <DropdownMenuItem onClick={handleCreateAgent} className="gap-2 cursor-pointer text-[11px] py-1">
                <Bot className="h-3.5 w-3.5 text-primary" />
                <span>{t('topMenu.createAgent')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setActiveView('agents')}
                className="gap-2 cursor-pointer text-[11px] py-1"
              >
                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{t('topMenu.agentPanel')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleOpenMonitor} className="gap-2 cursor-pointer text-[11px] py-1">
                <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{t('topMenu.openMonitor')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          )}
        </DropdownMenu>

        {/* View Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!hasWorkspace}>
            <button
              type="button"
              disabled={!hasWorkspace}
              title={!hasWorkspace ? t('topMenu.selectFolderFirst') : undefined}
              className={cn(
                'px-2 py-0.5 rounded text-[11px] transition-colors',
                !hasWorkspace
                  ? 'opacity-40 cursor-not-allowed hover:bg-transparent pointer-events-none'
                  : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08] cursor-pointer',
              )}
            >
              {t('topMenu.view')}
            </button>
          </DropdownMenuTrigger>
          {hasWorkspace && (
            <DropdownMenuContent align="start" className="w-48 text-[11px] p-1 [&_[role=menuitem]]:text-[11px] [&_[role=menuitem]]:py-1 [&_[role=menuitem]]:gap-2 [&_[role=menuitem]_svg]:size-3.5">
              <DropdownMenuItem
                onClick={() => setActiveView('explorer')}
                className="gap-2 cursor-pointer text-[11px] py-1"
              >
                <Files className="h-3.5 w-3.5 text-primary" />
                <span>{t('topMenu.explorer')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setActiveView('chat-sessions')}
                className="gap-2 cursor-pointer text-[11px] py-1"
              >
                <MessageSquare className="h-3.5 w-3.5 text-success" />
                <span>{t('topMenu.chatList')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </div>

      {/* Center: Current Workspace Title (Draggable region with interactive center) */}
      <div
        data-tauri-drag-region
        className="flex-1 flex items-center justify-center px-4 overflow-hidden h-full cursor-default"
      >
        {workspaceRoot ? (
          <div
            data-no-drag="true"
            className={cn(
              'flex items-center gap-1.5 text-[11px] text-muted-foreground/80 font-mono truncate px-2 py-0.5 rounded transition-colors',
              isLlmBusy
                ? 'opacity-50 cursor-not-allowed'
                : 'cursor-pointer hover:text-foreground hover:bg-muted/40',
            )}
            onClick={isLlmBusy ? undefined : handlePickFolder}
            title={isLlmBusy ? folderChangeBlockedTitle : `${workspaceRoot} ${t('topMenu.clickToChangeFolder')}`}
          >
            <Folder className="h-3 w-3 text-warning shrink-0" />
            <span className="font-semibold text-foreground">{folderName}</span>
            <span className="opacity-50 text-[10px] truncate max-w-sm hidden sm:inline">
              — {workspaceRoot}
            </span>
          </div>
        ) : (
          <div
            data-no-drag="true"
            className="flex items-center gap-1.5 text-[11px] text-warning/80 font-medium cursor-pointer hover:text-warning transition-colors px-2 py-0.5 rounded hover:bg-muted/40"
            onClick={handlePickFolder}
          >
            <FolderOpen className="h-3 w-3" />
            <span>{t('topMenu.selectProjectFolder')}</span>
          </div>
        )}
      </div>

      {/* Right: Window Controls (Minimize, Maximize/Restore, Close) */}
      <div
        className="flex items-center h-full shrink-0"
        data-no-drag="true"
      >
        <button
          type="button"
          onClick={handleMinimize}
          className="h-full w-11 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08] transition-colors cursor-pointer"
          title={t('topMenu.minimize')}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={handleToggleMaximize}
          className="h-full w-11 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08] transition-colors cursor-pointer"
          title={isMaximized ? t('topMenu.restore') : t('topMenu.maximize')}
        >
          {isMaximized ? (
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="4.5" y="1.5" width="10" height="10" rx="1" />
              <path d="M2.5 5.5H1.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" />
            </svg>
          ) : (
            <Square className="h-3.5 w-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={handleClose}
          className="h-full w-11 flex items-center justify-center text-muted-foreground hover:text-white hover:bg-red-600 transition-colors cursor-pointer"
          title={t('topMenu.close')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}

