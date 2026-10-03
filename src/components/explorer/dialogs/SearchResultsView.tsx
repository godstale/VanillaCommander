import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { FcSearchMatch } from '@/lib/commander/types';
import { cn } from '@/lib/utils';

export interface SearchResultsViewProps {
  matches: FcSearchMatch[];
  searching: boolean;
  onOpenPath: (path: string, isDir: boolean) => void;
  onCancel: () => void;
  onClear: () => void;
}

export function SearchResultsView({ matches, searching, onOpenPath, onCancel, onClear }: SearchResultsViewProps) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-medium flex-1 truncate">
          {searching
            ? `${t('search.searching')} (${matches.length})`
            : matches.length > 0
              ? t('search.results', { n: String(matches.length) })
              : t('search.noResults')}
        </span>
        {searching ? (
          <Button variant="outline" size="sm" onClick={onCancel} className="text-xs h-7">
            {t('search.cancelSearch')}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={onClear} className="text-xs h-7">
            {t('workspace.close')}
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {matches.map((m, idx) => (
          <button
            key={`${m.path}:${m.line_number ?? 0}:${idx}`}
            type="button"
            onClick={() => onOpenPath(m.path, m.is_dir)}
            title={t('search.openFile')}
            className={cn(
              'w-full text-left px-3 py-1.5 text-xs border-b border-border/50',
              'hover:bg-accent/40 transition-colors cursor-pointer',
            )}
          >
            <div className="font-mono text-[11px] truncate text-foreground">{m.path}</div>
            {m.line_number !== null && (
              <div className="font-mono text-[11px] truncate text-muted-foreground">
                <span className="text-primary">{m.line_number}</span>
                {'  '}
                {m.line_content ?? ''}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
