import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatBytes } from '@/lib/commander/format';
import { useJobs } from '@/lib/commander/useJobs';
import { useGlobalLlmBusy } from '@/lib/agent/chatQueueManager';
import { cn } from '@/lib/utils';

export interface ExplorerStatusInfo {
  path: string;
  total: number;
  totalBytes: number;
  selCount: number;
  selBytes: number;
  selNames: string[];
}

// 파일 탐색기 탭용 상태바: 좌측은 백그라운드 에이전트·작업·오류, 우측은 전체·선택 정보.
// (폴더 경로는 주소창에 이미 표시되므로 본문에는 넣지 않는다.)
export function ExplorerStatusBar({ info }: { info: ExplorerStatusInfo }) {
  const { t } = useLanguage();
  const { jobs } = useJobs();
  const busySessionId = useGlobalLlmBusy();
  const shownNames = info.selNames.slice(0, 3).join(', ');
  const extra = info.selNames.length > 3 ? ` +${info.selNames.length - 3}` : '';

  const running = jobs.filter((j) => j.status === 'running');
  const failed = jobs.filter((j) => j.status === 'error');

  return (
    <div
      aria-label="explorer-status"
      title={info.path}
      className="h-6 w-full shrink-0 flex items-center justify-between gap-3 px-2 bg-tabbar border-t border-border/80 text-[11px] text-muted-foreground select-none overflow-hidden whitespace-nowrap"
    >
      <span className="flex-1 min-w-0 truncate text-left">
        {busySessionId !== null ? (
          <span className="text-warning font-medium" title={t('explorer.statusAgentBusyTitle')}>
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
            {t('explorer.statusAgentBusy')}
          </span>
        ) : running.length > 0 ? (
          <span title={running[running.length - 1]?.label}>
            {t('explorer.statusJobsRunning', { n: String(running.length) })}
            {running.length === 1 && running[0] ? ` — ${running[0].label}` : ''}
          </span>
        ) : failed.length > 0 ? (
          <span className={cn('text-destructive font-medium')} title={failed[failed.length - 1]?.error ?? undefined}>
            {t('explorer.statusJobsFailed', { n: String(failed.length) })}
          </span>
        ) : null}
      </span>
      <span className="flex items-center gap-3 shrink-0 min-w-0">
        <span className="shrink-0 tabular-nums truncate">
          {t('explorer.statusTotal', { total: String(info.total), size: formatBytes(info.totalBytes) })}
        </span>
        {info.selCount > 0 ? (
          <span className="shrink-0 truncate max-w-[60%] text-foreground/80" title={info.selNames.join('\n')}>
            {t('explorer.statusSelectedInfo', { n: String(info.selCount), size: formatBytes(info.selBytes) })}
            {shownNames ? ` — ${shownNames}${extra}` : ''}
          </span>
        ) : (
          <span className="shrink-0 opacity-60">{t('explorer.statusEmpty')}</span>
        )}
      </span>
    </div>
  );
}

export default ExplorerStatusBar;
