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
  Rows2,
  Plus,
} from 'lucide-react';
import type { ReactNode } from 'react';
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

// 탐색기 분할 모드: 단일 / 가로 2분할(상·하) / 세로 2분할(좌·우). 4분할은 제공하지 않는다.
export type ExplorerSplit = 'single' | 'dual-h' | 'dual-v';

export interface ExplorerToolbarProps {
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  showHidden: boolean;
  treeOpen: boolean;
  split: ExplorerSplit;
  favorites: string[];
  systemFolders: FcSystemFolder[];
  /** P13-01: true면 단축키가 있는 버튼에 배지를 표시한다. */
  showShortcuts?: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onRefresh: () => void;
  onNewFolder: () => void;
  onToggleHidden: () => void;
  onToggleTree: () => void;
  onSplitChange: (split: ExplorerSplit) => void;
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
    showShortcuts,
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
    'h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none';

  // P13-01: Alt를 누른 동안 단축키를 알리는 배지. 단축키가 있는 버튼에만 표시한다.
  // 배지는 버튼 우하단 안쪽에 둔다. 상단 바깥(-top)은 툴바 스크롤 영역에 잘리므로 쓰지 않는다.
  const badge = (label: string) =>
    showShortcuts ? (
      <kbd className="absolute bottom-0 right-0 rounded border border-primary/50 bg-background px-1 text-[9px] leading-3 font-mono text-primary pointer-events-none shadow-sm">
        {label}
      </kbd>
    ) : null;

  const wrapBtn = (key: string, shortcut: string | null, el: ReactNode) => (
    <span key={key} className="relative inline-flex shrink-0">
      {el}
      {shortcut ? badge(shortcut) : null}
    </span>
  );

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0 min-w-0 overflow-x-auto">
      {wrapBtn('back', '←', (
        <Button variant="ghost" size="icon" className={iconBtn} disabled={!canBack} onClick={onBack} title={`${t('explorer.back')} (Alt+←)`}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
      ))}
      {wrapBtn('forward', '→', (
        <Button variant="ghost" size="icon" className={iconBtn} disabled={!canForward} onClick={onForward} title={`${t('explorer.forward')} (Alt+→)`}>
          <ArrowRight className="h-4 w-4" />
        </Button>
      ))}
      {wrapBtn('up', '⌫', (
        <Button variant="ghost" size="icon" className={iconBtn} disabled={!canUp} onClick={onUp} title={`${t('explorer.up')} (Backspace)`}>
          <ArrowUp className="h-4 w-4" />
        </Button>
      ))}
      {wrapBtn('refresh', 'R', (
        <Button variant="ghost" size="icon" className={iconBtn} onClick={onRefresh} title={`${t('explorer.refresh')} (Ctrl+R)`}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      ))}
      {wrapBtn('newFolder', 'F7', (
        <Button variant="ghost" size="icon" className={iconBtn} onClick={onNewFolder} title={`${t('explorer.newFolder')} (F7)`}>
          <FolderPlus className="h-4 w-4" />
        </Button>
      ))}
      {wrapBtn('hidden', 'H', (
        <Button
          variant="ghost"
          size="icon"
          className={cn(iconBtn, showHidden && 'text-primary')}
          onClick={onToggleHidden}
          title={`${t('explorer.showHidden')} (Ctrl+H)`}
        >
          {showHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>
      ))}
      {wrapBtn('tree', 'B', (
        <Button
          variant="ghost"
          size="icon"
          className={cn(iconBtn, treeOpen && 'text-primary')}
          onClick={onToggleTree}
          title={`${t('explorer.toggleTree')} (Ctrl+B)`}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      ))}

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

      <div className="flex-1 min-w-2" />

      {/* 1 / 가로 2분할 / 세로 2분할 */}
      <div className="flex items-center gap-0.5 rounded-md border border-border/60 p-0.5 shrink-0">
        {wrapBtn('split-single', '1', (
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-6 w-6', split === 'single' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground')}
            onClick={() => onSplitChange('single')}
            title={`${t('explorer.splitOne')} (Ctrl+1)`}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        ))}
        {wrapBtn('split-hor', '2', (
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-6 w-6', split === 'dual-h' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground')}
            onClick={() => onSplitChange('dual-h')}
            title={`${t('explorer.splitHor')} (Ctrl+2)`}
          >
            <Rows2 className="h-3.5 w-3.5" />
          </Button>
        ))}
        {wrapBtn('split-ver', '3', (
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-6 w-6', split === 'dual-v' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground')}
            onClick={() => onSplitChange('dual-v')}
            title={`${t('explorer.splitVer')} (Ctrl+3)`}
          >
            <Columns2 className="h-3.5 w-3.5" />
          </Button>
        ))}
      </div>
    </div>
  );
}
