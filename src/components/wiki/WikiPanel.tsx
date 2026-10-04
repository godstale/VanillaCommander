// P11-31: 위키 사이드 패널. 감시 상태·대기열·최근 처리·페이지 목록.
import { useCallback, useEffect, useState } from 'react';
import { BookOpen, RefreshCw, Settings2, Eye, EyeOff } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { listWikiJobs, getWikiJobsByStatus, type WikiJob } from '@/lib/db/repositories/wikiJobsRepo';
import { createWikiTool } from '@/lib/tools/wiki';
import { buildFileTab, planOpenFile } from '@/lib/commander/openFile';

interface WikiPage {
  slug: string;
  path: string;
  size: number;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
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

  const watchEnabled = settings.wiki.watchEnabled;
  const watchFolders = settings.wiki.watchFolders;

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
        const result = await tool.execute(crypto.randomUUID(), { action: 'list' }, new AbortController().signal);
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

  const openSettings = useCallback(() => {
    openTab({ id: 'wiki', type: 'wiki', title: t('wiki.tabTitle') });
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
        {/* 감시 상태 */}
        <div className="px-3 py-2 border-b border-border/50">
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
          <p className="px-1 pt-1 text-[11px] text-muted-foreground">
            {watchFolders.length > 0
              ? t('wiki.watchFolders', { n: watchFolders.length })
              : t('wiki.noFolders')}
          </p>
        </div>

        {/* 대기열 */}
        <div className="px-3 py-2 border-b border-border/50">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-1 pb-1">
            {t('wiki.queue')} ({queue.length})
          </h3>
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
        </div>

        {/* 최근 처리 */}
        <div className="px-3 py-2 border-b border-border/50">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-1 pb-1">
            {t('wiki.recent')}
          </h3>
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
        </div>

        {/* 페이지 목록 */}
        <div className="px-3 py-2">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-1 pb-1">
            {t('wiki.pages')} ({pages.length})
          </h3>
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
        </div>
      </div>
    </div>
  );
}

export default WikiPanel;
