import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { cn } from '@/lib/utils';

export interface AddressBarProps {
  path: string;
  onNavigate: (path: string) => void;
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

export function AddressBar({ path, onNavigate }: AddressBarProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(path);
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
                onClick={() => {
                  // 현재 탭에서 이동한다. 새 탭을 열지 않는다.
                  if (!last) onNavigate(target);
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
      <button
        type="button"
        aria-label={t('explorer.addressPlaceholder')}
        onClick={() => {
          setDraft(path);
          setEditing(true);
        }}
        className="ml-1 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40 shrink-0"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}
