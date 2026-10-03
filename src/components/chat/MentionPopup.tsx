import { File as FileIcon, Folder } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { MentionItem } from '@/lib/chat/mentions';
import { cn } from '@/lib/utils';

export function MentionPopup({
  items,
  index,
  onPick,
  onHover,
}: {
  items: MentionItem[];
  index: number;
  onPick: (item: MentionItem) => void;
  onHover: (index: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <div
      role="listbox"
      aria-label={t('mention.popupLabel')}
      className="absolute bottom-full left-0 right-0 mb-2 max-h-56 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg z-50"
    >
      <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        {t('mention.header')}
      </div>
      {items.map((item, i) => (
        <button
          key={item.path}
          type="button"
          role="option"
          aria-selected={i === index}
          onClick={() => onPick(item)}
          onMouseEnter={() => onHover(i)}
          className={cn(
            'w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
            i === index ? 'bg-accent text-accent-foreground font-medium' : 'text-foreground hover:bg-muted/50',
          )}
        >
          {item.isDir ? (
            <Folder className="h-3.5 w-3.5 text-warning shrink-0" />
          ) : (
            <FileIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="truncate flex-1">{item.name}</span>
          <span className="truncate max-w-48 font-mono text-[10px] text-muted-foreground">{item.path}</span>
        </button>
      ))}
      <div className="px-2 py-1 text-[10px] text-muted-foreground/70">
        {t('mention.hint')}
      </div>
    </div>
  );
}
