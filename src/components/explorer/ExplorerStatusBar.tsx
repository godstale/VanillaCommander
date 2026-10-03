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

// 파일 탐색기 탭용 상태바: 현재 폴더 정보 + 선택 상태.
export function ExplorerStatusBar({ info }: { info: ExplorerStatusInfo }) {
  const { t } = useLanguage();
  const shownNames = info.selNames.slice(0, 3).join(', ');
  const extra = info.selNames.length > 3 ? ` +${info.selNames.length - 3}` : '';

  return (
    <div
      aria-label="explorer-status"
      className="h-6 w-full shrink-0 flex items-center gap-3 px-2 bg-tabbar border-t border-border/80 text-[11px] text-muted-foreground select-none overflow-hidden"
    >
      <span className="truncate min-w-0 flex-1 font-mono" title={info.path}>
        {info.path}
      </span>
      <span className="shrink-0 tabular-nums">
        {t('explorer.statusTotal', { total: String(info.total), size: formatBytes(info.totalBytes) })}
      </span>
      {info.selCount > 0 ? (
        <span className="shrink-0 truncate max-w-[50%] text-foreground/80" title={info.selNames.join('\n')}>
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
