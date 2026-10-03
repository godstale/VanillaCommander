import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RefreshCw,
  FolderPlus,
  Eye,
  EyeOff,
  Star,
  Monitor,
  PanelLeft,
  Square,
  Columns2,
  Grid2x2,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { FcSystemFolder } from '@/lib/commander/types';
import { cn } from '@/lib/utils';

export interface ExplorerToolbarProps {
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  showHidden: boolean;
  treeOpen: boolean;
  split: 1 | 2 | 4;
  favorites: string[];
  systemFolders: FcSystemFolder[];
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onRefresh: () => void;
  onNewFolder: () => void;
  onToggleHidden: () => void;
  onToggleTree: () => void;
  onSplitChange: (split: 1 | 2 | 4) => void;
  onOpenPath: (path: string) => void;
  onAddFavorite: () => void;
}

function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

export function ExplorerToolbar(props: ExplorerToolbarProps) {
  const { t } = useLanguage();
  const {
    canBack,
    canForward,
    canUp,
    showHidden,
    treeOpen,
    split,
    favorites,
    systemFolders,
    onBack,
    onForward,
    onUp,
    onRefresh,
    onNewFolder,
    onToggleHidden,
    onToggleTree,
    onSplitChange,
    onOpenPath,
    onAddFavorite,
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
      <Button
        variant="ghost"
        size="icon"
        className={cn(iconBtn, treeOpen && 'text-primary')}
        onClick={onToggleTree}
        title={t('explorer.toggleTree')}
      >
        <PanelLeft className="h-4 w-4" />
      </Button>

      {/* 즐겨찾기·시스템 폴더는 탭 상단 메뉴바에서 연다 (사이드 패널 대체). */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className={iconBtn} title={t('explorer.favoritesMenu')}>
            <Star className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 text-xs">
          {favorites.length === 0 ? (
            <div className="px-2 py-1.5 text-muted-foreground">{t('explorer.noFavorites')}</div>
          ) : (
            favorites.map((fav) => (
              <DropdownMenuItem key={fav} onClick={() => onOpenPath(fav)} title={fav} className="cursor-pointer">
                <Star className="h-3.5 w-3.5 text-warning shrink-0" />
                <span className="truncate">{baseNameOf(fav)}</span>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onAddFavorite} className="cursor-pointer">
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span>{t('explorer.addFavorite')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className={iconBtn} title={t('explorer.systemMenu')}>
            <Monitor className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 text-xs">
          {systemFolders.map((folder) => (
            <DropdownMenuItem
              key={folder.id}
              onClick={() => onOpenPath(folder.path)}
              title={folder.path}
              className={cn('cursor-pointer', !folder.exists && 'opacity-40')}
            >
              <Monitor className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{folder.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />

      {/* 1/2/4 분할 */}
      <div className="flex items-center gap-0.5 rounded-md border border-border/60 p-0.5">
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-6 w-6', split === 1 ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground')}
          onClick={() => onSplitChange(1)}
          title={t('explorer.splitOne')}
        >
          <Square className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-6 w-6', split === 2 ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground')}
          onClick={() => onSplitChange(2)}
          title={t('explorer.splitTwo')}
        >
          <Columns2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-6 w-6', split === 4 ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground')}
          onClick={() => onSplitChange(4)}
          title={t('explorer.splitFour')}
        >
          <Grid2x2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
