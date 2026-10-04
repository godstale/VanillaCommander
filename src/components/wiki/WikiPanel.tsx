// P11-31: 위키 사이드 패널. 감시 상태·대기열·최근 처리·페이지 목록.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  BookOpen,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  MessageSquareText,
  Network,
  RefreshCw,
  Settings2,
  Zap,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { listWikiJobs, getWikiJobsByStatus, type WikiJob } from '@/lib/db/repositories/wikiJobsRepo';
import {
  reconcileWikiFolders,
  pumpWikiQueue,
  subscribeWikiPipeline,
  type WikiPipelineStatus,
} from '@/lib/wiki/pipeline';
import { createWikiTool } from '@/lib/tools/wiki';
import { buildFileTab, planOpenFile } from '@/lib/commander/openFile';

interface WikiPage {
  slug: string;
  path: string;
  size: number;
}

type SectionKey = 'queue' | 'recent' | 'pages';

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** 펼침 목록 섹션. 헤더를 눌러 접고 편다. */
function Section({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-border/50">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-1 px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide hover:bg-muted/40 transition-colors cursor-pointer"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="flex-1 text-left">{title}</span>
        <span className="px-1.5 rounded-full bg-muted text-[10px] font-bold normal-case">{count}</span>
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
}

export function WikiPanel() {
  const { t } = useLanguage();
  const { settings, updateSettings } = useSettings();
  const workspace = useSafeWorkspace();
  const { openTab } = useWorkspaceTabs();
  const workspaceRoot = workspace?.workspaceRoot ?? null;

  const [queue, setQueue] = useState<WikiJob[]>([]);
  const [recent, setRecent] = useState<WikiJob[]>([]);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [busy, setBusy] = useState(false);
  const [processingNow, setProcessingNow] = useState(false);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    queue: true,
    recent: true,
    pages: false,
  });
  const [pipelineStatus, setPipelineStatus] = useState<WikiPipelineStatus>({
    active: false,
    pending: 0,
    lastDoneAt: null,
    lastError: null,
  });

  const watchEnabled = settings.wiki.watchEnabled;
  const watchFolders = settings.wiki.watchFolders;

  const toggleSection = (key: SectionKey) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // 백그라운드 파이프라인(자동 감시·주기 스캔)의 처리 상태를 구독한다.
  // 수동 "즉시 처리"와 무관하게 돌아가므로 패널에서도 진행중임을 보여줘야 한다.
  useEffect(() => {
    const unsubscribe = subscribeWikiPipeline((status) => {
      setPipelineStatus(status);
    });
    return unsubscribe;
  }, []);

  const pipelineBusy = pipelineStatus.active || pipelineStatus.pending > 0;
  const isProcessing = processingNow || pipelineBusy;

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [queued, processing, history] = await Promise.all([
        getWikiJobsByStatus('queued', workspaceRoot),
        getWikiJobsByStatus('processing', workspaceRoot),
        listWikiJobs(8, workspaceRoot),
      ]);
      setQueue([...queued, ...processing]);
      setRecent(history);
      if (workspaceRoot) {
        const tool = createWikiTool({ workspaceRoot });
        const result = await tool.execute(
          crypto.randomUUID(),
          { action: 'list', maxResults: 100 },
          new AbortController().signal,
        );
        const details = result.details as { pages?: WikiPage[] } | undefined;
        setPages(details?.pages ?? []);
      } else {
        setPages([]);
      }
    } catch {
      // 패널 표시 실패는 조용히 둔다.
    } finally {
      setBusy(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 패널 표시 시 1회 로드 + 5초 폴링
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const toggleWatch = useCallback(async () => {
    // 감시 반영은 WikiRuntime이 설정 변경에 맞춰 수행한다.
    await updateSettings({ wiki: { ...settings.wiki, watchEnabled: !watchEnabled } });
    void refresh();
  }, [watchEnabled, settings.wiki, updateSettings, refresh]);

  const processNow = useCallback(async () => {
    // 주기 스캔·이벤트를 기다리지 않고 지금 바로 스캔+대기열 처리한다.
    // reconcile은 감시 off면 스캔을 건너뛰므로 pump로 쌓인 대기열은 별도로 비운다.
    if (processingNow || !workspaceRoot) return;
    setProcessingNow(true);
    try {
      await reconcileWikiFolders({ retry: true });
      await pumpWikiQueue();
    } catch {
      // 파이프라인 실패는 상태바·최근 처리에서 확인한다.
    } finally {
      setProcessingNow(false);
      await refresh();
    }
  }, [processingNow, workspaceRoot, refresh]);

  const openSettings = useCallback(() => {
    openTab({ id: 'wiki', type: 'wiki', title: t('wiki.tabTitle') });
  }, [openTab, t]);

  // 위키 질의는 에이전트 채팅으로 한다: 새 채팅을 열고 위키 폴더 프롬프트를 meta로 지정한다.
  const openWikiChat = useCallback(() => {
    const sessionId = crypto.randomUUID();
    openTab({
      id: `chat:${sessionId}`,
      type: 'chat',
      title: t('wiki.chatTitle'),
      meta: { sessionId, wikiChat: true },
    });
  }, [openTab, t]);

  const openGraph = useCallback(() => {
    openTab({ id: 'wiki-graph', type: 'wiki-graph', title: t('wiki.graphTabTitle') });
  }, [openTab, t]);

  const openPage = useCallback((page: WikiPage) => {
    if (!workspaceRoot) return;
    const sep = workspaceRoot.includes('\\') ? '\\' : '/';
    const path = `${workspaceRoot.replace(/[\\/]+$/, '')}${sep}${page.path}`;
    openTab(buildFileTab(planOpenFile(path)));
  }, [workspaceRoot, openTab]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <BookOpen className="h-3.5 w-3.5 text-primary" />
          <span>{t('wiki.panelTitle')}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            title={t('wiki.refresh')}
            aria-label={t('wiki.refresh')}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={openSettings}
            title={t('wiki.openSettings')}
            aria-label={t('wiki.openSettings')}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 즉시 처리 + 감시 상태 */}
        <div className="px-3 py-2 border-b border-border/50 space-y-1.5">
          <button
            type="button"
            onClick={() => void processNow()}
            disabled={isProcessing || busy || !workspaceRoot}
            title={t('wiki.processNow')}
            aria-label={t('wiki.processNow')}
            aria-busy={isProcessing}
            className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold shadow-sm hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isProcessing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            {t('wiki.processNow')}
            {queue.length > 0 && !isProcessing && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary-foreground/20 text-[10px] font-bold">
                {queue.length}
              </span>
            )}
          </button>
          {isProcessing && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-warning/40 bg-warning/10 text-[11px] text-warning font-medium"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              <span className="truncate">
                {t('wiki.pipelineActive')}
                {pipelineStatus.pending > 0 &&
                  ` · ${t('wiki.statusBarProcessing', { n: pipelineStatus.pending })}`}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => void toggleWatch()}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-card/40 hover:bg-card transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium">
              <span className={`h-2 w-2 rounded-full ${watchEnabled ? 'bg-success' : 'bg-muted-foreground/50'}`} />
              {watchEnabled ? t('wiki.watchOn') : t('wiki.watchOff')}
            </span>
            {watchEnabled ? (
              <Eye className="h-3.5 w-3.5 text-success" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
          <p className="px-1 text-[11px] text-muted-foreground">
            {watchFolders.length > 0
              ? t('wiki.watchFolders', { n: watchFolders.length })
              : t('wiki.noFolders')}
          </p>
        </div>

        <Section
          title={t('wiki.queue')}
          count={queue.length}
          open={openSections.queue}
          onToggle={() => toggleSection('queue')}
        >
          {queue.length === 0 ? (
            <p className="px-1 text-[11px] text-muted-foreground">{t('wiki.queueEmpty')}</p>
          ) : (
            <ul className="space-y-1">
              {queue.map((job) => (
                <li
                  key={job.id}
                  title={job.sourcePath}
                  className="px-2 py-1 rounded-md bg-muted/40 text-[11px] truncate"
                >
                  {baseName(job.sourcePath)}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={t('wiki.recent')}
          count={recent.length}
          open={openSections.recent}
          onToggle={() => toggleSection('recent')}
        >
          {recent.length === 0 ? (
            <p className="px-1 text-[11px] text-muted-foreground">{t('wiki.recentEmpty')}</p>
          ) : (
            <ul className="space-y-1">
              {recent.map((job) => (
                <li
                  key={job.id}
                  title={job.reason ?? job.sourcePath}
                  className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-muted/40 text-[11px]"
                >
                  <span className="truncate">{job.title ?? baseName(job.sourcePath)}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {t(`wiki.status.${job.status}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={t('wiki.pages')}
          count={pages.length}
          open={openSections.pages}
          onToggle={() => toggleSection('pages')}
        >
          {pages.length === 0 ? (
            <p className="px-1 text-[11px] text-muted-foreground">{t('wiki.pagesEmpty')}</p>
          ) : (
            <ul className="space-y-0.5">
              {pages.map((page) => (
                <li key={page.slug}>
                  <button
                    type="button"
                    onClick={() => openPage(page)}
                    title={page.path}
                    className="w-full text-left px-2 py-1 rounded-md text-[11px] hover:bg-muted/60 transition-colors truncate cursor-pointer"
                  >
                    {page.slug}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2 space-y-1.5">
        <button
          type="button"
          onClick={openGraph}
          disabled={!workspaceRoot}
          className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card/40 text-xs font-medium hover:bg-card transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Network className="h-3.5 w-3.5" />
          {t('wiki.openGraph')}
        </button>
        <button
          type="button"
          onClick={openWikiChat}
          disabled={!workspaceRoot}
          className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-primary/40 bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <MessageSquareText className="h-3.5 w-3.5" />
          {t('wiki.openSearch')}
        </button>
      </div>
    </div>
  );
}

export default WikiPanel;
