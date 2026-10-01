import { useMemo, useState } from 'react';
import {
  MessageSquare,
  Plus,
  Trash2,
  Calendar,
  Loader2,
  BotOff,
  Bot,
  Server,
  Cpu,
  ChevronDown,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useChatSessions } from '@/lib/context/ChatSessionsContext';
import { useAgents } from '@/lib/context/AgentsContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { getProviderPreset } from '@/lib/llm/providers';
import {
  getSessionGroupKey,
  groupSessions,
  UNKNOWN_GROUP_SEGMENT,
  type SessionFilterMode,
} from '@/lib/chatsessions/sessionGroups';
import type { LlmProviderKind } from '@/lib/types/agent';
import type { ChatSession } from '@/lib/types/chat';

type TFn = (key: string, params?: Record<string, string | number>) => string;

function formatTokens(n: number): string {
  if (n >= 1024 && n % 1024 === 0) return `${Math.round(n / 1024)}K`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${n}`;
}

function formatDate(iso: string, t: TFn): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();

    if (diff < 60 * 1000) return t('sessions.justNow');
    if (diff < 60 * 60 * 1000) return t('sessions.minutesAgo', { n: Math.floor(diff / (60 * 1000)) });
    if (diff < 24 * 60 * 60 * 1000)
      return t('sessions.hoursAgo', { n: Math.floor(diff / (60 * 60 * 1000)) });

    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

const FILTER_STORAGE_KEY = 'fortress:session-filter';

function readStoredFilterMode(): SessionFilterMode {
  try {
    const saved = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (
      saved === 'agent' ||
      saved === 'provider' ||
      saved === 'model'
    ) {
      return saved;
    }
  } catch {
    // localStorage 미지원 환경에서는 전체 보기로 폴백한다.
  }
  return 'all';
}

export function ChatSessionList() {
  const { t } = useLanguage();
  const { openTab, closeTab, closeTabs, activeTabId, secondaryActiveTabId } =
    useWorkspaceTabs();
  const { getAgent, getKnownAgentName, loading: agentsLoading } = useAgents();
  const { settings } = useSettings();
  const {
    sessions,
    isLoading,
    deleteSession,
    clearSessions,
    selectSession,
  } = useChatSessions();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [filterMode, setFilterMode] =
    useState<SessionFilterMode>(readStoredFilterMode);
  const [manuallyCollapsed, setManuallyCollapsed] = useState<Set<string>>(
    () => new Set(),
  );

  const handleNewChat = () => {
    // Empty chat tabs are not registered in the conversation list.
    // The session row is created lazily on first send (ChatTab.handleSendMessage).
    const sessionId = crypto.randomUUID();
    openTab({
      type: 'chat',
      id: `chat:${sessionId}`,
      title: t('sessions.newChat'),
      meta: { sessionId },
    });
  };

  const handleSelectSession = (session: ChatSession) => {
    selectSession(session.id);
    openTab({
      type: 'chat',
      id: `chat:${session.id}`,
      title: session.title,
      meta: { sessionId: session.id, agentId: session.agentId },
    });
  };

  const handleDeleteSession = async (
    e: React.MouseEvent,
    sessionId: string,
  ) => {
    e.stopPropagation();
    if (!window.confirm(t('sessions.deleteConfirm'))) {
      return;
    }

    setDeletingId(sessionId);
    try {
      await deleteSession(sessionId);
      closeTab(`chat:${sessionId}`);
    } catch (err) {
      console.error('Failed to delete chat session:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      const ids = sessions.map((s) => `chat:${s.id}`);
      await clearSessions();
      if (ids.length > 0) closeTabs(ids);
      setClearConfirmOpen(false);
    } catch (err) {
      console.error('Failed to clear all chat sessions:', err);
    } finally {
      setIsClearing(false);
    }
  };

  const handleFilterChange = (mode: SessionFilterMode) => {
    setFilterMode(mode);
    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, mode);
    } catch {
      // 저장 실패는 무시하고 이번 세션 동안만 유지한다.
    }
  };

  const toggleGroup = (key: string) => {
    setManuallyCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const groups = useMemo(
    () =>
      filterMode === 'all'
        ? null
        : groupSessions(sessions, filterMode, getAgent),
    [sessions, filterMode, getAgent],
  );

  // 탭에 표시 중인 대화가 속한 그룹은 접힘 상태라도 자동으로 펼친다.
  const openSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tabId of [activeTabId, secondaryActiveTabId]) {
      if (tabId?.startsWith('chat:')) {
        ids.add(tabId.slice('chat:'.length));
      }
    }
    return ids;
  }, [activeTabId, secondaryActiveTabId]);

  const collapsedGroups = useMemo(() => {
    if (
      filterMode === 'all' ||
      openSessionIds.size === 0 ||
      manuallyCollapsed.size === 0
    ) {
      return manuallyCollapsed;
    }
    const next = new Set(manuallyCollapsed);
    for (const session of sessions) {
      if (openSessionIds.has(session.id)) {
        next.delete(getSessionGroupKey(session, filterMode, getAgent));
      }
    }
    return next;
  }, [filterMode, sessions, openSessionIds, manuallyCollapsed, getAgent]);

  const resolveGroupHeader = (key: string) => {
    if (filterMode === 'agent') {
      const agentId = key.slice('agent:'.length);
      const agent = agentsLoading
        ? undefined
        : getAgent(agentId);
      if (agent) return { label: agent.name, Icon: Bot, deleted: false };
      const known = agentsLoading ? null : getKnownAgentName(agentId);
      return {
        label: agentsLoading ? '…' : (known ?? t('sessions.agentDeleted')),
        Icon: BotOff,
        deleted: !agentsLoading,
      };
    }
    if (filterMode === 'provider') {
      const segment = key.slice('provider:'.length);
      if (segment === UNKNOWN_GROUP_SEGMENT) {
        return {
          label: agentsLoading ? '…' : t('sessions.agentDeleted'),
          Icon: BotOff,
          deleted: true,
        };
      }
      return {
        label: getProviderPreset(segment as LlmProviderKind).label,
        Icon: Server,
        deleted: false,
      };
    }
    const segment = key.slice('model:'.length);
    if (segment === UNKNOWN_GROUP_SEGMENT) {
      return {
        label: agentsLoading ? '…' : t('sessions.agentDeleted'),
        Icon: BotOff,
        deleted: true,
      };
    }
    return { label: segment, Icon: Cpu, deleted: false };
  };

  const renderSessionRow = (session: ChatSession) => {
    const isTabActive =
      activeTabId === `chat:${session.id}` ||
      secondaryActiveTabId === `chat:${session.id}`;
    const isDeleting = deletingId === session.id;
    // 삭제된 에이전트의 세션도 이름을 표시한다. 취소선으로 삭제됨을 알린다.
    const boundAgent = agentsLoading ? undefined : getAgent(session.agentId);
    const isAgentDeleted = !agentsLoading && !boundAgent;
    const knownAgentName = agentsLoading
      ? undefined
      : (boundAgent?.name ?? getKnownAgentName(session.agentId));
    const deletedDisplayName = knownAgentName ?? t('sessions.agentDeleted');
    const providerLabel = boundAgent
      ? getProviderPreset(boundAgent.llmProvider).label
      : null;
    const ctxLimit = boundAgent
      ? (boundAgent.contextSize > 0
        ? boundAgent.contextSize
        : settings.defaultContextSize || 8192)
      : null;

    return (
      <div
        key={session.id}
        role="button"
        tabIndex={0}
        onClick={() => handleSelectSession(session)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleSelectSession(session);
          }
        }}
        title={isAgentDeleted ? t('sessions.agentDeleted') : undefined}
        className={`group relative flex items-start justify-between rounded-lg p-2.5 text-xs transition-colors cursor-pointer border ${
          isTabActive
            ? 'bg-accent text-accent-foreground border-border font-medium shadow-xs'
            : 'text-foreground hover:bg-muted/60 border-transparent'
        } ${isAgentDeleted ? 'opacity-50' : ''}`}
      >
        <div className="flex-1 min-w-0 pr-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-medium truncate min-w-0">
              <MessageSquare className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="truncate">{session.title}</span>
            </div>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
              <Calendar className="h-3 w-3 opacity-60" />
              {formatDate(session.updatedAt, t)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground truncate">
            {boundAgent && providerLabel && ctxLimit !== null ? (
              <span className="truncate font-mono">
                {providerLabel} • {boundAgent.model} • {t('sessions.ctxValue', { n: formatTokens(ctxLimit) })}
              </span>
            ) : (
              isAgentDeleted && (
                <span className="flex items-center gap-1 min-w-0">
                  <BotOff className="h-3 w-3 shrink-0 text-warning" />
                  <span className="truncate line-through" title={t('sessions.agentDeleted')}>
                    {deletedDisplayName}
                  </span>
                  <span className="shrink-0 text-warning">
                    {t('sessions.deletedSuffix')}
                  </span>
                </span>
              )
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          disabled={isDeleting}
          onClick={(e) => void handleDeleteSession(e, session.id)}
          className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-opacity shrink-0"
          title={t('sessions.deleteSession')}
        >
          {isDeleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-sidebar select-none">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />
          {t('sessions.title')}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-40"
            onClick={() => setClearConfirmOpen(true)}
            disabled={sessions.length === 0 || isClearing}
            title={t('sessions.clearAll')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-foreground hover:text-primary"
            onClick={() => void handleNewChat()}
            title={t('sessions.startNew')}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
        <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <select
          value={filterMode}
          onChange={(e) =>
            handleFilterChange(e.target.value as SessionFilterMode)
          }
          aria-label={t('sessions.filterLabel')}
          className="w-full bg-transparent text-xs text-foreground outline-none cursor-pointer"
        >
          <option value="all">{t('sessions.filterAll')}</option>
          <option value="agent">{t('sessions.filterByAgent')}</option>
          <option value="provider">{t('sessions.filterByProvider')}</option>
          <option value="model">{t('sessions.filterByModel')}</option>
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && sessions.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-xs text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>{t('sessions.loading')}</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
            <MessageSquare className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-xs font-medium">{t('sessions.empty')}</p>
            <p className="text-[11px] opacity-70 mt-1">
              {t('sessions.emptyDesc')}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 text-xs"
              onClick={() => void handleNewChat()}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />{t('sessions.startNew')}
            </Button>
          </div>
        ) : groups ? (
          groups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.key);
            const { label, Icon, deleted } = resolveGroupHeader(group.key);
            const ToggleIcon = isCollapsed ? ChevronRight : ChevronDown;
            return (
              <div key={group.key} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={!isCollapsed}
                  title={
                    isCollapsed
                      ? t('sessions.expandGroup')
                      : t('sessions.collapseGroup')
                  }
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                >
                  <ToggleIcon className="h-3.5 w-3.5 shrink-0" />
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className={`truncate font-medium text-left flex-1 min-w-0 ${deleted ? 'line-through' : ''}`}>
                    {label}
                  </span>
                  <span className="text-[11px] tabular-nums shrink-0">
                    {group.sessions.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="space-y-1">
                    {group.sessions.map(renderSessionRow)}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          sessions.map(renderSessionRow)
        )}
      </div>

      {/* 대화 목록 전체 삭제 확인 팝업 (필수) */}
      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sessions.clearConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('sessions.clearConfirmDesc', { n: sessions.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setClearConfirmOpen(false)}
              disabled={isClearing}
            >
              {t('monitor.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleClearAll()}
              disabled={isClearing}
            >
              {isClearing ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1" />
              )}
              {t('monitor.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ChatSessionList;
