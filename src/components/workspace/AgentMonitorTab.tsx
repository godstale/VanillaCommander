import { useEffect, useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import {
  Activity,
  Cpu,
  Layers,
  Thermometer,
  HardDrive,
  RefreshCw,
  Play,
  Pause,
  FileDown,
  Trash2,
  AlertCircle,
  Eye,
  Server,
  Zap,
  Clock,
  Radio,
  FileText,
  Copy,
  Check,
  Gauge,
  GripVertical,
  Timer,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  Brain,
  Coins,
} from 'lucide-react';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import { useAgents } from '@/lib/context/AgentsContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useWorkspace } from '@/lib/context/WorkspaceContext';
import { Button } from '@/components/ui/button';
import { HelpTooltip as KpiCardHelp } from '@/components/ui/help-tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type {
  AgentMonitoringSnapshot,
  ConversationTokenSummary,
  ConversationTokenTotals,
  TokenStatusKey,
  TurnTokenContribution,
} from '@/lib/types/monitoring';
import { emptyStatusTokens } from '@/lib/types/monitoring';
import {
  getMonitoringSnapshots,
  getConversationSummaries,
  clearMonitoringSnapshots,
  clearConversationSummaries,
} from '@/lib/db/repositories/monitoringRepo';
import {
  getConversations as getLiveConversations,
  getActiveConversationId,
  getActiveTotals,
  subscribe as subscribeTokenTracker,
  clear as clearTokenTracker,
} from '@/lib/monitoring/tokenTracker';
import { monitoringCollector, DEFAULT_MONITORING_INTERVAL_MS } from '@/lib/monitoring/monitoringCollector';
import { listModels } from '@/lib/llm/ollamaClient';
import {
  listProviderModels,
  resolveBaseUrlForAgent,
  resolveRuntimeForAgent,
} from '@/lib/llm/providerRuntime';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const CHART_COLORS = {
  gpu: 'hsl(var(--chart-3))',
  vram: 'hsl(var(--chart-2))',
  prefill: 'hsl(var(--chart-4))',
  decoding: 'hsl(var(--chart-5))',
  thinking: 'hsl(var(--chart-1))',
  tool: '#f59e0b',
  generating: 'hsl(var(--chart-3))',
  approval: 'hsl(var(--destructive))',
} as const;

const TOKEN_STATUS_ORDER: Array<{ key: TokenStatusKey; label: string; color: string }> = [
  { key: 'thinking', label: 'Thinking', color: 'hsl(var(--chart-1))' },
  { key: 'prefill', label: 'Prefill', color: 'hsl(var(--chart-4))' },
  { key: 'decoding', label: 'Decoding', color: 'hsl(var(--chart-5))' },
  { key: 'generating', label: 'Generating', color: 'hsl(var(--chart-3))' },
  { key: 'executing_tool', label: 'Tool', color: '#f59e0b' },
  { key: 'waiting_approval', label: 'Wait', color: 'hsl(var(--destructive))' },
];

/** 원장(영속) + 실시간(live) 대화 합산. id 중복 제거 후 최신순, 최대 50건. */
function mergeConversationLists(
  ledger: ConversationTokenSummary[],
  live: ConversationTokenSummary[],
): ConversationTokenSummary[] {
  const seen = new Set(ledger.map((c) => c.id));
  const merged = [...live.filter((c) => !seen.has(c.id)), ...ledger];
  merged.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return merged.slice(0, 50);
}

/** 대화 목록 전체의 토큰 합계 (대화별 카드 + 전체 누적 표시용) */
function sumConversationTotals(list: ConversationTokenSummary[]): ConversationTokenTotals {
  const totals: ConversationTokenTotals = {
    conversationCount: list.length,
    turnCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    contentTokens: 0,
    totalTokens: 0,
    statusTokens: emptyStatusTokens(),
  };
  for (const c of list) {
    totals.turnCount += c.turnCount;
    totals.inputTokens += c.inputTokens;
    totals.outputTokens += c.outputTokens;
    totals.thinkingTokens += c.thinkingTokens;
    totals.contentTokens += c.contentTokens;
    for (const key of Object.keys(totals.statusTokens) as Array<TokenStatusKey>) {
      totals.statusTokens[key] += c.statusTokens[key] ?? 0;
    }
  }
  totals.totalTokens = totals.inputTokens + totals.outputTokens;
  return totals;
}

function isIdleLikeSnapshot(s: AgentMonitoringSnapshot): boolean {
  if (s.agentStatus !== 'idle') return false;
  if ((s.gpuUtilizationPct ?? 0) >= 5) return false;
  const hasPrefill = (s.prefillSpeed ?? 0) > 0 || (s.prefillDurationMs ?? 0) > 0 || (s.prefillTokens ?? 0) > 0;
  if (hasPrefill) return false;
  const hasDecoding = (s.decodingSpeed ?? 0) > 0 || (s.decodingDurationMs ?? 0) > 0 || (s.decodingTokens ?? 0) > 0;
  if (hasDecoding) return false;
  if ((s.thinkingTokens ?? 0) > 0) return false;
  return true;
}

function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  if (sec < 3600) {
    const rest = (sec % 60).toFixed(0);
    return `${min}m ${rest}s`;
  }
  const h = Math.floor(min / 60);
  const restMin = min % 60;
  return `${h}h ${restMin}m`;
}

/** 앱 표시 언어 기준 시각 포맷. 시스템 로케일(ko Windows) 고정 방지를 위해 명시적 로케일 전달. */
function formatTimeOfDay(
  value: string | number | Date,
  locale: string,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  const tag = locale === 'ko' ? 'ko-KR' : 'en-US';
  return date.toLocaleTimeString(tag, opts);
}

const INTERVAL_OPTIONS = [
  { seconds: 1, value: 1000 },
  { seconds: 2, value: 2000 },
  { seconds: 3, value: 3000 },
  { seconds: 5, value: 5000 },
  { seconds: 10, value: 10000 },
];

function formatMemoryBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatContextTokenSize(tokens?: number): string {
  if (!tokens || tokens <= 0) return '0';
  if (tokens >= 1024 * 1024) {
    const val = tokens / (1024 * 1024);
    return Number.isInteger(val) ? `${val}M` : `${val.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    if (tokens % 1024 === 0) {
      return `${tokens / 1024}k`;
    }
    const val = tokens / 1000;
    return val >= 10 ? `${Math.round(val)}k` : `${val.toFixed(1)}k`;
  }
  return `${tokens}`;
}

function computeDynamicMax(maxValue: number, defaultMin: number): number {
  if (!maxValue || maxValue <= 0) return defaultMin;
  const target = maxValue * 1.25; // 상단 25% 여유 공간 확보
  if (target <= defaultMin) return defaultMin;
  if (target < 50) return Math.ceil(target / 10) * 10;
  if (target < 200) return Math.ceil(target / 25) * 25;
  if (target < 1000) return Math.ceil(target / 50) * 50;
  if (target < 5000) return Math.ceil(target / 250) * 250;
  return Math.ceil(target / 500) * 500;
}

function formatAxisNumber(val: number): string {
  if (val === 0) return '0';
  const absVal = Math.abs(val);
  if (absVal >= 1_000_000) {
    const formatted = (val / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return `${formatted}M`;
  }
  if (absVal >= 1_000) {
    const formatted = (val / 1_000).toFixed(1).replace(/\.0$/, '');
    return `${formatted}k`;
  }
  return Number.isInteger(val) ? `${val}` : `${val.toFixed(1)}`;
}

export function AgentMonitorTab({ tab }: { tab: WorkspaceTab }) {
  const agentId = tab.meta?.agentId as string | undefined;
  const { getAgent } = useAgents();
  const { settings } = useSettings();
  const { workspaceRoot } = useWorkspace();
  const agent = agentId ? getAgent(agentId) : null;

  const [snapshots, setSnapshots] = useState<AgentMonitoringSnapshot[]>([]);
  const [currentSnapshot, setCurrentSnapshot] = useState<AgentMonitoringSnapshot | null>(null);
  const [isCollecting, setIsCollecting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [ollamaErrorDialogOpen, setOllamaErrorDialogOpen] = useState(false);
  const [ollamaErrorMessage, setOllamaErrorMessage] = useState('');
  const [intervalMs, setIntervalMs] = useState<number | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<AgentMonitoringSnapshot | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [timelineOffset, setTimelineOffset] = useState(0);
  const [hideIdleSnapshots, setHideIdleSnapshots] = useState(true);
  // Row 1 카드 순서 (드래그 재배열, localStorage 영속). CSS order로만 재배치한다.
  const ROW1_CARD_IDS = ['sysres', 'memdist', 'realtime'] as const;
  const [row1Order, setRow1Order] = useState<string[]>(() => {
    try {
      const saved = window.localStorage.getItem('fortress.monitorRow1Order');
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        if (
          Array.isArray(parsed) &&
          parsed.length === ROW1_CARD_IDS.length &&
          ROW1_CARD_IDS.every((id) => parsed.includes(id))
        ) {
          return parsed;
        }
      }
    } catch {
      // 저장값이 없거나 깨졌으면 기본 순서
    }
    return [...ROW1_CARD_IDS];
  });
  const [row1DragId, setRow1DragId] = useState<string | null>(null);
  const [row1OverId, setRow1OverId] = useState<string | null>(null);
  const row1OrderOf = (id: string) => {
    const idx = row1Order.indexOf(id);
    return idx >= 0 ? idx : 0;
  };
  const handleRow1Drop = (targetId: string) => {
    if (!row1DragId || row1DragId === targetId) return;
    setRow1Order((prev) => {
      const next = prev.filter((id) => id !== row1DragId);
      const at = next.indexOf(targetId);
      next.splice(at >= 0 ? at : next.length, 0, row1DragId);
      try {
        window.localStorage.setItem('fortress.monitorRow1Order', JSON.stringify(next));
      } catch {
        // 영속 실패는 무시 (인메모리 순서는 유지)
      }
      return next;
    });
  };
  const row1DragHandleProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setRow1DragId(id);
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', id);
      } catch {
        // 일부 브라우저 dataTransfer 제한 무시
      }
    },
    onDragEnd: () => {
      setRow1DragId(null);
      setRow1OverId(null);
    },
  });
  const row1DropZoneProps = (id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (row1DragId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (row1OverId !== id) setRow1OverId(id);
      }
    },
    onDragLeave: () => {
      if (row1OverId === id) setRow1OverId(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setRow1OverId(null);
      handleRow1Drop(id);
    },
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  // 대화 단위 토큰: 원장(영속 DB) + 실시간(live) + 진행 중(active). 모두 state로 보관해
  // 렌더 중에는 외부 저장소를 직접 읽지 않는다(React Compiler purity).
  const [ledgerConversations, setLedgerConversations] = useState<ConversationTokenSummary[]>([]);
  const [liveConversations, setLiveConversations] = useState<ConversationTokenSummary[]>([]);
  const [activeToken, setActiveToken] = useState<{
    id: string | undefined;
    totals: TurnTokenContribution | null;
  }>({ id: undefined, totals: null });
  const TIMELINE_WINDOW_SIZE = 25;
  const { t, locale } = useLanguage();

  // Settings default applies until the user picks another interval in this tab.
  const settingsDefaultInterval = settings.monitoringIntervalMs ?? DEFAULT_MONITORING_INTERVAL_MS;
  const activeIntervalMs = intervalMs ?? settingsDefaultInterval;

  // Stop collector immediately when tab unmounts or agent changes.
  // 자동 모니터링으로 시작된 수집은 대화가 끝날 때까지 유지하므로 닫지 않는다.
  useEffect(() => {
    return () => {
      if (agentId && !monitoringCollector.isAuto(agentId)) {
        monitoringCollector.stop(agentId);
      }
    };
  }, [agentId]);

  // Initial load of historical snapshots
  useEffect(() => {
    if (!agentId) return;
    let active = true;

    void (async () => {
      try {
        const history = await getMonitoringSnapshots(agentId, 100, workspaceRoot);
        if (active) {
          setSnapshots(history);
          if (history.length > 0) {
            setCurrentSnapshot(history[0]);
          }
        }
      } catch (err) {
        console.error('Failed to load initial monitoring snapshots:', err);
      }
    })();

    return () => {
      active = false;
    };
  }, [agentId, workspaceRoot]);

  // 대화 토큰 상태 새로고침: 트래커(live/active) + 원장(영속 DB).
  // 동기 읽기는 이펙트 본문에서만 수행하고, setState는 비동기 연속/구독 콜백에서만
  // 호출한다(react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!agentId) return;
    let active = true;
    const live = getLiveConversations(agentId);
    const activeInfo = {
      id: getActiveConversationId(agentId),
      totals: getActiveTotals(agentId),
    };
    void (async () => {
      try {
        const rows = await getConversationSummaries(agentId, 50, workspaceRoot);
        if (!active) return;
        setLiveConversations(live);
        setActiveToken(activeInfo);
        setLedgerConversations(rows);
      } catch (err) {
        console.error('Failed to load conversation token summaries:', err);
      }
    })();
    const unsubscribe = subscribeTokenTracker(agentId, () => {
      setLiveConversations(getLiveConversations(agentId));
      setActiveToken({
        id: getActiveConversationId(agentId),
        totals: getActiveTotals(agentId),
      });
      void getConversationSummaries(agentId, 50, workspaceRoot)
        .then((rows) => {
          setLedgerConversations(rows);
        })
        .catch(() => undefined);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [agentId, workspaceRoot]);

  // Start periodic collector and subscribe to real-time events
  useEffect(() => {
    if (!agent) return;

    const agentBaseUrl = resolveBaseUrlForAgent(agent, settings.ollamaBaseUrl);
    if (isCollecting) {
      monitoringCollector.start(agent, agentBaseUrl, activeIntervalMs, workspaceRoot);
    } else {
      monitoringCollector.stop(agent.id);
    }

    const unsubscribe = monitoringCollector.subscribe(agent.id, (newSnapshot) => {
      setCurrentSnapshot(newSnapshot);
      setSnapshots((prev) => {
        // Skip consecutive IDLE snapshots: CPU/GPU-only fluctuations while
        // staying IDLE must not grow the history, charts, or timeline.
        const head = prev[0];
        if (
          head &&
          head.agentStatus === newSnapshot.agentStatus &&
          newSnapshot.agentStatus === 'idle' &&
          isIdleLikeSnapshot(newSnapshot) &&
          isIdleLikeSnapshot(head)
        ) {
          return prev;
        }
        // Keep most recent 100 snapshots for history and graphs
        const next = [newSnapshot, ...prev.filter((s) => s.id !== newSnapshot.id)];
        return next.slice(0, 100);
      });
    });

    return () => {
      unsubscribe();
      // 탭이 닫혀도 자동 모니터링 수집은 대화 종료까지 유지한다.
      if (agent.id && !monitoringCollector.isAuto(agent.id)) {
        monitoringCollector.stop(agent.id);
      }
    };
  }, [agent, settings.ollamaBaseUrl, isCollecting, activeIntervalMs, workspaceRoot]);

  // 대화 시작 시 자동 모니터링이 켜졌을 수 있으므로 수집 실행 상태를 주기적으로 동기화한다.
  // (채팅에서 시작/중단된 자동 수집을 모니터 탭의 시작/일시정지 버튼에 반영)
  useEffect(() => {
    if (!agent) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external collector running flag
    setIsCollecting(monitoringCollector.isRunning(agent.id));
    const timer = setInterval(() => {
      setIsCollecting(monitoringCollector.isRunning(agent.id));
    }, 1000);
    return () => clearInterval(timer);
  }, [agent]);

  // Start of the current operational-status run (newest-first history scan).
  // Derived during render so no status-tracking effect is needed.
  const statusRunStartMs = useMemo(() => {
    const status = currentSnapshot?.agentStatus;
    if (!currentSnapshot || !status) return null;
    const ordered =
      snapshots.length > 0 && snapshots[0]?.id === currentSnapshot.id
        ? snapshots
        : [currentSnapshot, ...snapshots];
    let startMs = new Date(currentSnapshot.timestamp).getTime();
    for (const s of ordered) {
      if (s.agentStatus !== status) break;
      const ts = new Date(s.timestamp).getTime();
      if (Number.isFinite(ts) && ts < startMs) startMs = ts;
    }
    return Number.isFinite(startMs) ? startMs : null;
  }, [currentSnapshot, snapshots]);

  const hasSnapshot = currentSnapshot !== null;

  // Live tick for the status duration readout (1s granularity)
  useEffect(() => {
    if (!hasSnapshot) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasSnapshot]);

  const handleToggleCollecting = async () => {
    if (!agent) return;
    if (isCollecting) {
      monitoringCollector.stop(agent.id);
      setIsCollecting(false);
    } else {
      setIsStarting(true);
      try {
        // Verify provider connectivity before starting periodic monitoring
        const agentBaseUrl = resolveBaseUrlForAgent(agent, settings.ollamaBaseUrl);
        if ((agent.llmProvider ?? 'ollama') !== 'ollama') {
          await listProviderModels(resolveRuntimeForAgent(agent, settings.ollamaBaseUrl));
        } else {
          await listModels(agentBaseUrl);
        }
        monitoringCollector.start(agent, agentBaseUrl, activeIntervalMs, workspaceRoot);
        setIsCollecting(true);
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : t('monitor.connFailed');
        setOllamaErrorMessage(errMsg);
        setOllamaErrorDialogOpen(true);
        setIsCollecting(false);
      } finally {
        setIsStarting(false);
      }
    }
  };

  const handleIntervalChange = (newInterval: number) => {
    setIntervalMs(newInterval);
    if (agent && isCollecting) {
      monitoringCollector.setInterval(
        agent.id,
        newInterval,
        agent,
        resolveBaseUrlForAgent(agent, settings.ollamaBaseUrl),
        workspaceRoot,
      );
    }
  };

  const handleManualRefresh = async () => {
    if (!agent) return;
    setManualRefreshing(true);
    try {
      const agentBaseUrl = resolveBaseUrlForAgent(agent, settings.ollamaBaseUrl);
      if ((agent.llmProvider ?? 'ollama') !== 'ollama') {
        await listProviderModels(resolveRuntimeForAgent(agent, settings.ollamaBaseUrl));
      } else {
        await listModels(agentBaseUrl);
      }
      const snap = await monitoringCollector.collectNow(agent, agentBaseUrl, workspaceRoot);
      if (snap) {
        setCurrentSnapshot(snap);
        setSnapshots((prev) => [snap, ...prev.filter((s) => s.id !== snap.id)].slice(0, 100));
      }
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : t('monitor.connFailed');
      setOllamaErrorMessage(errMsg);
      setOllamaErrorDialogOpen(true);
    } finally {
      setManualRefreshing(false);
    }
  };

  const handleClearHistory = async () => {
    if (!agentId) return;
    await clearMonitoringSnapshots(agentId, workspaceRoot);
    await clearConversationSummaries(agentId, workspaceRoot);
    clearTokenTracker(agentId);
    setSnapshots(currentSnapshot ? [currentSnapshot] : []);
    setLedgerConversations([]);
    setLiveConversations([]);
    setActiveToken({ id: undefined, totals: null });
    setClearConfirmOpen(false);
  };

  const handleExportJson = () => {
    if (!agent) return;
    // 대화 토큰 집계는 클릭 시점에 state로부터 직접 계산한다.
    // (렌더 본문의 파생값을 클로저로 캡처하면 purity 분석이 핸들러를 오판한다)
    const tokenConversations = mergeConversationLists(ledgerConversations, liveConversations);
    const payload = {
      agent,
      collectedAt: new Date().toISOString(),
      currentSnapshot,
      historyCount: snapshots.length,
      history: snapshots,
      tokenConversationCount: tokenConversations.length,
      tokenTotals: sumConversationTotals(tokenConversations),
      tokenConversations,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-monitoring-${agent.name}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyJson = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore
    }
  };

  // Prepare chart data (reverse to chronological order left-to-right)
  const timeSeriesData = useMemo(() => {
    return [...snapshots].reverse().map((s) => ({
      time: formatTimeOfDay(s.timestamp, locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      gpuUtilization: s.gpuUtilizationPct,
      vramUsedMb: s.gpuVramUsedMb,
      vramUsedGb: Number((s.gpuVramUsedMb / 1024).toFixed(2)),
      gpuTemp: s.gpuTemperatureC,
      gpuOffloadPct: s.gpuOffloadPct,
      prefillSpeed: s.prefillSpeed ?? 0,
      decodingSpeed: s.decodingSpeed ?? 0,
      prefillDurationMs: s.prefillDurationMs ?? 0,
      decodingDurationMs: s.decodingDurationMs ?? 0,
      prefillDurationSec: s.prefillDurationMs ? Number((s.prefillDurationMs / 1000).toFixed(2)) : 0,
      decodingDurationSec: s.decodingDurationMs ? Number((s.decodingDurationMs / 1000).toFixed(2)) : 0,
      prefillTokens: s.prefillTokens ?? 0,
      decodingTokens: s.decodingTokens ?? 0,
    }));
  }, [snapshots, locale]);

  // Compute dynamic scale upper bounds for dual Y-axis charts with comfortable headroom
  const {
    tokenSpeedMax,
    inferenceMsMax,
  } = useMemo(() => {
    let maxSpeed = 0;
    let maxMs = 0;

    for (const d of timeSeriesData) {
      if (d.prefillSpeed > maxSpeed) maxSpeed = d.prefillSpeed;
      if (d.decodingSpeed > maxSpeed) maxSpeed = d.decodingSpeed;
      if (d.prefillDurationMs > maxMs) maxMs = d.prefillDurationMs;
      if (d.decodingDurationMs > maxMs) maxMs = d.decodingDurationMs;
    }

    return {
      tokenSpeedMax: computeDynamicMax(maxSpeed, 100),
      inferenceMsMax: computeDynamicMax(maxMs, 1000),
    };
  }, [timeSeriesData]);

  // VRAM + RAM unified breakdown — single stacked chart with two bars (VRAM / RAM)
  const memoryBreakdownData = useMemo(() => {
    if (!currentSnapshot) return [];
    const weightsKey = t('monitor.weights');
    const kvKey = t('monitor.kvEst');
    const otherKey = t('monitor.otherUsage');
    const freeKey = t('monitor.freeSpace');
    const details = (currentSnapshot.details || {}) as Record<string, unknown>;

    const kvVramBytes = typeof details.kvVramBytes === 'number'
      ? details.kvVramBytes
      : Math.round(currentSnapshot.kvCacheBytes * (currentSnapshot.gpuOffloadPct / 100));
    // NOTE: size_vram은 VRAM 상주 가중치 실측, KV 추정치는 최대 컨텍스트 기준
    // 이론값이다. 추정치에서 가중치를 빼던 기존 방식(weightOnly)은 KV 과대추정 시
    // 가중치를 0으로 지우고 스택 합이 물리 용량(예: 12GB)을 초과했다. 실측인
    // 가중치·free를 우선 보존하고 KV를 실제 상주분(used - 가중치)으로 제한한다.
    const toGb = (bytes: number) => bytes / (1024 * 1024 * 1024);
    const round2 = (n: number) => Number(n.toFixed(2));
    const totalVramGb = currentSnapshot.gpuVramTotalMb / 1024;
    const usedVramGb = currentSnapshot.gpuVramTotalMb > 0
      ? currentSnapshot.gpuVramUsedMb / 1024
      : toGb(currentSnapshot.vramAllocatedBytes);
    const freeVramGb = currentSnapshot.gpuVramTotalMb > 0
      ? Math.max(0, currentSnapshot.gpuVramFreeMb) / 1024
      : 0;
    const weightsVramRawGb = toGb(currentSnapshot.vramAllocatedBytes);
    const kvVramEstGb = toGb(kvVramBytes);
    let weightsVramGb: number;
    let kvShownVramGb: number;
    let otherVramGb: number;
    if (totalVramGb > 0) {
      weightsVramGb = Math.min(weightsVramRawGb, Math.max(0, usedVramGb));
      kvShownVramGb = Math.min(kvVramEstGb, Math.max(0, usedVramGb - weightsVramGb));
      otherVramGb = Math.max(0, usedVramGb - weightsVramGb - kvShownVramGb);
    } else {
      weightsVramGb = weightsVramRawGb;
      kvShownVramGb = kvVramEstGb;
      otherVramGb = Math.max(0, usedVramGb - weightsVramGb);
    }

    const kvRamBytes = typeof details.kvRamBytes === 'number'
      ? details.kvRamBytes
      : Math.round(currentSnapshot.kvCacheBytes * (1 - currentSnapshot.gpuOffloadPct / 100));
    const modelRamBytes = typeof details.modelRamBytes === 'number'
      ? details.modelRamBytes
      : Math.max(0, currentSnapshot.modelWeightBytes - currentSnapshot.vramAllocatedBytes);
    const totalRamGb = currentSnapshot.systemMemoryTotalMb / 1024;
    const usedRamGb = Math.max(
      0,
      totalRamGb - Math.max(0, currentSnapshot.systemMemoryFreeMb) / 1024,
    );
    const freeRamGb = Math.max(0, currentSnapshot.systemMemoryFreeMb) / 1024;
    const weightsRamRawGb = toGb(modelRamBytes);
    const kvRamEstGb = toGb(kvRamBytes);
    let modelRamGb: number;
    let kvShownRamGb: number;
    let otherRamGb: number;
    if (totalRamGb > 0) {
      modelRamGb = Math.min(weightsRamRawGb, Math.max(0, usedRamGb));
      kvShownRamGb = Math.min(kvRamEstGb, Math.max(0, usedRamGb - modelRamGb));
      otherRamGb = Math.max(0, usedRamGb - modelRamGb - kvShownRamGb);
    } else {
      modelRamGb = weightsRamRawGb;
      kvShownRamGb = kvRamEstGb;
      otherRamGb = Math.max(0, usedRamGb - modelRamGb - kvShownRamGb);
    }

    const weightsVramOut = round2(weightsVramGb);
    const kvVramOut = round2(kvShownVramGb);
    const otherVramOut = round2(otherVramGb);
    const freeVramOut = round2(freeVramGb);
    const modelRamOut = round2(modelRamGb);
    const kvRamOut = round2(kvShownRamGb);
    const otherRamOut = round2(otherRamGb);
    const freeRamOut = round2(freeRamGb);

    return [
      {
        name: t('monitor.vramDistShort'),
        [weightsKey]: weightsVramOut,
        [kvKey]: kvVramOut,
        [otherKey]: otherVramOut,
        [freeKey]: freeVramOut,
      },
      {
        name: t('monitor.ramDistShort'),
        [weightsKey]: modelRamOut,
        [kvKey]: kvRamOut,
        [otherKey]: otherRamOut,
        [freeKey]: freeRamOut,
      },
    ];
  }, [currentSnapshot, t]);

  // LLM phase time breakdown (total accumulated time per detailed phase)
  const llmPhaseBreakdown = useMemo(() => {
    let prefillMs = 0;
    let decodingMs = 0;
    let loadOverheadMs = 0;
    const statusCounts: Record<string, number> = {
      thinking: 0,
      generating: 0,
      executing_tool: 0,
      waiting_approval: 0,
      prefill: 0,
      decoding: 0,
    };
    for (const s of snapshots) {
      // IDLE 스냅샷은 CPU/기타 그래픽 작업의 영향을 받아 LLM 성능과 무관하게
      // 변동하므로 항목별 합계 집계에서 제외한다.
      if (s.agentStatus === 'idle' || isIdleLikeSnapshot(s)) continue;
      prefillMs += s.prefillDurationMs ?? 0;
      decodingMs += s.decodingDurationMs ?? 0;
      const total = s.totalDurationMs ?? 0;
      const overhead = total - (s.prefillDurationMs ?? 0) - (s.decodingDurationMs ?? 0);
      if (overhead > 0) loadOverheadMs += overhead;
      const st = s.agentStatus;
      if (st in statusCounts) {
        statusCounts[st] += 1;
      } else if (st === 'unknown' || st === 'disconnected') {
        // unknown/disconnected excluded from LLM analysis
      } else {
        statusCounts.generating = (statusCounts.generating ?? 0) + 1;
      }
    }
    const wall = (count: number) => count * activeIntervalMs;
    const thinkingMs = wall(statusCounts.thinking);
    const generatingMs = wall(statusCounts.generating);
    const toolMs = wall(statusCounts.executing_tool);
    const approvalMs = wall(statusCounts.waiting_approval);
    // prefill/decoding snapshots counted in wall time would double-count metrics;
    // prefer actual measured durations when available, else wall estimate
    const prefillWall = wall(statusCounts.prefill);
    const decodingWall = wall(statusCounts.decoding);
    const prefillTotal = Math.max(prefillMs, prefillWall);
    const decodingTotal = Math.max(decodingMs, decodingWall);
    const total = thinkingMs + prefillTotal + decodingTotal + generatingMs + toolMs + approvalMs + loadOverheadMs;
    const phases = [
      { phase: t('monitor.phaseThinking'), ms: thinkingMs, fill: CHART_COLORS.thinking },
      { phase: t('monitor.phasePrefill'), ms: Math.round(prefillTotal), fill: CHART_COLORS.prefill },
      { phase: t('monitor.phaseDecoding'), ms: Math.round(decodingTotal), fill: CHART_COLORS.decoding },
      { phase: t('monitor.phaseGenerating'), ms: generatingMs, fill: CHART_COLORS.generating },
      { phase: t('monitor.phaseTool'), ms: toolMs, fill: CHART_COLORS.tool },
      { phase: t('monitor.phaseApproval'), ms: approvalMs, fill: CHART_COLORS.approval },
    ];
    const phaseTotal = phases.reduce((sum, p) => sum + p.ms, 0);
    return {
      phases: phases.map((p) => ({
        ...p,
        pct: phaseTotal > 0 ? Math.round((p.ms / phaseTotal) * 1000) / 10 : 0,
      })),
      phaseTotal,
      total,
    };
  }, [snapshots, activeIntervalMs, t]);

  // 원장(영속) + 실시간(live) 대화 합산 및 전체 누적. 항목이 적어(≤50) 메모 없이
  // 직접 계산한다 — React Compiler가 자동 최적화한다.
  const mergedConversations = mergeConversationLists(ledgerConversations, liveConversations);
  const tokenTotalsAll = sumConversationTotals(mergedConversations);
  const tokenStatusTotal = TOKEN_STATUS_ORDER.reduce(
    (sum, d) => sum + (tokenTotalsAll.statusTokens[d.key] ?? 0),
    0,
  );

  const filteredSnapshots = useMemo(() => {
    if (!hideIdleSnapshots) return snapshots;
    return snapshots.filter((s) => !isIdleLikeSnapshot(s));
  }, [snapshots, hideIdleSnapshots]);

  // Max timeline offset is always recalculated from the remaining (filtered) item count
  const maxTimelineOffset = useMemo(
    () => Math.max(0, filteredSnapshots.length - TIMELINE_WINDOW_SIZE),
    [filteredSnapshots.length],
  );

  if (!agentId || !agent) {
    return (
      <div className="flex-1 p-8 text-center text-muted-foreground text-xs">
        {t('monitor.notFound')}
      </div>
    );
  }

  const vramPercent =    currentSnapshot && currentSnapshot.gpuVramTotalMb > 0
      ? Math.round((currentSnapshot.gpuVramUsedMb / currentSnapshot.gpuVramTotalMb) * 100)
      : 0;

  const rawDetails = (currentSnapshot?.details || {}) as Record<string, unknown>;

  // 어텐션 알고리즘 표시명: 스냅샷의 판정값을 우선하고, 구 스냅샷(값 없음)은
  // 헤드 수로 재판정한다. Q==KV → MHA (GQA 하드코딩 금지).
  const attentionKindLabel = (() => {
    const stored = rawDetails.attentionKind as string | undefined;
    const q = Number(rawDetails.headCount ?? 0);
    const kv = Number(rawDetails.headCountKv ?? 0);
    const resolved =
      stored && stored !== 'unknown'
        ? stored
        : kv <= 0 || q <= 0
          ? 'unknown'
          : kv === 1
            ? 'MQA'
            : kv === q
              ? 'MHA'
              : 'GQA';
    if (resolved === 'hybrid') return t('monitor.attnHybrid');
    if (resolved === 'unknown') return t('monitor.attnUnknown');
    return resolved;
  })();
  // 통합 메모리(Apple Silicon 등) 여부 — VRAM 표시가 RAM과 중복되므로 숨긴다.
  const isUnifiedMemory =
    (rawDetails.isUnifiedMemory as boolean | undefined) === true ||
    (/apple/i.test(currentSnapshot?.gpuName || '') &&
      (currentSnapshot?.gpuVramTotalMb || 0) > 0);
  const lastCompleted = rawDetails.lastCompletedInference as
    | {
        prefillSpeed?: number;
        decodingSpeed?: number;
        prefillDurationMs?: number;
        decodingDurationMs?: number;
        prefillTokens?: number;
        decodingTokens?: number;
        totalDurationMs?: number;
        completedAt?: number;
      }
    | null
    | undefined;

  const getStatusBadge = (status: AgentMonitoringSnapshot['agentStatus']) => {
    switch (status) {
      case 'thinking':
        return {
          label: 'Thinking',
          fullLabel: t('monitor.phaseThinking'),
          className: 'bg-chart-1/20 text-chart-1 border-chart-1/30 animate-pulse',
        };
      case 'prefill':
        return {
          label: 'Prefill',
          fullLabel: t('monitor.phasePrefill'),
          className: 'bg-warning/20 text-warning border-warning/30 animate-pulse',
        };
      case 'decoding':
        return {
          label: 'Decoding',
          fullLabel: t('monitor.phaseDecoding'),
          className: 'bg-primary/20 text-primary border-primary/30 animate-pulse',
        };
      case 'generating':
        return {
          label: 'Generating',
          fullLabel: t('monitor.inferring'),
          className: 'bg-success/20 text-success border-success/30 animate-pulse',
        };
      case 'executing_tool':
        return {
          label: 'Tool',
          fullLabel: t('monitor.toolRunning'),
          className: 'bg-warning/20 text-warning border-warning/30 animate-pulse',
        };
      case 'waiting_approval':
        return {
          label: 'Waiting_Approval',
          fullLabel: t('monitor.awaitingApproval'),
          className: 'bg-destructive/20 text-destructive border-destructive/30',
        };
      case 'idle':
      default:
        return {
          label: 'IDLE',
          fullLabel: t('monitor.idle'),
          className: 'bg-muted text-foreground border-border',
        };
    }
  };

  const statusBadge = getStatusBadge(currentSnapshot?.agentStatus || 'idle');

  return (
    <div className="flex-1 h-full overflow-y-auto p-5 bg-background text-foreground space-y-5 select-text">
      {/* Top Header & Real-time Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-border gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-foreground">
                  {t('monitor.title', { name: agent.name })}
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border flex items-center gap-1.5 ${
                    isCollecting ? statusBadge.className : 'bg-muted text-muted-foreground border-border'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isCollecting ? 'bg-current' : 'bg-subtle'}`} />
                  {isCollecting ? statusBadge.label : t('monitor.pending')}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('monitor.model')} <span className="font-mono text-foreground font-medium">{agent.model}</span> |
                {t('monitor.contextLabel')}{' '}
                <span className="font-mono text-foreground font-medium">
                  {agent.contextSize > 0 ? `${agent.contextSize.toLocaleString()}` : '8192'} ctx
                </span>{' '}
                | {t('monitor.currentTask')}{' '}
                <span className="text-foreground/90 font-medium truncate max-w-sm inline-block align-bottom">
                  {currentSnapshot?.currentTask || t('monitor.waiting')}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Action / Sampling Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Interval Selector */}
          <div className="flex items-center gap-1.5 bg-card border border-border/80 px-2 py-1 rounded-lg text-xs">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={activeIntervalMs}
              onChange={(e) => handleIntervalChange(Number(e.target.value))}
              className="bg-transparent text-xs text-foreground focus:outline-none cursor-pointer"
            >
              {INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-popover text-popover-foreground">
                  {t('monitor.interval', { n: opt.seconds })}
                </option>
              ))}
            </select>
          </div>

          {/* Start/Pause Toggle */}
          <Button
            variant={isCollecting ? 'secondary' : 'default'}
            size="sm"
            onClick={handleToggleCollecting}
            disabled={isStarting}
            className="h-8 text-xs gap-1.5 cursor-pointer"
          >
            {isStarting ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span>{t('monitor.checking')}</span>
              </>
            ) : isCollecting ? (
              <>
                <Pause className="h-3.5 w-3.5 fill-current text-amber-500 dark:text-amber-400" />
                <span>{t('monitor.pause')}</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current text-primary-foreground" />
                <span>{t('monitor.start')}</span>
              </>
            )}
          </Button>

          {/* Manual Refresh Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={manualRefreshing}
            className="h-8 text-xs gap-1.5 cursor-pointer"
            title={t('monitor.measureNowTitle')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${manualRefreshing ? 'animate-spin' : ''}`} />
            <span>{t('monitor.measureNow')}</span>
          </Button>

          {/* Export JSON for AI Agents */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportJson}
            disabled={snapshots.length === 0}
            className="h-8 text-xs gap-1.5 cursor-pointer"
            title={t('monitor.downloadTitle')}
          >
            <FileDown className="h-3.5 w-3.5" />
            <span>{t('monitor.downloadJson')}</span>
          </Button>

          {/* Clear history */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setClearConfirmOpen(true)}
            disabled={snapshots.length === 0}
            className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
            title={t('monitor.clearTitle')}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t('monitor.clear')}</span>
          </Button>
        </div>
      </div>

      {/* 8 Key Operational & Performance KPI Cards (max 4 per row) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 1. GPU Model & Utilization */}
        <div className="p-3.5 rounded-xl bg-card border border-border space-y-1.5">
          <div className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5 text-success" />
              <span>{t('monitor.gpuUsage')}</span>
              <KpiCardHelp
                i18n="gpu"
                description={undefined}
                guide={undefined}
              />
            </span>
            {currentSnapshot && currentSnapshot.gpuTemperatureC > 0 && (
              <span className="flex items-center text-[10px] text-warning">
                <Thermometer className="h-3 w-3 mr-0.5" />
                {currentSnapshot.gpuTemperatureC}°C
              </span>
            )}
          </div>
          <div className="text-sm font-bold text-foreground truncate" title={currentSnapshot?.gpuName}>
            {currentSnapshot?.gpuName || t('monitor.detecting')}
          </div>
          <div className="flex items-center justify-between text-xs pt-1">
            <span className="text-muted-foreground text-[10px]">{t('monitor.gpuShare')}</span>
            <span className="font-mono font-semibold text-success">
              {currentSnapshot ? `${currentSnapshot.gpuUtilizationPct}%` : '0%'}
            </span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${Math.min(100, currentSnapshot?.gpuUtilizationPct || 0)}%`,
                backgroundColor: CHART_COLORS.gpu,
              }}
            />
          </div>
        </div>

        {/* 2. GPU VRAM Memory */}
        <div className="p-3.5 rounded-xl bg-card border border-border space-y-1.5">
          <div className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-tertiary" />
              <span>{t('monitor.vram')}</span>
              <KpiCardHelp
                i18n="vram"
                description={undefined}
                guide={undefined}
              />
            </span>
            <span className="text-[10px] font-mono text-tertiary font-semibold">{vramPercent}%</span>
          </div>
          <div className="text-base font-bold text-foreground">
            {currentSnapshot && currentSnapshot.gpuVramTotalMb > 0
              ? `${(currentSnapshot.gpuVramUsedMb / 1024).toFixed(1)} GB`
              : '0 GB'}
            <span className="text-[10px] font-normal text-muted-foreground ml-1">
              / {currentSnapshot ? (currentSnapshot.gpuVramTotalMb / 1024).toFixed(1) : 0} GB
            </span>
          </div>
          <div className="flex items-center justify-between text-xs pt-1">
            <span className="text-muted-foreground text-[10px]">{t('monitor.freeMemory')}</span>
            <span className="font-mono text-[10px] text-success font-semibold">
              {currentSnapshot ? `${(currentSnapshot.gpuVramFreeMb / 1024).toFixed(1)} GB Free` : '—'}
            </span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${vramPercent}%`,
                backgroundColor: CHART_COLORS.vram,
              }}
            />
          </div>
        </div>

        {/* 3. Prefill Speed & Duration */}
        <div className="p-3.5 rounded-xl bg-card border border-border space-y-1.5">
          <div className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 text-warning" />
              <span>{t('monitor.prefill')}</span>
              <KpiCardHelp
                i18n="prefill"
                description={undefined}
                guide={undefined}
              />
            </span>
            {Boolean(currentSnapshot?.prefillSpeed && currentSnapshot.prefillSpeed > 0) && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-warning/20 text-warning font-semibold animate-pulse">
                {t('monitor.prefilling')}
              </span>
            )}
          </div>
          <div className="text-base font-bold text-foreground flex items-baseline gap-1">
            <span className="font-mono text-warning">
              {currentSnapshot?.prefillSpeed && currentSnapshot.prefillSpeed > 0
                ? `${currentSnapshot.prefillSpeed.toFixed(1)}`
                : '0.0'}
            </span>
            <span className="text-[10px] text-muted-foreground">token/s</span>
            {Boolean(!currentSnapshot?.prefillSpeed && lastCompleted?.prefillSpeed && lastCompleted.prefillSpeed > 0) && lastCompleted && (
              <span className="text-[10px] font-mono text-muted-foreground ml-auto" title={t('monitor.lastSpeedTitle')}>
                {t('monitor.lastSpeed', { v: lastCompleted.prefillSpeed?.toFixed(1) ?? '' })}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between text-xs pt-1">
            <span className="text-muted-foreground text-[10px]">{t('monitor.elapsed')}</span>
            <span className="font-mono text-[10px] text-foreground font-semibold">
              {currentSnapshot?.prefillDurationMs && currentSnapshot.prefillDurationMs > 0
                ? `${(currentSnapshot.prefillDurationMs / 1000).toFixed(2)}s (${currentSnapshot.prefillDurationMs}ms)`
                : lastCompleted?.prefillDurationMs
                ? t('monitor.lastTime', { v: (lastCompleted.prefillDurationMs / 1000).toFixed(2), ms: lastCompleted.prefillDurationMs })
                : '—'}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {t('monitor.inputTokens')} {currentSnapshot?.prefillTokens && currentSnapshot.prefillTokens > 0
              ? `${currentSnapshot.prefillTokens.toLocaleString()} tokens`
              : lastCompleted?.prefillTokens
              ? t('monitor.recentTokens', { v: lastCompleted.prefillTokens.toLocaleString() })
              : '—'}
          </div>
        </div>

        {/* 4. Decoding Speed & Duration */}
        <div className="p-3.5 rounded-xl bg-card border border-border space-y-1.5">
          <div className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5 text-primary" />
              <span>{t('monitor.decoding')}</span>
              <KpiCardHelp
                i18n="decode"
                description={undefined}
                guide={undefined}
              />
            </span>
            {Boolean(currentSnapshot?.decodingSpeed && currentSnapshot.decodingSpeed > 0) && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-semibold animate-pulse">
                {t('monitor.generating')}
              </span>
            )}
          </div>
          <div className="text-base font-bold text-foreground flex items-baseline gap-1">
            <span className="font-mono text-primary">
              {currentSnapshot?.decodingSpeed && currentSnapshot.decodingSpeed > 0
                ? `${currentSnapshot.decodingSpeed.toFixed(1)}`
                : '0.0'}
            </span>
            <span className="text-[10px] text-muted-foreground">token/s</span>
            {Boolean(!currentSnapshot?.decodingSpeed && lastCompleted?.decodingSpeed && lastCompleted.decodingSpeed > 0) && lastCompleted && (
              <span className="text-[10px] font-mono text-muted-foreground ml-auto" title={t('monitor.lastSpeedTitle')}>
                {t('monitor.lastSpeed', { v: lastCompleted.decodingSpeed?.toFixed(1) ?? '' })}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between text-xs pt-1">
            <span className="text-muted-foreground text-[10px]">{t('monitor.elapsed')}</span>
            <span className="font-mono text-[10px] text-foreground font-semibold">
              {currentSnapshot?.decodingDurationMs && currentSnapshot.decodingDurationMs > 0
                ? `${(currentSnapshot.decodingDurationMs / 1000).toFixed(2)}s (${currentSnapshot.decodingDurationMs}ms)`
                : lastCompleted?.decodingDurationMs
                ? t('monitor.lastTime', { v: (lastCompleted.decodingDurationMs / 1000).toFixed(2), ms: lastCompleted.decodingDurationMs })
                : '—'}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {t('monitor.genTokens')} {currentSnapshot?.decodingTokens && currentSnapshot.decodingTokens > 0
              ? `${currentSnapshot.decodingTokens.toLocaleString()} tokens`
              : lastCompleted?.decodingTokens
              ? t('monitor.recentTokens', { v: lastCompleted.decodingTokens.toLocaleString() })
              : '—'}
          </div>
        </div>

        {/* 5. LLM Architecture & Parameters */}
        <div className="p-3.5 rounded-xl bg-card border border-border space-y-1.5">
          <div className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5 text-info" />
              <span>{t('monitor.arch')}</span>
              <KpiCardHelp
                i18n="arch"
                description={undefined}
                guide={undefined}
              />
            </span>
          </div>
          <div className="text-base font-bold text-foreground capitalize truncate">
            {currentSnapshot?.llmArchitecture || t('monitor.detecting')}
          </div>
          <div className="flex items-center justify-between text-xs pt-1">
            <span className="text-muted-foreground text-[10px]">{t('monitor.params')}</span>
            <span className="font-mono text-[10px] font-semibold text-info truncate">
              {currentSnapshot?.llmParameterSize || '—'} (
              {rawDetails.quantizationLevel ? String(rawDetails.quantizationLevel) : '—'})
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {t('monitor.layers')} {rawDetails.blockCount ? `${rawDetails.blockCount} Layers` : '—'}
          </div>
          <div className="flex items-center justify-between text-xs pt-0.5">
            <span className="text-muted-foreground text-[10px]">{t('monitor.attnKind')}</span>
            <span className="font-mono text-[10px] font-semibold text-foreground">
              {attentionKindLabel}
            </span>
          </div>
        </div>

        {/* 6. Context Size & KV Cache — RAM/VRAM split + MHA vs GQA actual */}
        <div className="p-3.5 rounded-xl bg-card border border-border space-y-1.5">
          <div className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-info" />
              <span>{t('monitor.ctxKv')}</span>
              <KpiCardHelp
                i18n="ctxkv"
                description={undefined}
                guide={undefined}
              />
            </span>
          </div>
          <div className="text-base font-bold text-foreground flex items-baseline gap-1.5">
            <span className="font-mono text-info">
              {formatContextTokenSize(currentSnapshot?.contextSize)}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              / {formatContextTokenSize(currentSnapshot?.contextLimit)}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground ml-auto">
              ({currentSnapshot?.contextSize.toLocaleString() || '0'} tokens)
            </span>
          </div>
          {(() => {
            const kvGqa = typeof rawDetails.kvCacheGqaBytes === 'number' ? rawDetails.kvCacheGqaBytes as number : (currentSnapshot?.kvCacheBytes ?? 0);
            const kvVram = typeof rawDetails.kvVramBytes === 'number' ? rawDetails.kvVramBytes as number : 0;
            const kvRam = typeof rawDetails.kvRamBytes === 'number' ? rawDetails.kvRamBytes as number : 0;
            return (
              <>
                <div className="flex items-center justify-between text-xs pt-1 gap-2">
                  <span className="text-muted-foreground text-[10px]" title={t('monitor.kvMaxTitle')}>
                    {t('monitor.kvActualKind', { v: attentionKindLabel })}
                  </span>
                  <span className="font-mono text-[11px] text-info font-bold px-1.5 py-0.5 rounded bg-info/10 border border-info/20" title={t('monitor.kvMaxTitle2')}>
                    {kvGqa > 0 ? formatMemoryBytes(kvGqa) : t('monitor.calculating')}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">
                  VRAM : {formatMemoryBytes(kvVram)}, RAM : {formatMemoryBytes(kvRam)}
                </div>
              </>
            );
          })()}
        </div>

        {/* 7. CPU / GPU Workload Offloading */}
        <div className="p-3.5 rounded-xl bg-card border border-border space-y-1.5">
          <div className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-warning" />
              <span>{t('monitor.offload')}</span>
              <KpiCardHelp
                i18n="offload"
                description={undefined}
                guide={undefined}
              />
            </span>
          </div>
          <div className="text-base font-bold text-foreground flex items-center gap-1.5">
            <span>{currentSnapshot ? `${currentSnapshot.gpuOffloadPct}%` : '0%'}</span>
            <span className="text-[10px] font-medium text-warning truncate">
              {currentSnapshot && currentSnapshot.gpuOffloadPct >= 100
                ? t('monitor.fullGpu')
                : currentSnapshot && currentSnapshot.gpuOffloadPct > 0
                ? t('monitor.gpuCpu')
                : `${t('monitor.cpu')}/${t('monitor.standby')}`}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs pt-1">
            <span className="text-muted-foreground text-[10px]">{t('monitor.vramLoad')}</span>
            <span className="font-mono text-[10px] font-semibold text-success">
              {currentSnapshot && currentSnapshot.vramAllocatedBytes > 0
                ? `${(currentSnapshot.vramAllocatedBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
                : '0 GB'}
            </span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-warning transition-all duration-300"
              style={{ width: `${currentSnapshot?.gpuOffloadPct || 0}%` }}
            />
          </div>
        </div>

        {/* 8. Current Operational State — detailed phase (Thinking/Tool/Generating/Decoding/Prefill) */}
        <div className="p-3.5 rounded-xl bg-card border border-border space-y-1.5">
          <div className="text-[11px] text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Radio className="h-3.5 w-3.5 text-success" />
              <span>{t('monitor.currentStatus')}</span>
              <KpiCardHelp
                i18n="agent"
                description={undefined}
                guide={undefined}
              />
            </span>
            {currentSnapshot && currentSnapshot.agentStatus !== 'idle' && (
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            )}
          </div>
          {(() => {
            const startIdx =
              snapshots.length > 0 && snapshots[0]?.id === currentSnapshot?.id ? 1 : 0;
            // 연속된 동일 상태는 하나의 작업(run)으로 묶는다 (최신순 스캔).
            const runs: Array<{
              status: AgentMonitoringSnapshot['agentStatus'];
              newest: string;
              oldest: string;
              count: number;
              id: string;
            }> = [];
            for (const s of snapshots.slice(startIdx, startIdx + 30)) {
              const last = runs[runs.length - 1];
              if (last && last.status === s.agentStatus) {
                last.oldest = s.timestamp;
                last.count += 1;
              } else {
                if (runs.length >= 2) break;
                runs.push({
                  status: s.agentStatus,
                  newest: s.timestamp,
                  oldest: s.timestamp,
                  count: 1,
                  id: s.id,
                });
              }
            }
            if (runs.length === 0) return null;
            return (
              <div className="space-y-1">
                {runs.map((r) => {
                  const b = getStatusBadge(r.status);
                  const newestMs = new Date(r.newest).getTime();
                  const oldestMs = new Date(r.oldest).getTime();
                  const spanMs =
                    Number.isFinite(newestMs) && Number.isFinite(oldestMs)
                      ? Math.max(0, newestMs - oldestMs) + activeIntervalMs
                      : activeIntervalMs;
                  return (
                    <div key={r.id} className="flex items-center gap-1.5 text-[10px]">
                      <span className={`px-1 py-0 rounded font-mono font-bold border ${b.className}`}>
                        {b.label}
                      </span>
                      <span className="text-muted-foreground font-mono">
                        {formatTimeOfDay(r.newest, locale)}
                      </span>
                      <span className="text-muted-foreground/80 font-mono">
                        ({formatDurationMs(spanMs)}{r.count > 1 ? ` ×${r.count}` : ''})
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <div className="flex items-center gap-1.5">
            <span
              className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-bold border ${statusBadge.className}`}
            >
              {statusBadge.label}
            </span>
            <span className="text-[11px] text-muted-foreground truncate">
              {statusBadge.fullLabel}
            </span>
          </div>
          {currentSnapshot && statusRunStartMs !== null && (
            <div className="flex items-center justify-between text-xs pt-0.5">
              <span className="text-muted-foreground text-[10px] flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{t('monitor.statusDuration')}</span>
              </span>
              <span className="font-mono text-[10px] text-foreground font-semibold">
                {formatDurationMs(Math.max(0, nowMs - statusRunStartMs))}
              </span>
            </div>
          )}
        </div>
      </div>

            {/* Row 1: CPU/GPU 오프로딩 상태 + 메모리 분배(VRAM+RAM 병합) + GPU·VRAM 추이 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
<div
  className={`p-4 rounded-xl border border-border bg-card space-y-3 min-w-0 ${row1OverId === 'sysres' ? 'ring-2 ring-primary/50' : ''}`}
  style={{ order: row1OrderOf('sysres'), opacity: row1DragId === 'sysres' ? 0.5 : 1 }}
  {...row1DropZoneProps('sysres')}
>
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0 shrink-0">
              <span
                className="cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-foreground shrink-0"
                title={t('monitor.dragHandle')}
                {...row1DragHandleProps('sysres')}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
              <Zap className="h-4 w-4 text-warning shrink-0" />
              <h3 className="text-xs font-semibold text-foreground whitespace-nowrap">
                {t('monitor.sysResources')}
              </h3>
              <KpiCardHelp
                i18n="sysres"
                description={undefined}
                guide={undefined}
              />
            </div>
            <span
              className="text-[11px] font-mono text-muted-foreground truncate max-w-[160px] text-right"
              title={currentSnapshot?.gpuName}
            >
              {currentSnapshot?.gpuName}
              {isUnifiedMemory ? ` (${t('monitor.unified')})` : ''}
            </span>
          </div>

          <div className="space-y-3 text-xs">
            {/* GPU Offload Ratio Bar */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-muted-foreground flex items-center gap-1">
                  <span>{t('monitor.offloadRatio')}</span>
                  <KpiCardHelp
                    i18n="offloadRatio"
                    description={undefined}
                    guide={undefined}
                  />
                </span>
                <span className="font-mono font-bold text-warning">
                  {currentSnapshot ? `${currentSnapshot.gpuOffloadPct}%` : '0%'}
                </span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-warning"
                  style={{ width: `${currentSnapshot?.gpuOffloadPct || 0}%` }}
                  title={t('monitor.gpuOffload')}
                />
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.max(0, 100 - (currentSnapshot?.gpuOffloadPct || 0))}%` }}
                  title={t('monitor.cpuCompute')}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground pt-0.5">
                <span>{t('monitor.gpuAccel', { v: currentSnapshot?.gpuOffloadPct || 0 })}</span>
                <span>{t('monitor.cpuShare', { v: Math.max(0, 100 - (currentSnapshot?.gpuOffloadPct || 0)) })}</span>
              </div>
            </div>

            {/* GPU VRAM Status — 통합 메모리에서는 RAM과 중복이므로 숨긴다 */}
            {!isUnifiedMemory && (
            <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50 flex items-center justify-between gap-2 font-mono">
              <span className="text-[11px] text-muted-foreground font-sans flex items-center gap-1 whitespace-nowrap shrink-0">
                <span>{t('monitor.vramState')}</span>
                <KpiCardHelp
                  i18n="vramState"
                  description={undefined}
                  guide={undefined}
                />
              </span>
              <span className="font-semibold text-foreground whitespace-nowrap text-right">
                {currentSnapshot && currentSnapshot.gpuVramTotalMb > 0
                  ? t('monitor.gbFree', {
                      total: (currentSnapshot.gpuVramTotalMb / 1024).toFixed(1),
                      free: (currentSnapshot.gpuVramFreeMb / 1024).toFixed(1),
                    })
                  : 'N/A'}
              </span>
            </div>
            )}
            {isUnifiedMemory && (
              <div className="px-2.5 py-1.5 rounded-lg bg-muted/40 border border-border/50 text-[10px] text-muted-foreground font-mono">
                {t('monitor.unifiedMemNote')}
              </div>
            )}

            {/* Host System RAM (corresponding to CPU offload distribution) */}
            <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50 flex items-center justify-between gap-2 font-mono">
              <span className="text-[11px] text-muted-foreground font-sans flex items-center gap-1 whitespace-nowrap shrink-0">
                <span>{t('monitor.hostRam')}</span>
                <KpiCardHelp
                  i18n="hostram"
                  description={undefined}
                  guide={undefined}
                />
              </span>
              <span className="font-semibold text-foreground whitespace-nowrap text-right">
                {currentSnapshot && currentSnapshot.systemMemoryTotalMb > 0
                  ? t('monitor.gbFree', {
                      total: (currentSnapshot.systemMemoryTotalMb / 1024).toFixed(1),
                      free: (currentSnapshot.systemMemoryFreeMb / 1024).toFixed(1),
                    })
                  : 'N/A'}
              </span>
            </div>
          </div>
        </div>
        <div
          className={`p-4 rounded-xl border border-border bg-card space-y-3 min-w-0 ${row1OverId === 'memdist' ? 'ring-2 ring-primary/50' : ''}`}
          style={{ order: row1OrderOf('memdist'), opacity: row1DragId === 'memdist' ? 0.5 : 1 }}
          {...row1DropZoneProps('memdist')}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-foreground shrink-0"
                title={t('monitor.dragHandle')}
                {...row1DragHandleProps('memdist')}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
              <Cpu className="h-4 w-4 text-tertiary" />
              <h3 className="text-xs font-semibold text-foreground">{t('monitor.memDist')}</h3>
              <KpiCardHelp
                i18n="memDist"
                description={undefined}
                guide={undefined}
              />
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">{t('monitor.unitGb')}</span>
          </div>

          <div className="w-full h-48">
            {memoryBreakdownData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                {t('monitor.aggregating')}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={memoryBreakdownData} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} unit=" GB" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      color: 'hsl(var(--popover-foreground))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Bar dataKey={t('monitor.weights')} stackId="a" fill="hsl(var(--chart-2))" radius={[0, 0, 0, 0]} unit=" GB" isAnimationActive={false} />
                  <Bar dataKey={t('monitor.kvEst')} stackId="a" fill="hsl(var(--chart-5))" radius={[0, 0, 0, 0]} unit=" GB" isAnimationActive={false} />
                  <Bar dataKey={t('monitor.otherUsage')} stackId="a" fill="hsl(var(--chart-4))" radius={[0, 0, 0, 0]} unit=" GB" isAnimationActive={false} />
                  <Bar dataKey={t('monitor.freeSpace')} stackId="a" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} unit=" GB" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div
          className={`p-4 rounded-xl border border-border bg-card space-y-3 min-w-0 ${row1OverId === 'realtime' ? 'ring-2 ring-primary/50' : ''}`}
          style={{ order: row1OrderOf('realtime'), opacity: row1DragId === 'realtime' ? 0.5 : 1 }}
          {...row1DropZoneProps('realtime')}
        >
          <div className="flex items-center">
            <div className="flex items-center gap-2">
              <span
                className="cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-foreground shrink-0"
                title={t('monitor.dragHandle')}
                {...row1DragHandleProps('realtime')}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </span>
              <Activity className="h-4 w-4 text-success" />
              <h3 className="text-xs font-semibold text-foreground">
                {t('monitor.realtimeGpu', { n: timeSeriesData.length })}
              </h3>
            </div>
          </div>

          <div className="w-full h-48">
            {timeSeriesData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                {t('monitor.noRealtime')}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeSeriesData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    domain={[0, 100]}
                    stroke={CHART_COLORS.gpu}
                    tick={{ fontSize: 10 }}
                    unit="%"
                    width={38}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke={CHART_COLORS.vram}
                    tick={{ fontSize: 10 }}
                    unit=" GB"
                    width={44}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      color: 'hsl(var(--popover-foreground))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="gpuUtilization"
                    name={t('monitor.gpuShare')}
                    stroke={CHART_COLORS.gpu}
                    fill={CHART_COLORS.gpu}
                    fillOpacity={0.2}
                    isAnimationActive={false}
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="vramUsedGb"
                    name={t('monitor.vramUsageShort')}
                    stroke={CHART_COLORS.vram}
                    fill={CHART_COLORS.vram}
                    fillOpacity={0.18}
                    unit=" GB"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex items-center gap-4 text-[11px] font-mono flex-wrap">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="w-2.5 h-2.5 rounded-full shadow-sm"
                style={{ backgroundColor: CHART_COLORS.gpu }}
              />
              <span className="text-success font-medium">{t('monitor.gpuShareUnit')}</span>
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="w-2.5 h-2.5 rounded-full shadow-sm"
                style={{ backgroundColor: CHART_COLORS.vram }}
              />
              <span className="text-tertiary font-medium">{t('monitor.vramUsage')}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Row 2: 대화 단위 토큰 정보 + LLM 아키텍처 상세 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
<div className="p-4 rounded-xl border border-border bg-card space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-warning" />
              <h3 className="text-xs font-semibold text-foreground">
                {t('monitor.tokenInfo')}
              </h3>
              <KpiCardHelp
                i18n="tokenInfo"
                description={undefined}
                guide={undefined}
              />
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">
              {t('monitor.convCount', { n: tokenTotalsAll.conversationCount })}
            </span>
          </div>

          {mergedConversations.length === 0 && !activeToken.totals ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {t('monitor.noTokenData')}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                <div className="p-2 rounded-lg bg-muted/40 border border-border/50">
                  <div className="text-[10px] text-muted-foreground font-sans">{t('monitor.inputTok')}</div>
                  <div className="font-bold text-warning mt-0.5">
                    {tokenTotalsAll.inputTokens.toLocaleString()}
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-muted/40 border border-border/50">
                  <div className="text-[10px] text-muted-foreground font-sans">{t('monitor.outputTok')}</div>
                  <div className="font-bold text-primary mt-0.5">
                    {tokenTotalsAll.outputTokens.toLocaleString()}
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-muted/40 border border-border/50">
                  <div className="text-[10px] text-muted-foreground font-sans">{t('monitor.thinkTok')}</div>
                  <div className="font-bold text-chart-1 mt-0.5">
                    {tokenTotalsAll.thinkingTokens.toLocaleString()}
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-muted/40 border border-border/50">
                  <div className="text-[10px] text-muted-foreground font-sans">{t('monitor.totalTok')}</div>
                  <div className="font-bold text-foreground mt-0.5">
                    {tokenTotalsAll.totalTokens.toLocaleString()}
                  </div>
                </div>
              </div>

              {tokenStatusTotal > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] text-muted-foreground font-medium">{t('monitor.statusTok')}</div>
                  <div className="w-full h-2.5 flex rounded-full overflow-hidden bg-muted">
                    {TOKEN_STATUS_ORDER.map((d) => {
                      const v = tokenTotalsAll.statusTokens[d.key] ?? 0;
                      if (v <= 0) return null;
                      return (
                        <div
                          key={d.key}
                          style={{
                            width: `${(v / tokenStatusTotal) * 100}%`,
                            backgroundColor: d.color,
                          }}
                          title={`${d.label}: ${v.toLocaleString()}`}
                        />
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-[10px] font-mono">
                    {TOKEN_STATUS_ORDER.map((d) => {
                      const v = tokenTotalsAll.statusTokens[d.key] ?? 0;
                      if (v <= 0) return null;
                      return (
                        <span key={d.key} className="text-muted-foreground">
                          {d.label}: <b style={{ color: d.color }}>{v.toLocaleString()}</b>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeToken.totals && activeToken.id && (
                <div className="p-2 rounded-lg bg-primary/5 border border-primary/20 text-[11px] font-mono flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                  <span className="text-primary font-semibold shrink-0">{t('monitor.inProgress')}</span>
                  <span className="text-muted-foreground truncate">
                    {t('monitor.inputTok')} {activeToken.totals.inputTokens.toLocaleString()} ·{' '}
                    {t('monitor.outputTok')} {activeToken.totals.outputTokens.toLocaleString()} ·{' '}
                    {t('monitor.thinkTok')} {activeToken.totals.thinkingTokens.toLocaleString()}
                  </span>
                </div>
              )}

              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground font-medium">{t('monitor.recentConvs')}</div>
                <div className="space-y-1 max-h-[88px] overflow-y-auto">
                  {mergedConversations.slice(0, 5).map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/40 border border-border/50 text-[11px] font-mono"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="px-1 rounded bg-primary/10 text-primary border border-primary/20 text-[10px] font-bold shrink-0">
                          #{c.seq}
                        </span>
                        <span className="text-muted-foreground truncate">
                          {formatTimeOfDay(c.startedAt, locale)}
                        </span>
                        <span className="text-muted-foreground shrink-0">
                          · {t('monitor.turns', { n: c.turnCount })}
                        </span>
                      </span>
                      <span className="shrink-0" title={`${t('monitor.inputTok')}: ${c.inputTokens.toLocaleString()}, ${t('monitor.outputTok')}: ${c.outputTokens.toLocaleString()}, ${t('monitor.thinkTok')}: ${c.thinkingTokens.toLocaleString()}`}>
                        <span className="text-warning">{c.inputTokens.toLocaleString()}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-primary">{c.outputTokens.toLocaleString()}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-chart-1">+{c.thinkingTokens.toLocaleString()}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
<div className="p-4 rounded-xl border border-border bg-card space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-info" />
              <h3 className="text-xs font-semibold text-foreground">
                {t('monitor.archDetail')}
              </h3>
              <KpiCardHelp
                i18n="archDetail"
                description={undefined}
                guide={undefined}
              />
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">
              {currentSnapshot?.llmModel}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono">
            <div className="p-2 rounded-lg bg-muted/40 border border-border/50">
              <div className="text-[10px] text-muted-foreground font-sans flex items-center justify-between">
                <span>{t('monitor.archKindShort')}</span>
                <KpiCardHelp
                  i18n="archKind"
                  description={undefined}
                  guide={undefined}
                />
              </div>
              <div className="font-bold text-foreground uppercase mt-0.5 truncate">
                {currentSnapshot?.llmArchitecture || '—'}
              </div>
            </div>

            <div className="p-2 rounded-lg bg-muted/40 border border-border/50">
              <div className="text-[10px] text-muted-foreground font-sans flex items-center justify-between">
                <span>{t('monitor.blockCount')}</span>
                <KpiCardHelp
                  i18n="blocks"
                  description={undefined}
                  guide={undefined}
                />
              </div>
              <div className="font-bold text-foreground mt-0.5">
                {rawDetails.blockCount ? t('monitor.blockUnit', { n: String(rawDetails.blockCount) }) : '—'}
              </div>
            </div>

            <div className="p-2 rounded-lg bg-muted/40 border border-border/50">
              <div className="text-[10px] text-muted-foreground font-sans flex items-center justify-between">
                <span>{t('monitor.embedDim')}</span>
                <KpiCardHelp
                  i18n="embed"
                  description={undefined}
                  guide={undefined}
                />
              </div>
              <div className="font-bold text-foreground mt-0.5">
                {rawDetails.embeddingLength ? `${rawDetails.embeddingLength}` : '—'}
              </div>
            </div>

            <div className="p-2 rounded-lg bg-muted/40 border border-border/50">
              <div className="text-[10px] text-muted-foreground font-sans flex items-center justify-between">
                <span>{t('monitor.heads')}</span>
                <KpiCardHelp
                  i18n="heads"
                  description={undefined}
                  guide={undefined}
                />
              </div>
              <div className="font-bold text-foreground mt-0.5" title={t('monitor.headsTitle', { q: String(rawDetails.headCount ?? 0), kv: String(rawDetails.headCountKv ?? 0), kind: attentionKindLabel })}>
                {rawDetails.headCount ? `${rawDetails.headCount} Heads` : '—'}
              </div>
            </div>

            <div className="p-2 rounded-lg bg-muted/40 border border-border/50">
              <div className="text-[10px] text-muted-foreground font-sans flex items-center justify-between">
                <span>{t('monitor.kvHeads')}</span>
                <KpiCardHelp
                  i18n="kvheads"
                  description={undefined}
                  guide={undefined}
                />
              </div>
              <div className="font-bold text-foreground mt-0.5" title={t('monitor.headsTitle', { q: String(rawDetails.headCount ?? 0), kv: String(rawDetails.headCountKv ?? 0), kind: attentionKindLabel })}>
                {rawDetails.headCountKv ? `${rawDetails.headCountKv} KV Heads` : '—'}
              </div>
            </div>

            <div className="p-2 rounded-lg bg-muted/40 border border-border/50">
              <div className="text-[10px] text-muted-foreground font-sans flex items-center justify-between">
                <span>{t('monitor.attnKind')}</span>
                <KpiCardHelp
                  i18n="archKind"
                  description={undefined}
                  guide={undefined}
                />
              </div>
              <div className="font-bold text-foreground mt-0.5">
                {attentionKindLabel}
              </div>
            </div>

            <div className="p-2 rounded-lg bg-muted/40 border border-border/50">
              <div className="text-[10px] text-muted-foreground font-sans flex items-center justify-between">
                <span>{t('monitor.ffnDim')}</span>
                <KpiCardHelp
                  i18n="ffn"
                  description={undefined}
                  guide={undefined}
                />
              </div>
              <div className="font-bold text-foreground mt-0.5">
                {rawDetails.feedForwardLength ? `${rawDetails.feedForwardLength}` : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

{/* Row 3: Real-time Token/Inference Status + LLM Operation Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Unified Token / Inference Status (speed + latency merged) */}
        <div className="p-4 rounded-xl border border-border bg-card space-y-3">
          <div className="flex items-center">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-warning" />
              <h3 className="text-xs font-semibold text-foreground">
                {t('monitor.tokenInferenceUnified')}
              </h3>
            </div>
          </div>

          <div className="w-full h-60">
            {timeSeriesData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                {t('monitor.noSpeed')}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeSeriesData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    domain={[0, tokenSpeedMax]}
                    stroke={CHART_COLORS.prefill}
                    tick={{ fontSize: 10 }}
                    tickFormatter={formatAxisNumber}
                    unit=" t/s"
                    width={44}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, inferenceMsMax]}
                    stroke={CHART_COLORS.decoding}
                    tick={{ fontSize: 10 }}
                    tickFormatter={formatAxisNumber}
                    unit=" ms"
                    width={44}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      color: 'hsl(var(--popover-foreground))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="prefillSpeed"
                    name={t('monitor.prefillSpeed')}
                    stroke={CHART_COLORS.prefill}
                    strokeWidth={2}
                    fill={CHART_COLORS.prefill}
                    fillOpacity={0.15}
                    dot={false}
                    activeDot={{ r: 4 }}
                    unit=" token/s"
                    isAnimationActive={false}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="decodingSpeed"
                    name={t('monitor.decodeSpeed')}
                    stroke={CHART_COLORS.decoding}
                    strokeWidth={2.5}
                    fill={CHART_COLORS.decoding}
                    fillOpacity={0.2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    unit=" token/s"
                    isAnimationActive={false}
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="prefillDurationMs"
                    name={t('monitor.prefillTime')}
                    stroke={CHART_COLORS.prefill}
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    fill="transparent"
                    fillOpacity={0}
                    dot={false}
                    activeDot={{ r: 3 }}
                    unit=" ms"
                    isAnimationActive={false}
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="decodingDurationMs"
                    name={t('monitor.decodeTime')}
                    stroke={CHART_COLORS.decoding}
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    fill="transparent"
                    fillOpacity={0}
                    dot={false}
                    activeDot={{ r: 3 }}
                    unit=" ms"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono flex-wrap">
            <span className="flex items-center gap-1 text-muted-foreground">
              <span
                className="w-2.5 h-2.5 rounded-full shadow-sm"
                style={{ backgroundColor: CHART_COLORS.prefill }}
              />
              <span className="text-warning font-medium">{t('monitor.prefillSpeed')}</span>
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <span
                className="w-2.5 h-2.5 rounded-full shadow-sm"
                style={{ backgroundColor: CHART_COLORS.decoding }}
              />
              <span className="text-primary font-medium">{t('monitor.decodeSpeed')}</span>
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <span
                className="w-2.5 h-1 rounded-sm shadow-sm border border-dashed"
                style={{ borderColor: CHART_COLORS.prefill, backgroundColor: 'transparent' }}
              />
              <span className="text-warning/80 font-medium">{t('monitor.prefillTime')}</span>
            </span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <span
                className="w-2.5 h-1 rounded-sm shadow-sm border border-dashed"
                style={{ borderColor: CHART_COLORS.decoding, backgroundColor: 'transparent' }}
              />
              <span className="text-primary/80 font-medium">{t('monitor.decodeTime')}</span>
            </span>
          </div>
        </div>

        {/* LLM Operation Analysis — total time per detailed phase */}
        <div className="p-4 rounded-xl border border-border bg-card space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <h3 className="text-xs font-semibold text-foreground">
                {t('monitor.llmAnalysis')}
              </h3>
              <KpiCardHelp i18n="llmAnalysis" description={undefined} guide={undefined} />
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">
              {t('monitor.totalLabel')} {formatDurationMs(llmPhaseBreakdown.total)}
            </span>
          </div>

          <div className="w-full h-52">
            {snapshots.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                {t('monitor.noLatency')}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={llmPhaseBreakdown.phases} margin={{ top: 10, right: 10, left: -6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="phase" tick={{ fontSize: 9 }} interval={0} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatDurationMs(v)} width={52} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      color: 'hsl(var(--popover-foreground))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(value) => [`${Number(value).toLocaleString()} ms (${formatDurationMs(Number(value))})`, '']}
                  />
                  <Bar dataKey="ms" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {llmPhaseBreakdown.phases.map((p) => (
                      <Cell key={p.phase} fill={p.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          {snapshots.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground font-medium">{t('monitor.phaseShare')}</span>
              </div>
              <div className="w-full h-2.5 flex rounded-full overflow-hidden bg-muted">
                {llmPhaseBreakdown.phases.map((p) =>
                  p.ms > 0 ? (
                    <div
                      key={p.phase}
                      style={{
                        width: `${llmPhaseBreakdown.phaseTotal > 0 ? (p.ms / llmPhaseBreakdown.phaseTotal) * 100 : 0}%`,
                        backgroundColor: p.fill,
                      }}
                      title={`${p.phase}: ${formatDurationMs(p.ms)} (${p.pct}%)`}
                    />
                  ) : null,
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[10px] font-mono">
                {llmPhaseBreakdown.phases.map((p) => (
                  <span key={p.phase} className="text-muted-foreground">
                    {p.phase}: <b style={{ color: p.fill }}>{formatDurationMs(p.ms)} ({p.pct}%)</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Collected Snapshots History Table (For AI Agent Analysis) */}
      <div className="p-4 rounded-xl border border-border bg-card space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold text-foreground">
              {t('monitor.snapshots', { n: filteredSnapshots.length })}
            </h3>
            {hideIdleSnapshots && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono">
                {t('monitor.idleFiltered', { n: snapshots.length - filteredSnapshots.length })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground">
              {t('monitor.snapshotNote')}
            </span>
            <button
              type="button"
              onClick={() => {
                setHideIdleSnapshots((v) => !v);
                setTimelineOffset(0);
              }}
              className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
                hideIdleSnapshots
                  ? 'bg-primary/15 border-primary/40 text-primary'
                  : 'bg-card border-border text-muted-foreground hover:text-foreground'
              }`}
              title={t('monitor.idleFilterTitle')}
            >
              <Filter className="h-3 w-3" />
              <span>{t('monitor.idleFilter')}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${hideIdleSnapshots ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
            </button>
          </div>
        </div>

        {filteredSnapshots.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            {hideIdleSnapshots ? t('monitor.noSnapshotsAfterFilter') : t('monitor.noSnapshots')}
          </div>
        ) : (
          <>
            {/* Timeline Slider Widget */}
            {(() => {
              const sourceList = filteredSnapshots;
              const maxOffset = maxTimelineOffset;
              const currentOffset = Math.min(timelineOffset, maxOffset);
              const visibleSnapshots = sourceList.slice(
                currentOffset,
                currentOffset + TIMELINE_WINDOW_SIZE,
              );

              return (
                <>
                  {sourceList.length > TIMELINE_WINDOW_SIZE && (
                    <div className="p-3 rounded-lg border border-border/80 bg-muted/20 space-y-2 select-text">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground">{t('monitor.slider')}</span>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {t('monitor.showing')} {currentOffset + 1} ~{' '}
                            {t('monitor.rangeN', { n: Math.min(currentOffset + TIMELINE_WINDOW_SIZE, sourceList.length) })}
                            {t('monitor.ofTotal', { n: sourceList.length })}
                          </span>
                          {visibleSnapshots.length > 0 && (
                            <span className="text-[10px] text-primary/90 bg-primary/10 px-2 py-0.5 rounded font-mono border border-primary/20">
                              {formatTimeOfDay(
                                visibleSnapshots[visibleSnapshots.length - 1].timestamp,
                                locale,
                              )}{' '}
                              ~ {formatTimeOfDay(visibleSnapshots[0].timestamp, locale)}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 self-end sm:self-auto">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setTimelineOffset(0)}
                            disabled={currentOffset === 0}
                            className="h-6 px-2 text-[10px] gap-1 cursor-pointer"
                            title={t('monitor.goLatest')}
                          >
                            <ChevronsLeft className="h-3 w-3" />
                            <span>{t('monitor.latest')}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setTimelineOffset((prev) => Math.max(0, prev - 10))}
                            disabled={currentOffset === 0}
                            className="h-6 px-2 text-[10px] gap-0.5 cursor-pointer"
                            title={t('monitor.forward10')}
                          >
                            <ChevronLeft className="h-3 w-3" />
                            <span>-10</span>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setTimelineOffset((prev) => Math.min(maxOffset, prev + 10))
                            }
                            disabled={currentOffset >= maxOffset}
                            className="h-6 px-2 text-[10px] gap-0.5 cursor-pointer"
                            title={t('monitor.back10')}
                          >
                            <span>+10</span>
                            <ChevronRight className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setTimelineOffset(maxOffset)}
                            disabled={currentOffset >= maxOffset}
                            className="h-6 px-2 text-[10px] gap-1 cursor-pointer"
                            title={t('monitor.goOldest')}
                          >
                            <span>{t('monitor.oldestEnd')}</span>
                            <ChevronsRight className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Slider Input */}
                      <div className="flex items-center gap-2.5 pt-0.5">
                        <span className="text-[10px] font-mono text-success font-semibold shrink-0">
                          {t('monitor.rangeNewest')}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={maxOffset}
                          step={1}
                          value={currentOffset}
                          onChange={(e) => setTimelineOffset(Number(e.target.value))}
                          className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                          {t('monitor.rangeOldest', { n: sourceList.length })}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto border border-border/60 rounded-lg max-h-[600px] overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead className="sticky top-0 z-10 bg-card">
                        <tr className="bg-muted/40 border-b border-border/80 text-[11px] text-muted-foreground font-sans">
                          <th className="p-2.5">{t('monitor.time')}</th>
                          <th className="p-2.5">{t('monitor.gpuShare')}</th>
                          <th className="p-2.5">{t('monitor.vramUsageShort')}</th>
                          <th className="p-2.5">{t('monitor.prefill')}</th>
                          <th className="p-2.5">{t('monitor.decoding')}</th>
                          <th className="p-2.5">{t('monitor.tokens')}</th>
                          <th className="p-2.5">{t('monitor.kvEst')}</th>
                          <th className="p-2.5">{t('monitor.offload')}</th>
                          <th className="p-2.5">{t('monitor.currentStatus')}</th>
                          <th className="p-2.5">{t('monitor.currentTask')}</th>
                          <th className="p-2.5 text-right">{t('monitor.detail')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleSnapshots.map((snap, idx) => {
                          const globalIdx = currentOffset + idx + 1;
                          return (
                            <tr
                              key={snap.id}
                              className="border-b border-border/40 hover:bg-muted/20"
                            >
                              <td className="p-2.5 text-muted-foreground text-[11px]">
                                <div className="flex items-center gap-1.5">
                                  <span className="px-1 py-0.2 rounded bg-muted/60 text-[9px] font-mono text-muted-foreground/80 border border-border/40">
                                    #{globalIdx}
                                  </span>
                                  {snap.conversationSeq !== undefined && (
                                    <span
                                      className="px-1 py-0.2 rounded bg-primary/10 text-[9px] font-mono text-primary border border-primary/20"
                                      title={snap.conversationId}
                                    >
                                      C#{snap.conversationSeq}
                                    </span>
                                  )}
                                  <span>{formatTimeOfDay(snap.timestamp, locale)}</span>
                                </div>
                              </td>
                      <td className="p-2.5 font-semibold text-success">
                        {snap.gpuUtilizationPct}%
                      </td>
                      <td className="p-2.5 font-medium text-tertiary">
                        {snap.gpuVramUsedMb.toLocaleString()} MB
                      </td>
                      <td className="p-2.5 text-warning">
                        {snap.prefillSpeed !== undefined && snap.prefillSpeed > 0
                          ? `${snap.prefillSpeed.toFixed(1)} t/s (${snap.prefillDurationMs ?? 0}ms)`
                          : '—'}
                      </td>
                      <td className="p-2.5 text-primary">
                        {snap.decodingSpeed !== undefined && snap.decodingSpeed > 0
                          ? `${snap.decodingSpeed.toFixed(1)} t/s (${snap.decodingDurationMs ?? 0}ms)`
                          : '—'}
                      </td>
                      <td className="p-2.5 font-medium whitespace-nowrap">
                        {(snap.prefillTokens ?? 0) > 0 || (snap.decodingTokens ?? 0) > 0 || (snap.thinkingTokens ?? 0) > 0 ? (
                          <span title={`${t('monitor.inputTok')}: ${(snap.prefillTokens ?? 0).toLocaleString()}, ${t('monitor.outputTok')}: ${(snap.decodingTokens ?? 0).toLocaleString()}, ${t('monitor.thinkTok')}: ${(snap.thinkingTokens ?? 0).toLocaleString()}`}>
                            <span className="text-warning">{(snap.prefillTokens ?? 0).toLocaleString()}</span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="text-primary">{(snap.decodingTokens ?? 0).toLocaleString()}</span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="text-chart-1">+{(snap.thinkingTokens ?? 0).toLocaleString()}</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-2.5 text-info font-medium">
                        {snap.kvCacheBytes > 0
                          ? formatMemoryBytes(snap.kvCacheBytes)
                          : '—'}
                      </td>
                      <td className="p-2.5 text-warning font-medium">
                        {snap.gpuOffloadPct}%
                      </td>
                      <td className="p-2.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-mono font-bold border ${
                            snap.agentStatus === 'thinking'
                              ? 'bg-chart-1/15 text-chart-1 border-chart-1/30'
                              : snap.agentStatus === 'prefill'
                              ? 'bg-warning/15 text-warning border-warning/30'
                              : snap.agentStatus === 'decoding' || snap.agentStatus === 'generating'
                              ? snap.agentStatus === 'decoding'
                                ? 'bg-primary/15 text-primary border-primary/30'
                                : 'bg-success/15 text-success border-success/30'
                              : snap.agentStatus === 'executing_tool'
                              ? 'bg-warning/15 text-warning border-warning/30'
                              : snap.agentStatus === 'waiting_approval'
                              ? 'bg-destructive/15 text-destructive border-destructive/30'
                              : 'bg-muted text-muted-foreground border-border/40'
                          }`}
                        >
                          {snap.agentStatus}
                        </span>
                      </td>
                      <td className="p-2.5 font-sans text-muted-foreground truncate max-w-xs" title={snap.currentTask}>
                        {snap.currentTask || t('monitor.waiting')}
                      </td>
                      <td className="p-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedSnapshot(snap)}
                          className="h-6 px-2 text-[10px] gap-1 cursor-pointer"
                        >
                          <Eye className="h-3 w-3" />
                          <span>{t('monitor.jsonView')}</span>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      );
    })()}
  </>
)}
</div>

      {/* Snapshot JSON Detail Dialog for AI Analysis */}
      <Dialog open={!!selectedSnapshot} onOpenChange={(open) => !open && setSelectedSnapshot(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center justify-between pr-6">
              <span>{t('monitor.snapshotJson')}</span>
              {selectedSnapshot && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    handleCopyJson(JSON.stringify(selectedSnapshot, null, 2), selectedSnapshot.id)
                  }
                  className="h-7 text-xs gap-1 cursor-pointer"
                >
                  {copiedId === selectedSnapshot.id ? (
                    <>
                      <Check className="h-3 w-3 text-success" />
                      <span>{t('monitor.copied')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>{t('monitor.copyJson')}</span>
                    </>
                  )}
                </Button>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t('monitor.snapshotMeta', { time: String(selectedSnapshot?.timestamp ?? ''), name: agent.name, n: agent.model })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-3 rounded-lg bg-code border border-border/80 font-mono text-xs text-code-foreground max-h-96 select-text whitespace-pre-wrap">
            {selectedSnapshot ? JSON.stringify(selectedSnapshot, null, 2) : ''}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelectedSnapshot(null)}
              className="text-xs"
            >
              {t('monitor.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear Confirmation Dialog */}
      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">{t('monitor.clearData')}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-2">
              {t('monitor.clearConfirm', { name: agent.name })}
              <span className="block mt-1 text-destructive">
                {t('monitor.clearWarn')}
              </span>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex flex-row justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setClearConfirmOpen(false)}
              className="text-xs"
            >
              {t('monitor.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleClearHistory}
              className="text-xs"
            >
              {t('monitor.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ollama Connection Error Dialog */}
      <Dialog open={ollamaErrorDialogOpen} onOpenChange={setOllamaErrorDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <DialogTitle className="text-sm font-semibold text-foreground">
                {t('monitor.connFailTitle')}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-2">
              {t('monitor.connFailBody')}
              <br />
              {t('monitor.connFailHint')}
              <span className="block mt-2 font-mono text-[11px] p-2 bg-destructive/10 text-destructive rounded border border-destructive/20 break-all">
                URL: {agent ? resolveBaseUrlForAgent(agent, settings.ollamaBaseUrl) : settings.ollamaBaseUrl}
                {ollamaErrorMessage ? `\n${t('monitor.errorPrefix', { msg: ollamaErrorMessage })}` : ''}
              </span>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => setOllamaErrorDialogOpen(false)}
              className="text-xs cursor-pointer"
            >
              {t('monitor.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
