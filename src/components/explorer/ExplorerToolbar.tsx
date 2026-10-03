import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RefreshCw,
  FolderPlus,
  Eye,
  EyeOff,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { cn } from '@/lib/utils';

export interface ExplorerToolbarProps {
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  showHidden: boolean;
  searchText: string;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onRefresh: () => void;
  onNewFolder: () => void;
  onToggleHidden: () => void;
  onSearchText: (text: string) => void;
  onSearchSubmit: () => void;
}

export function ExplorerToolbar(props: ExplorerToolbarProps) {
  const { t } = useLanguage();
  const {
    canBack,
    canForward,
    canUp,
    showHidden,
    searchText,
    onBack,
    onForward,
    onUp,
    onRefresh,
    onNewFolder,
    onToggleHidden,
    onSearchText,
    onSearchSubmit,
  } = props;

  const iconBtn =
    'h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none';

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0">
      <Button variant="ghost" size="icon" className={iconBtn} disabled={!canBack} onClick={onBack} title={t('explorer.back')}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className={iconBtn} disabled={!canForward} onClick={onForward} title={t('explorer.forward')}>
        <ArrowRight className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className={iconBtn} disabled={!canUp} onClick={onUp} title={t('explorer.up')}>
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className={iconBtn} onClick={onRefresh} title={t('explorer.refresh')}>
        <RefreshCw className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className={iconBtn} onClick={onNewFolder} title={t('explorer.newFolder')}>
        <FolderPlus className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(iconBtn, showHidden && 'text-primary')}
        onClick={onToggleHidden}
        title={t('explorer.showHidden')}
      >
        {showHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </Button>
      <div className="flex-1" />
      <div className="relative w-48">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
        <input
          value={searchText}
          data-explorer-search
          onChange={(e) => onSearchText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') onSearchSubmit();
          }}
          placeholder={t('explorer.searchPlaceholder')}
          className="w-full rounded-md border border-input bg-background pl-7 pr-2 py-1 text-xs outline-none focus:border-primary placeholder:text-muted-foreground/60"
        />
      </div>
    </div>
  );
}
