import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface ContextGaugeProps {
  tokens: number;
  limit: number;
  onClick?: () => void;
}

export function ContextGauge({ tokens, limit, onClick }: ContextGaugeProps) {
  const { t } = useLanguage();
  const safeLimit = limit > 0 ? limit : 32768;
  const percentage = Math.min(100, Math.round((tokens / safeLimit) * 100));

  let barColor = 'bg-success';
  let textColor = 'text-muted-foreground';

  if (percentage >= 85) {
    barColor = 'bg-destructive';
    textColor = 'text-destructive';
  } else if (percentage >= 65) {
    barColor = 'bg-warning';
    textColor = 'text-warning';
  }

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 text-xs select-none ${
        onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''
      }`}
      title={onClick ? t('gauge.compactTitle') : undefined}
    >
      <div className="flex items-center gap-1.5 font-mono text-[11px]">
        <span className={textColor}>
          {tokens.toLocaleString()}
        </span>
        <span className="text-muted-foreground/60">/</span>
        <span className="text-muted-foreground/80">
          {safeLimit.toLocaleString()}
        </span>
        <span className="text-[10px] text-muted-foreground/60">({percentage}%)</span>
      </div>

      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden border border-border/40">
        <div
          className={`h-full transition-all duration-300 ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
