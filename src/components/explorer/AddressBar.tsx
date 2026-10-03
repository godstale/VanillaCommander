import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useAltHeld } from '@/hooks/useAltHeld';
import { fcOpenTerminal, fcReveal } from '@/lib/commander/ipc';
import { cn } from '@/lib/utils';

export interface AddressBarProps {
  path: string;
  onNavigate: (path: string) => void;
  /** P13-01: 값이 바뀌면 직접 입력 상태로 전환한다 (Alt+D). */
  editSignal?: number;
  onError?: (message: string) => void;
}

/** Windows canonicalize가 반환하는 `\\?\` verbatim 접두를 UI용 일반 경로로 되돌린다. */
function stripVerbatimPrefix(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return `\\${path.slice(7)}`;
  if (path.startsWith('\\\\?\\')) return path.slice(4);
  return path;
}

function splitPath(path: string): string[] {
  const clean = stripVerbatimPrefix(path);
  if (!clean) return [];
  const sep = clean.includes('\\') ? '\\' : '/';
  const isUnc = clean.startsWith('\\\\');
  const parts = clean.split(/[\\/]+/).filter((s) => s.length > 0);
  if (parts.length === 0) return clean.startsWith('/') ? ['/'] : [];
  // 드라이브 문자(C:)를 첫 세그먼트로 유지한다. 구분자는 원본 스타일을 따른다.
  if (/^[a-zA-Z]:$/.test(parts[0] ?? '')) {
    parts[0] = sep === '\\' ? `${parts[0]}\\` : parts[0];
    return parts;
  }
  if (isUnc && parts.length > 0) {
    parts[0] = `\\\\${parts[0]}`;
    return parts;
  }
  if (clean.startsWith('/') && parts.length > 0) {
    return ['/', ...parts];
  }
  return parts;
}

function buildTargets(path: string, segments: string[]): string[] {
  const clean = stripVerbatimPrefix(path);
  const sep = clean.includes('\\') ? '\\' : '/';
  const targets: string[] = [];
  let acc = '';
  segments.forEach((seg) => {
    if (acc === '') {
      acc = seg;
    } else {
      acc = `${acc}${acc.endsWith('\\') || acc.endsWith('/') ? '' : sep}${seg}`;
    }
    targets.push(acc);
  });
  return targets;
}

const menuItem =
  'flex w-full items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-left cursor-pointer disabled:pointer-events-none disabled:opacity-50';

export function AddressBar({ path, onNavigate, editSignal, onError }: AddressBarProps) {
  const { t } = useLanguage();
  const { settings, updateSettings } = useSettings();
  const altHeld = useAltHeld();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(path);
  const [segMenu, setSegMenu] = useState<{ x: number; y: number; target: string } | null>(null);
  const segments = splitPath(path);
  const targets = buildTargets(path, segments);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 탐색 깊이가 깊어 경로가 길어지면 우측 끝(현재 폴더)이 보이도록 스크롤한다.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [path]);

  // P13-01: Alt+D 신호가 오면 직접 입력 상태로 전환한다.
  // 최초 마운트는 이전 값과 비교해 걸러낸다. firstSignal 플래그 방식은
  // StrictMode 이중 마운트에서 두 번째 이펙트가 편집 모드를 켜 버려
  // 분할·채팅 토글 때마다 주소 입력창이 포커스를 가로챘다 (P13-06).
  const prevSignal = useRef(editSignal);
  useEffect(() => {
    if (prevSignal.current === editSignal) return;
    prevSignal.current = editSignal;
    setDraft(path);
    setEditing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSignal]);

  // 메뉴가 열려 있을 때 바깥 클릭·Escape로 닫는다.
  useEffect(() => {
    if (!segMenu) return;
    const close = () => setSegMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSegMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [segMenu]);

  const fail = (err: unknown) => {
    onError?.(err instanceof Error ? err.message : String(err));
  };

  const addFavorite = (target: string) => {
    if (!target || settings.favorites.includes(target)) return;
    void updateSettings({ favorites: [...settings.favorites, target] }).catch(fail);
  };

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== path) {
      onNavigate(next);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(path);
              setEditing(false);
            }
          }}
          onBlur={commit}
          placeholder={t('explorer.addressPlaceholder')}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs font-mono outline-none focus:border-primary"
        />
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto text-xs">
      {segments.length === 0 ? (
        <span className="text-muted-foreground px-1">{t('explorer.addressPlaceholder')}</span>
      ) : (
        segments.map((seg, idx) => {
          const target = targets[idx] ?? seg;
          const last = idx === segments.length - 1;
          return (
            <span key={`${idx}:${seg}`} className="flex items-center shrink-0">
              {idx > 0 && <span className="text-muted-foreground/50 px-0.5">/</span>}
              <button
                type="button"
                title={target}
                onClick={() => {
                  // 현재 탭에서 이동한다. 새 탭을 열지 않는다.
                  if (!last) onNavigate(target);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSegMenu({
                    x: Math.min(e.clientX, window.innerWidth - 230),
                    y: Math.min(e.clientY, window.innerHeight - 260),
                    target,
                  });
                }}
                className={cn(
                  'px-1 py-0.5 rounded truncate max-w-48',
                  last
                    ? 'text-foreground font-medium cursor-default'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/40 cursor-pointer',
                )}
              >
                {seg}
              </button>
            </span>
          );
        })
      )}
      <span className="relative ml-1 shrink-0">
        <button
          type="button"
          aria-label={t('explorer.addressPlaceholder')}
          title={`${t('explorer.addressEdit')} (Alt+D)`}
          onClick={() => {
            setDraft(path);
            setEditing(true);
          }}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40"
        >
          <Pencil className="h-3 w-3" />
        </button>
        {altHeld && (
          <kbd className="absolute bottom-0 right-0 rounded border border-primary/50 bg-background px-1 text-[9px] font-mono text-primary pointer-events-none shadow-sm">
            D
          </kbd>
        )}
      </span>
      {segMenu && (
        <div
          role="menu"
          className="fixed z-50 w-56 rounded-md border border-border bg-popover/95 p-1 text-popover-foreground shadow-md backdrop-blur-sm text-xs select-none"
          style={{ left: segMenu.x, top: segMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="px-2 py-1.5 truncate text-muted-foreground font-mono text-[11px]" title={segMenu.target}>
            {segMenu.target}
          </div>
          <div className="-mx-1 my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => {
              setSegMenu(null);
              onNavigate(segMenu.target);
            }}
          >
            {t('explorer.ctxOpen')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => {
              const target = segMenu.target;
              setSegMenu(null);
              void fcOpenTerminal(target).catch(fail);
            }}
          >
            {t('explorer.ctxOpenTerminal')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => {
              const target = segMenu.target;
              setSegMenu(null);
              void fcReveal(target).catch(fail);
            }}
          >
            {t('explorer.ctxReveal')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => {
              const target = segMenu.target;
              setSegMenu(null);
              void navigator.clipboard?.writeText(target).catch(() => {});
            }}
          >
            {t('explorer.ctxCopyPath')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => {
              const target = segMenu.target;
              setSegMenu(null);
              addFavorite(target);
            }}
          >
            {t('explorer.ctxFavorite')}
          </button>
        </div>
      )}
    </div>
  );
}
