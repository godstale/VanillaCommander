import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { cn } from '@/lib/utils';

export interface AddressBarProps {
  path: string;
  onNavigate: (path: string) => void;
}

function splitPath(path: string): string[] {
  if (!path) return [];
  // 드라이브 문자(C:)를 첫 세그먼트로 유지한다.
  const parts = path.split(/[\\/]+/).filter((s) => s.length > 0);
  if (/^[a-zA-Z]:$/.test(parts[0] ?? '')) {
    parts[0] = `${parts[0]}\\`;
  }
  return parts;
}

export function AddressBar({ path, onNavigate }: AddressBarProps) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(path);
  const segments = splitPath(path);

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

  let acc = '';
  return (
    <div className="flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto text-xs">
      {segments.length === 0 ? (
        <span className="text-muted-foreground px-1">{t('explorer.addressPlaceholder')}</span>
      ) : (
        segments.map((seg, idx) => {
          const prev = acc;
          acc = idx === 0 && seg.endsWith('\\') ? seg : `${prev}${prev ? '/' : ''}${seg}`;
          const target = acc;
          const last = idx === segments.length - 1;
          return (
            <span key={`${idx}:${seg}`} className="flex items-center shrink-0">
              {idx > 0 && <span className="text-muted-foreground/50 px-0.5">/</span>}
              <button
                type="button"
                onClick={() => {
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
