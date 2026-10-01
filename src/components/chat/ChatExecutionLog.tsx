import { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Download,
  Trash2,
  Filter,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { appLogger, type LogEntry, type LogLevel } from '@/lib/logger/logger';
import type { AgentMessage } from '@/lib/agent/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface ChatExecutionLogProps {
  sessionId: string;
  messages?: AgentMessage[];
}

export function ChatExecutionLog({ sessionId }: ChatExecutionLogProps) {
  const { t } = useLanguage();
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [logs, setLogs] = useState<LogEntry[]>(() => {
    return appLogger.getSessionLogs(sessionId);
  });
  const [filterLevel, setFilterLevel] = useState<LogLevel | 'all'>('all');
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchLogs = async () => {
      const loaded =
        scope === 'current'
          ? await appLogger.loadSessionLogs(sessionId)
          : await appLogger.loadAllLogs(1000);
      if (!cancelled) {
        setLogs(loaded);
      }
    };
    void fetchLogs();

    const unsubscribe = appLogger.subscribe((entry) => {
      if (scope === 'all' || !entry.sessionId || entry.sessionId === sessionId) {
        setLogs((prev) => {
          if (prev.some((l) => l.id === entry.id)) return prev;
          return [...prev, entry];
        });
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [scope, sessionId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const filteredLogs = logs.filter((l) => {
    if (filterLevel === 'all') return true;
    return l.level === filterLevel;
  });

  const handleClearLogs = async () => {
    if (scope === 'current') {
      await appLogger.clearSessionLogs(sessionId);
    } else {
      await appLogger.clearSessionLogs();
    }
    setLogs([]);
    setClearDialogOpen(false);
  };

  const handleDownload = () => {
    const text = filteredLogs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.category}] ${l.message} ${
            l.details ? JSON.stringify(l.details) : ''
          }`,
      )
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `execution-log-${scope === 'current' ? sessionId : 'all'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getLevelIcon = (level: LogLevel) => {
    switch (level) {
      case 'error':
        return <XCircle className="h-3 w-3 text-destructive shrink-0" />;
      case 'warn':
        return <AlertTriangle className="h-3 w-3 text-warning shrink-0" />;
      case 'info':
        return <Info className="h-3 w-3 text-primary shrink-0" />;
      case 'debug':
        return <CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0" />;
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-sidebar/50 text-foreground font-mono text-xs min-h-0">
      {/* Top Filter Bar */}
      <div className="flex flex-wrap items-center justify-between p-2.5 border-b border-border/80 bg-card/40 shrink-0 select-none gap-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-primary" />
          <span className="font-semibold text-foreground text-xs font-sans">
            {t('execLog.title')}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">{t('execLog.count', { n: filteredLogs.length })}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Scope Selector */}
          <div className="flex items-center rounded-lg bg-muted/60 p-0.5 text-[10px] font-sans">
            <button
              type="button"
              onClick={() => setScope('current')}
              className={`px-2 py-0.5 rounded-md transition-colors ${
                scope === 'current'
                  ? 'bg-background text-foreground font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('execLog.current')}
            </button>
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`px-2 py-0.5 rounded-md transition-colors ${
                scope === 'all'
                  ? 'bg-background text-foreground font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('execLog.all')}
            </button>
          </div>

          {/* Level Filter Buttons */}
          <div className="flex items-center rounded-lg bg-muted/60 p-0.5 text-[10px]">
            {(['all', 'info', 'warn', 'error', 'debug'] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setFilterLevel(lvl)}
                className={`px-2 py-0.5 rounded-md capitalize transition-colors ${
                  filterLevel === lvl
                    ? 'bg-background text-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="h-6 text-[11px] gap-1 px-2 text-muted-foreground hover:text-foreground"
            title={t('execLog.downloadTitle')}
          >
            <Download className="h-3 w-3" />
            <span>{t('execLog.save')}</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setClearDialogOpen(true)}
            className="h-6 text-[11px] gap-1 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            title={t('execLog.clearTitle')}
          >
            <Trash2 className="h-3 w-3" />
            <span>{t('execLog.clear')}</span>
          </Button>
        </div>
      </div>

      {/* Log list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-1.5 min-h-0 select-text">
        {filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-xs font-sans space-y-1">
            <Filter className="h-6 w-6 mx-auto opacity-40 mb-2" />
            <p>{t('execLog.empty')}</p>
            <p className="text-[11px] opacity-70">
              {t('execLog.emptyDesc')}
            </p>
          </div>
        ) : (
          filteredLogs.map((l) => {
            const timeStr = new Date(l.timestamp).toLocaleTimeString();
            return (
              <div
                key={l.id}
                className={`p-2.5 rounded-lg border leading-relaxed text-[11px] break-all transition-colors ${
                  l.level === 'error'
                    ? 'bg-destructive/10 border-destructive/30 text-destructive'
                    : l.level === 'warn'
                    ? 'bg-warning/10 border-warning/30 text-warning'
                    : l.level === 'debug'
                    ? 'bg-muted/20 border-border/30 text-muted-foreground'
                    : 'bg-card/70 border-border/60 text-foreground'
                }`}
              >
                <div className="flex items-center gap-2 mb-1 opacity-80 text-[10px]">
                  {getLevelIcon(l.level)}
                  <span>{timeStr}</span>
                  <span className="font-bold uppercase tracking-wider px-1 py-0.2 rounded bg-background/60 border border-border/30">
                    {l.category}
                  </span>
                  <span className="uppercase font-semibold">{l.level}</span>
                  {l.sessionId && scope === 'all' && (
                    <span className="text-muted-foreground text-[9px] font-mono">
                      sid:{l.sessionId.slice(0, 8)}
                    </span>
                  )}
                </div>
                <div className="font-sans text-[12px]">{l.message}</div>
                {l.details !== undefined && (
                  <pre className="mt-1.5 p-2 rounded bg-background/70 text-[10px] text-muted-foreground overflow-x-auto border border-border/30 font-mono">
                    {typeof l.details === 'object'
                      ? JSON.stringify(l.details, null, 2)
                      : String(l.details)}
                  </pre>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Clear Confirmation Dialog */}
      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('execLog.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {scope === 'current'
                ? t('execLog.confirmCurrent')
                : t('execLog.confirmAll')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setClearDialogOpen(false)}>
              {t('execLog.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleClearLogs}>
              {t('execLog.confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
