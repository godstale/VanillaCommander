import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { FcEntry } from '@/lib/commander/types';
import { isAlbumEntry } from '@/lib/commander/openFile';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { FileKindIcon } from './FileIcon';
import { cn } from '@/lib/utils';

export interface AlbumViewProps {
  /** 표시 후보 (상위 폴더 '..'행 포함, 앨범에서 폴더·이미지만 걸러낸다). */
  entries: FcEntry[];
  selected: Set<string>;
  activePath: string | null;
  onSelect: (target: string, mode: 'single' | 'toggle' | 'range') => void;
  onOpen: (entry: FcEntry) => void;
  onContextMenu: (e: React.MouseEvent, entry: FcEntry | null) => void;
}

function AlbumThumb({ entry }: { entry: FcEntry }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="flex h-full w-full items-center justify-center">
        <FileKindIcon name={entry.name} kind={entry.kind} className="h-10 w-10" />
      </span>
    );
  }
  return (
    <img
      src={convertFileSrc(entry.path)}
      alt={entry.name}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}

// 이미지 브라우저: 폴더와 이미지만 앨범(썸네일 격자)으로 보여준다.
// 선택·열기·우클릭 동작은 텍스트 목록과 동일하다.
export function AlbumView({ entries, selected, activePath, onSelect, onOpen, onContextMenu }: AlbumViewProps) {
  const { t } = useLanguage();
  const shown = entries.filter(isAlbumEntry);

  if (shown.length === 0) {
    return (
      <div
        className="flex-1 min-h-0 overflow-auto flex items-center justify-center text-xs text-muted-foreground"
        onContextMenu={(e) => onContextMenu(e, null)}
      >
        {t('explorer.albumEmpty')}
      </div>
    );
  }

  return (
    <div
      className="flex-1 min-h-0 overflow-auto p-2 grid gap-2 content-start grid-cols-[repeat(auto-fill,minmax(120px,1fr))]"
      onContextMenu={(e) => onContextMenu(e, null)}
    >
      {shown.map((entry) => {
        const isSelected = selected.has(entry.path);
        const isActive = activePath === entry.path;
        const isDir = entry.kind === 'dir';
        return (
          <div
            key={entry.path}
            onClick={(e) => {
              onSelect(entry.path, e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'single');
            }}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={(e) => {
              e.stopPropagation();
              onContextMenu(e, entry);
            }}
            title={entry.path}
            className={cn(
              'flex flex-col min-w-0 rounded-md border overflow-hidden cursor-default select-none',
              isSelected
                ? 'border-primary bg-primary/15'
                : 'border-border/50 bg-card/40 hover:bg-accent/40',
              isActive && !isSelected && 'outline-1 outline -outline-offset-1 outline-primary/50',
            )}
          >
            <span className="block aspect-square w-full overflow-hidden bg-muted/20">
              {isDir ? (
                <span className="flex h-full w-full items-center justify-center">
                  <FileKindIcon name={entry.name} kind={entry.kind} className="h-10 w-10" />
                </span>
              ) : (
                <AlbumThumb entry={entry} />
              )}
            </span>
            <span className="truncate px-2 py-2 text-[11px] leading-5 text-foreground/90" title={entry.name}>
              {entry.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default AlbumView;
