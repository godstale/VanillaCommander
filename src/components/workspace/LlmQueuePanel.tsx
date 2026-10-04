// 로컬 LLM 트랜잭션 큐 현황. 항목 삭제·전체 비우기를 제공한다 (모니터링 탭에 임베드).
import { useEffect, useState } from 'react';
import { ListOrdered, Loader2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { llmQueue, useLlmQueue } from '@/lib/agent/llmQueue';
import { useLanguage } from '@/lib/i18n/LanguageContext';

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function LlmQueuePanel() {
  const { t } = useLanguage();
  const items = useLlmQueue();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (items.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [items.length]);

  const timeoutMin = Math.round(llmQueue.getTimeoutMs() / 60_000);

  return (
    <div className="rounded-xl bg-card border border-border p-3.5 space-y-2" data-testid="llm-queue-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <ListOrdered className="h-3.5 w-3.5 text-primary" />
          <span>{t('monitor.queueTitle')}</span>
          <span className="text-[10px] font-normal text-muted-foreground">
            {t('monitor.queueCount', { n: items.length })} · {t('monitor.queueTimeout', { n: timeoutMin })}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => llmQueue.clear()}
          disabled={items.length === 0}
          className="h-7 text-[11px] gap-1 text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
        >
          <Trash2 className="h-3 w-3" />
          {t('monitor.queueClear')}
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t('monitor.queueEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {items.map((item) => {
            const running = item.status === 'running';
            const since = running ? item.startedAt ?? item.enqueuedAt : item.enqueuedAt;
            return (
              <li key={item.id} className="flex items-center gap-2 py-1.5 text-xs">
                {running ? (
                  <Loader2 className="h-3 w-3 animate-spin text-warning shrink-0" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-subtle shrink-0" />
                )}
                <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] shrink-0">
                  {t(item.kind === 'wiki' ? 'monitor.queueKindWiki' : 'monitor.queueKindChat')}
                </span>
                <span className="truncate flex-1" title={item.label}>{item.label}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {running ? t('monitor.queueRunning') : t('monitor.queueWaiting')} · {formatElapsed(now - since)}
                </span>
                <button
                  type="button"
                  onClick={() => llmQueue.remove(item.id)}
                  title={t('monitor.queueRemove')}
                  aria-label={t('monitor.queueRemove')}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default LlmQueuePanel;
