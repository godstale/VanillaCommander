import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { Agent } from '@/lib/types/agent';
import type { FallbackCandidate } from '@/lib/agent/resolveAgent';
import { cn } from '@/lib/utils';

export interface AgentFallbackDialogProps {
  open: boolean;
  candidates: FallbackCandidate[];
  failedAgentName: string;
  onPick: (agent: Agent, opts: { dontAsk: boolean; externalConfirmed: boolean }) => void;
  onCancel: () => void;
}

export function AgentFallbackDialog({
  open,
  candidates,
  failedAgentName,
  onPick,
  onCancel,
}: AgentFallbackDialogProps) {
  const { t } = useLanguage();
  const healthy = candidates.filter((c) => c.status === 'connected');
  const [selectedId, setSelectedId] = useState<string | null>(
    healthy[0]?.agent.id ?? candidates[0]?.agent.id ?? null,
  );
  const [externalConfirmed, setExternalConfirmed] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);

  const selected = candidates.find((c) => c.agent.id === selectedId) ?? null;
  const needsExternalConfirm = selected?.external === true;
  // "다시 묻지 않기"는 로컬 에이전트에만 허용한다.
  const dontAskAllowed = selected !== null && !selected.external;
  const canConfirm =
    selected !== null &&
    selected.status === 'connected' &&
    (!needsExternalConfirm || externalConfirmed);

  const confirm = () => {
    if (!selected || !canConfirm) return;
    onPick(selected.agent, { dontAsk: dontAskAllowed && dontAsk, externalConfirmed });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">{t('agentFallback.title')}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {t('agentFallback.desc', { name: failedAgentName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('agentFallback.noCandidates')}</p>
          ) : (
            candidates.map((c) => {
              const active = c.agent.id === selectedId;
              const dot =
                c.status === 'connected'
                  ? 'bg-success'
                  : c.status === 'disconnected'
                    ? 'bg-destructive'
                    : 'bg-muted-foreground/50';
              return (
                <button
                  key={c.agent.id}
                  type="button"
                  disabled={c.status !== 'connected'}
                  onClick={() => {
                    setSelectedId(c.agent.id);
                    setExternalConfirmed(false);
                    setDontAsk(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors',
                    active ? 'border-primary/60 bg-primary/5' : 'border-border/60 hover:bg-muted/40',
                    c.status !== 'connected' && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full shrink-0', dot)} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium truncate">{c.agent.name}</span>
                    <span className="block font-mono text-[10px] text-muted-foreground truncate">
                      {c.agent.model}
                    </span>
                  </span>
                  {c.external && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium shrink-0">
                      {t('agentFallback.external')}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {needsExternalConfirm && (
          <label className="flex items-start gap-2 text-xs cursor-pointer rounded-lg border border-warning/40 bg-warning/10 p-2.5">
            <input
              type="checkbox"
              checked={externalConfirmed}
              onChange={(e) => setExternalConfirmed(e.target.checked)}
              className="h-3.5 w-3.5 mt-0.5"
            />
            <span className="leading-relaxed">{t('agentFallback.externalConfirm')}</span>
          </label>
        )}

        <label
          className={cn(
            'flex items-center gap-2 text-xs',
            dontAskAllowed ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed',
          )}
          title={dontAskAllowed ? undefined : t('agentFallback.dontAskLocalOnly')}
        >
          <input
            type="checkbox"
            checked={dontAskAllowed && dontAsk}
            disabled={!dontAskAllowed}
            onChange={(e) => setDontAsk(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {t('agentFallback.dontAsk')}
        </label>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t('agentFallback.cancel')}
          </Button>
          <Button size="sm" onClick={confirm} disabled={!canConfirm}>
            {t('agentFallback.continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AgentFallbackDialog;
