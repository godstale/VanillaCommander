import type { RunnerEvent } from '@/lib/eval/runner/events';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { cn } from '@/lib/utils';

type LogEvent = Extract<RunnerEvent, { type: 'log' }>;

const RUN_LOG_CAP = 200;

function isLogVisible(e: LogEvent): boolean {
  if (e.level !== 'info') return true;
  return /skip|pause|resum|cancel/i.test(e.message);
}

export function RunLog({ events }: { events: LogEvent[] }) {
  const { t } = useLanguage();

  const visible = events.filter(isLogVisible).slice(-RUN_LOG_CAP);

  if (visible.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{t('eval.progress.log.empty')}</p>
    );
  }

  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
      {visible.map((e, i) => (
        <li
          key={`${i}-${e.message}`}
          className="flex items-start gap-2 rounded-md border border-border/40 bg-card/30 px-2 py-1"
        >
          <span
            className={cn(
              'mt-0.5 shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase',
              e.level === 'error' && 'bg-destructive/15 text-destructive',
              e.level === 'warn' && 'bg-warning/15 text-warning',
              e.level === 'info' && 'bg-muted text-muted-foreground',
            )}
          >
            {e.level}
          </span>
          <span className="min-w-0 flex-1 break-words text-foreground/90">{e.message}</span>
        </li>
      ))}
    </ul>
  );
}
