import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatBytes } from '@/lib/commander/format';

export interface ExplorerStatusInfo {
  path: string;
  total: number;
  totalBytes: number;
  selCount: number;
  selBytes: number;
  selNames: string[];
}

// 파일 탐색기 탭용 상태바: 전체 개수 + 선택 상태만 표시한다 (폴더 경로는 주소창에 이미 표시됨).
export function ExplorerStatusBar({ info }: { info: ExplorerStatusInfo }) {
  const { t } = useLanguage();
  const shownNames = info.selNames.slice(0, 3).join(', ');
  const extra = info.selNames.length > 3 ? ` +${info.selNames.length - 3}` : '';

  return (
    <div
      aria-label="explorer-status"
      title={info.path}
      className="h-6 w-full shrink-0 flex items-center justify-end gap-3 px-2 bg-tabbar border-t border-border/80 text-[11px] text-muted-foreground select-none overflow-hidden whitespace-nowrap"
    >
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
    </div>
  );
}

export default ExplorerStatusBar;
