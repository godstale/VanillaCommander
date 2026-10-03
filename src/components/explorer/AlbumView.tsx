import { useEffect, useRef, useState } from 'react';
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
  const [loaded, setLoaded] = useState(false);
  // 뷰포트 근처 타일만 원본을 요청한다. 100개가 넘는 고해상도 원본을
  // 동시에 로드·디코드하면 asset 프로토콜·디코더가 밀려 빈 칸으로 보인다.
  const [nearby, setNearby] = useState(() => typeof IntersectionObserver === 'undefined');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const ob = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) {
          setNearby(true);
          ob.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  if (failed) {
    return (
      <span className="flex h-full w-full items-center justify-center">
        <FileKindIcon name={entry.name} kind={entry.kind} className="h-10 w-10" />
      </span>
    );
  }
  return (
    <div ref={boxRef} className="relative h-full w-full">
      {!loaded && (
        <span className="absolute inset-0 flex items-center justify-center bg-muted/20">
          <FileKindIcon
            name={entry.name}
            kind={entry.kind}
            className="h-10 w-10 opacity-40 animate-pulse"
          />
        </span>
      )}
      {nearby && (
        <img
          src={convertFileSrc(entry.path)}
          alt={entry.name}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            'h-full w-full object-cover transition-opacity',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </div>
  );
}

// 이미지 브라우저: 폴더와 이미지만 앨범(썸네일 격자)으로 보여준다.
// 선택·열기·우클릭 동작은 텍스트 목록과 동일하다.
// P13-09: 방향키는 격자 방향대로 이동한다 (상·하는 한 행씩, 좌·우는 한 칸씩).
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
      data-album-grid
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
            <div className="relative aspect-square w-full overflow-hidden bg-muted/20">
              {isDir ? (
                <span className="flex h-full w-full items-center justify-center">
                  <FileKindIcon name={entry.name} kind={entry.kind} className="h-10 w-10" />
                </span>
              ) : (
                <AlbumThumb entry={entry} />
              )}
            </div>
            <span className="truncate px-2 py-3 text-[11px] leading-5 text-foreground/90" title={entry.name}>
              {entry.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default AlbumView;
