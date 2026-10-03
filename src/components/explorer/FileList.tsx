import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { FcEntry } from '@/lib/commander/types';
import { formatBytes } from '@/lib/commander/format';
import { FileKindIcon } from './FileIcon';
import { cn } from '@/lib/utils';

export type SortKey = 'name' | 'size' | 'kind' | 'modified';
export type SortDir = 'asc' | 'desc';

export interface FileListProps {
  entries: FcEntry[];
  selected: Set<string>;
  activePath: string | null;
  sortKey: SortKey;
  sortDir: SortDir;
  editingPath: string | null;
  editingValue: string;
  creatingMkdir: boolean;
  mkdirValue: string;
  onSelect: (path: string, mode: 'single' | 'toggle' | 'range') => void;
  onOpen: (entry: FcEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FcEntry | null) => void;
  onSort: (key: SortKey) => void;
  onEditingChange: (value: string) => void;
  onEditingCommit: () => void;
  onEditingCancel: () => void;
  onMkdirChange: (value: string) => void;
  onMkdirCommit: () => void;
  onMkdirCancel: () => void;
}

function formatTime(ms: number | null): string {
  if (ms === null) return '';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '';
  }
}

export function FileList(props: FileListProps) {
  const { t } = useLanguage();
  const {
    entries,
    selected,
    activePath,
    sortKey,
    sortDir,
    editingPath,
    editingValue,
    creatingMkdir,
    mkdirValue,
    onSelect,
    onOpen,
    onContextMenu,
    onSort,
    onEditingChange,
    onEditingCommit,
    onEditingCancel,
    onMkdirChange,
    onMkdirCommit,
    onMkdirCancel,
  } = props;

  const header = (key: SortKey, label: string, className?: string) => (
    <button
      type="button"
      onClick={() => onSort(key)}
      className={cn(
        'px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground text-left cursor-pointer',
        className,
      )}
    >
      {label}
      {sortKey === key && <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );

  return (
    <div className="flex-1 min-h-0 overflow-auto" onContextMenu={(e) => onContextMenu(e, null)}>
      <div className="min-w-[560px]">
        <div className="grid grid-cols-[1fr_90px_130px_150px] gap-1 border-b border-border sticky top-0 bg-tabbar z-10">
          {header('name', t('explorer.colName'))}
          {header('size', t('explorer.colSize'), 'text-right')}
          {header('kind', t('explorer.colKind'))}
          {header('modified', t('explorer.colModified'))}
        </div>
        {creatingMkdir && (
          <div className="grid grid-cols-[1fr_90px_130px_150px] gap-1 px-2 py-1 items-center border-b border-border/50">
            <span className="flex items-center gap-2 min-w-0">
              <FileKindIcon name="__dir__" kind="dir" />
              <input
                autoFocus
                value={mkdirValue}
                onChange={(e) => onMkdirChange(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') onMkdirCommit();
                  if (e.key === 'Escape') onMkdirCancel();
                }}
                onBlur={onMkdirCommit}
                className="flex-1 min-w-0 rounded border border-input bg-background px-1 py-0.5 text-xs outline-none focus:border-primary"
              />
            </span>
            <span />
            <span />
            <span />
          </div>
        )}
        {entries.map((entry) => {
          const isSelected = selected.has(entry.path);
          const isActive = activePath === entry.path;
          const isEditing = editingPath === entry.path;
          return (
            <div
              key={entry.path}
              data-path={entry.path}
              onClick={(e) => {
                if (isEditing) return;
                onSelect(entry.path, e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'single');
              }}
              onDoubleClick={() => {
                if (!isEditing) onOpen(entry);
              }}
              onContextMenu={(e) => {
                e.stopPropagation();
                onContextMenu(e, entry);
              }}
              className={cn(
                'grid grid-cols-[1fr_90px_130px_150px] gap-1 px-2 py-1 items-center text-xs cursor-default border-b border-border/30',
                isSelected ? 'bg-primary/15 text-foreground' : 'text-foreground/90 hover:bg-accent/40',
                isActive && !isSelected && 'outline-1 outline -outline-offset-1 outline-primary/50',
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <FileKindIcon name={entry.name} kind={entry.kind} symlink={entry.symlink} />
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingValue}
                    onChange={(e) => onEditingChange(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') onEditingCommit();
                      if (e.key === 'Escape') onEditingCancel();
                    }}
                    onBlur={onEditingCommit}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 rounded border border-input bg-background px-1 py-0.5 text-xs outline-none focus:border-primary"
                  />
                ) : (
                  <span className="truncate" title={entry.path}>
                    {entry.name}
                  </span>
                )}
              </span>
              <span className="text-right font-mono text-[11px] text-muted-foreground">
                {entry.kind === 'dir' ? '' : formatBytes(entry.size)}
              </span>
              <span className="truncate text-muted-foreground">
                {entry.kind === 'dir'
                  ? t('explorer.kindFolder')
                  : entry.name.includes('.')
                    ? `${entry.name.split('.').pop()?.toUpperCase()} ${t('explorer.kindFile')}`
                    : t('explorer.kindFile')}
              </span>
              <span className="truncate text-muted-foreground text-[11px]">
                {formatTime(entry.modified_ms)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
