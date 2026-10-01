import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  BotOff,
  Trash2,
  RefreshCw,
  Loader2,
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
import { useAgents } from '@/lib/context/AgentsContext';
import { useWorkspace } from '@/lib/context/WorkspaceContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { Agent } from '@/lib/types/agent';
import type { AgentMonitoringSnapshot } from '@/lib/types/monitoring';
import {
  listRecentMonitoringSnapshots,
  getMonitoringSnapshots,
  getMonitoringAgentStats,
  clearMonitoringSnapshots,
  clearConversationSummaries,
  clearAllMonitoringSnapshots,
  clearAllConversationSummaries,
  type MonitoringAgentStats,
} from '@/lib/db/repositories/monitoringRepo';
import { monitoringCollector } from '@/lib/monitoring/monitoringCollector';

type TFn = (key: string, params?: Record<string, string | number>) => string;

function formatTime(iso: string, t: TFn): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60 * 1000) return t('sessions.justNow');
    if (diff < 60 * 60 * 1000)
      return t('sessions.minutesAgo', { n: Math.floor(diff / (60 * 1000)) });
    if (diff < 24 * 60 * 60 * 1000)
      return t('sessions.hoursAgo', { n: Math.floor(diff / (60 * 60 * 1000)) });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

interface AgentHistoryEntry {
  agentId: string;
  agent: Agent | undefined;
  displayName: string;
  deleted: boolean;
  count: number;
  latestTimestamp: string | null;
  latest: AgentMonitoringSnapshot | undefined;
}

/**
 * 모니터링 기록 패널.
 * 개별 스냅샷이 아니라 에이전트 설정 단위 항목을 보여준다.
 * 에이전트 관리 패널과 동일하게 "현재 등록된 에이전트" + "삭제된 에이전트"
 * 항목으로 구성되며, 각 항목은 해당 에이전트의 전체 모니터링 정보·history를
 * 의미한다. 항목 클릭 시 모니터링 화면으로 이동한다.
 */
export function MonitoringListPanel() {
  const { t } = useLanguage();
  const { openTab } = useWorkspaceTabs();
  const {
    agents,
    getAgent,
    getKnownAgentName,
    loading: agentsLoading,
  } = useAgents();
  const { workspaceRoot } = useWorkspace();

  const [stats, setStats] = useState<MonitoringAgentStats[]>([]);
  const [snapshots, setSnapshots] = useState<AgentMonitoringSnapshot[]>([]);
  const [olderLatest, setOlderLatest] = useState<
    Record<string, AgentMonitoringSnapshot>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  // 최근 200건 밖에 있는 에이전트의 최신 스냅샷을 중복 조회하지 않기 위한 집합.
  const fetchedOlderRef = useRef<Set<string>>(new Set());
  const loadedRootRef = useRef<string | null | undefined>(undefined);

  const loadData = useCallback(
    async (quiet = false) => {
      if (loadedRootRef.current !== workspaceRoot) {
        loadedRootRef.current = workspaceRoot;
        fetchedOlderRef.current.clear();
        setOlderLatest({});
      }
      if (!quiet) setIsLoading(true);
      try {
        const [statsRows, recentRows] = await Promise.all([
          getMonitoringAgentStats(workspaceRoot),
          listRecentMonitoringSnapshots(200, workspaceRoot),
        ]);
        setStats(statsRows);
        setSnapshots(recentRows);
        // 최근 200건에 없는 에이전트는 최신 1건만 별도로 조회해
        // 모델·상태·시각 표시에 사용한다.
        const seen = new Set(recentRows.map((r) => r.agentId));
        const missing = statsRows
          .map((s) => s.agentId)
          .filter((id) => !seen.has(id) && !fetchedOlderRef.current.has(id));
        if (missing.length > 0) {
          const extra = await Promise.all(
            missing.map((id) =>
              getMonitoringSnapshots(id, 1, workspaceRoot)
                .then((rows) => rows[0])
                .catch(() => undefined),
            ),
          );
          const found = extra.filter(
            (s): s is AgentMonitoringSnapshot => s !== undefined,
          );
          for (const s of found) fetchedOlderRef.current.add(s.agentId);
          if (found.length > 0) {
            setOlderLatest((prev) => {
              const next = { ...prev };
              for (const s of found) next[s.agentId] = s;
              return next;
            });
          }
        }
      } catch (err) {
        console.error('Failed to load monitoring history:', err);
      } finally {
        if (!quiet) setIsLoading(false);
      }
    },
    [workspaceRoot],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트/워크스페이스 변경 시 외부 DB와 초기 동기화
    void loadData(false);
  }, [loadData]);

  // 수집기가 새 스냅샷을 만들 때마다 DB를 다시 읽는다 (쓰로틀로 폭주 방지).
  useEffect(() => {
    let active = true;
    let lastReload = 0;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = monitoringCollector.subscribeAll(() => {
      if (!active) return;
      const now = Date.now();
      const elapsed = now - lastReload;
      if (elapsed >= 2000) {
        lastReload = now;
        void loadData(true);
      } else if (pendingTimer === null) {
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          if (!active) return;
          lastReload = Date.now();
          void loadData(true);
        }, 2000 - elapsed);
      }
    });
    return () => {
      active = false;
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      unsubscribe();
    };
  }, [loadData]);

  // 최근 스냅샷에서 에이전트별 최신 행을 구한다.
  const latestByAgent = useMemo(() => {
    const map = new Map<string, AgentMonitoringSnapshot>();
    for (const s of snapshots) {
      if (!map.has(s.agentId)) map.set(s.agentId, s);
    }
    for (const s of Object.values(olderLatest)) {
      if (!map.has(s.agentId)) map.set(s.agentId, s);
    }
    return map;
  }, [snapshots, olderLatest]);

  const statsById = useMemo(() => {
    const map = new Map<string, MonitoringAgentStats>();
    for (const s of stats) map.set(s.agentId, s);
    return map;
  }, [stats]);

  const registeredEntries = useMemo<AgentHistoryEntry[]>(() => {
    if (agentsLoading) return [];
    return agents.map((agent) => {
      const stat = statsById.get(agent.id);
      const latest = latestByAgent.get(agent.id);
      return {
        agentId: agent.id,
        agent,
        displayName: agent.name,
        deleted: false,
        count: stat?.count ?? 0,
        latestTimestamp: latest?.timestamp ?? stat?.latestTimestamp ?? null,
        latest,
      };
    });
  }, [agents, agentsLoading, statsById, latestByAgent]);

  const deletedEntries = useMemo<AgentHistoryEntry[]>(() => {
    if (agentsLoading) return [];
    return stats
      .filter((s) => getAgent(s.agentId) === undefined)
      .map((s) => ({
        agentId: s.agentId,
        agent: undefined,
        displayName:
          getKnownAgentName(s.agentId) ?? t('sessions.agentDeleted'),
        deleted: true,
        count: s.count,
        latestTimestamp:
          latestByAgent.get(s.agentId)?.timestamp ?? s.latestTimestamp,
        latest: latestByAgent.get(s.agentId),
      }));
  }, [stats, agentsLoading, getAgent, getKnownAgentName, latestByAgent, t]);

  const totalRecords = useMemo(
    () => stats.reduce((acc, s) => acc + s.count, 0),
    [stats],
  );

  const handleOpenMonitor = (entry: AgentHistoryEntry) => {
    openTab({
      id: `agent-monitor:${entry.agentId}`,
      type: 'agent-monitor',
      title: t('agentList.monitor', { name: entry.displayName }),
      meta: { agentId: entry.agentId },
    });
  };

  const handleDeleteAgentHistory = async (
    e: React.MouseEvent,
    agentId: string,
  ) => {
    e.stopPropagation();
    setDeletingId(agentId);
    try {
      await clearMonitoringSnapshots(agentId, workspaceRoot);
      await clearConversationSummaries(agentId, workspaceRoot);
      setStats((prev) => prev.filter((s) => s.agentId !== agentId));
      setSnapshots((prev) => prev.filter((s) => s.agentId !== agentId));
      fetchedOlderRef.current.delete(agentId);
      setOlderLatest((prev) => {
        if (!(agentId in prev)) return prev;
        const next = { ...prev };
        delete next[agentId];
        return next;
      });
    } catch (err) {
      console.error('Failed to delete monitoring history:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      await clearAllMonitoringSnapshots(workspaceRoot);
      await clearAllConversationSummaries(workspaceRoot);
      setStats([]);
      setSnapshots([]);
      fetchedOlderRef.current.clear();
      setOlderLatest({});
      setClearConfirmOpen(false);
    } catch (err) {
      console.error('Failed to clear monitoring history:', err);
    } finally {
      setIsClearing(false);
    }
  };

  const renderAgentRow = (entry: AgentHistoryEntry) => {
    const isDeleting = deletingId === entry.agentId;
    const Icon = entry.deleted ? BotOff : Bot;
    const model =
      entry.latest?.llmModel || entry.agent?.model || '—';
    const sub =
      entry.count > 0
        ? `${model} • ${t('monitoringList.recordsCount', { n: entry.count })}${entry.latest ? ` • ${entry.latest.agentStatus}` : ''}`
        : `${model} • ${t('monitoringList.noRecords')}`;

    return (
      <div
        key={entry.agentId}
        role="button"
        tabIndex={0}
        onClick={() => handleOpenMonitor(entry)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleOpenMonitor(entry);
          }
        }}
        className="group relative flex items-start justify-between rounded-lg p-2.5 text-xs transition-colors cursor-pointer border text-foreground hover:bg-muted/60 border-transparent"
      >
        <div className="flex-1 min-w-0 pr-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-medium truncate min-w-0">
              <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
              <span
                className={`truncate ${entry.deleted ? 'line-through text-muted-foreground' : ''}`}
                title={entry.deleted ? t('sessions.agentDeleted') : undefined}
              >
                {entry.displayName}
              </span>
            </div>
            {entry.latestTimestamp && (
              <span className="text-[11px] text-muted-foreground shrink-0">
                {formatTime(entry.latestTimestamp, t)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground truncate">
            <span className="truncate font-mono">{sub}</span>
          </div>
        </div>

        {entry.count > 0 && (
          <Button
            variant="ghost"
            size="icon"
            disabled={isDeleting}
            onClick={(e) => void handleDeleteAgentHistory(e, entry.agentId)}
            className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-opacity shrink-0"
            title={t('monitoringList.deleteHistory')}
          >
            {isDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>
    );
  };

  const itemCount = registeredEntries.length + deletedEntries.length;
  const showLoading =
    (isLoading || agentsLoading) &&
    registeredEntries.length === 0 &&
    deletedEntries.length === 0;
  const showEmpty =
    !showLoading &&
    registeredEntries.length === 0 &&
    deletedEntries.length === 0;

  return (
    <div className="flex flex-col h-full bg-sidebar select-none">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          {t('monitoringList.titleCount', { n: itemCount })}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => void loadData(false)}
            disabled={isLoading}
            title={t('monitoringList.refresh')}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-40"
            onClick={() => setClearConfirmOpen(true)}
            disabled={totalRecords === 0 || isClearing}
            title={t('monitoringList.clearAll')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {showLoading ? (
          <div className="flex items-center justify-center p-8 text-xs text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>{t('monitoringList.loading')}</span>
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
            <Activity className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-xs font-medium">{t('monitoringList.empty')}</p>
            <p className="text-[11px] opacity-70 mt-1">
              {t('monitoringList.emptyDesc')}
            </p>
          </div>
        ) : (
          <>
            {registeredEntries.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('monitoringList.currentAgents')}
                </div>
                {registeredEntries.map(renderAgentRow)}
              </div>
            )}
            {deletedEntries.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('monitoringList.deletedAgents')}
                </div>
                {deletedEntries.map(renderAgentRow)}
              </div>
            )}
          </>
        )}
      </div>

      {/* 전체 삭제 확인 팝업 (필수) */}
      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('monitoringList.clearConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('monitoringList.clearConfirmDesc', { n: totalRecords })}
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

export default MonitoringListPanel;
