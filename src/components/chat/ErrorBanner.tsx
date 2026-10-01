import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface ErrorBannerProps {
  error: Error | null;
  onRetry: () => void;
  onDismiss?: () => void;
}

export function ErrorBanner({ error, onRetry, onDismiss }: ErrorBannerProps) {
  const { t } = useLanguage();
  if (!error) return null;

  let title = t('errorBanner.default');
  let message = error.message;

  if (error.name === 'OllamaConnectionError' || error.message.includes('Ollama connection')) {
    title = t('errorBanner.connTitle');
    message = t('errorBanner.connBody');
  } else if (error.name === 'OllamaModelNotFoundError' || error.message.includes('model not found')) {
    title = t('errorBanner.modelTitle');
    message = t('errorBanner.modelBody');
  } else if (error.name === 'OllamaContextOverflowError' || error.message.includes('context')) {
    title = t('errorBanner.overflowTitle');
    message = t('errorBanner.overflowBody');
  }

  return (
    <div className="mx-4 my-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-start justify-between gap-3 shadow-xs">
      <div className="flex items-start gap-2.5 min-w-0">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
        <div className="space-y-0.5">
          <p className="font-semibold text-[13px]">{title}</p>
          <p className="text-muted-foreground text-[11px] leading-relaxed break-words">
            {message}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          className="h-7 px-2.5 text-xs flex items-center gap-1 border-destructive/30 hover:bg-destructive/10 text-destructive"
        >
          <RefreshCw className="h-3 w-3" />
          <span>{t('errorBanner.retry')}</span>
        </Button>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
