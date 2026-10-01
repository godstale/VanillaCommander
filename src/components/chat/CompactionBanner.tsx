import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface CompactionBannerProps {
  summary: string;
  tokensBefore?: number;
  tokensAfter?: number;
  reason?: string;
}

export function CompactionBanner({
  summary,
  tokensBefore,
  tokensAfter,
  reason,
}: CompactionBannerProps) {
  const { t } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(false);

  const reasonLabel =
    reason === 'overflow'
      ? t('compactBadge.overflow')
      : reason === 'manual'
        ? t('compactBadge.manual')
        : t('compactBadge.auto');

  const tokenText =
    tokensBefore !== undefined
      ? tokensAfter !== undefined
        ? t('compactBanner.tokensBeforeAfter', {
            before: tokensBefore.toLocaleString(),
            after: tokensAfter.toLocaleString(),
          })
        : t('compactBanner.tokensBefore', { before: tokensBefore.toLocaleString() })
      : '';

  return (
    <div className="my-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs transition-all shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <span>{t('compactBanner.summarized', { tokens: tokenText })}</span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
            {reasonLabel}
          </span>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1"
        >
          <FileText className="h-3.5 w-3.5" />
          <span>{isExpanded ? t('compactBanner.hide') : t('compactBanner.show')}</span>
          {isExpanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </Button>
      </div>

      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-border/60 text-foreground/90 max-h-96 overflow-y-auto pr-1">
          <div className="prose prose-xs dark:prose-invert max-w-none text-xs leading-relaxed font-sans">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {summary}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
