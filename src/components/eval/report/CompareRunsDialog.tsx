import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { listAggregates, listCandidates, listRuns } from '@/lib/db/repositories/evalRepo';
import type { EvalAggregateRow, EvalCandidateRow, EvalRunRow } from '@/lib/eval/types';
import { findAggregate, formatScore } from './reportData';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface CompareRunsDialogProps {
  open: boolean;
  currentRunId: string;
  currentAggregates: EvalAggregateRow[];
  currentCandidates: EvalCandidateRow[];
  onClose: () => void;
}

export function CompareRunsDialog({
  open,
  currentRunId,
  currentAggregates,
  currentCandidates,
  onClose,
}: CompareRunsDialogProps) {
  const { t } = useLanguage();
  const [runs, setRuns] = useState<EvalRunRow[]>([]);
  const [otherId, setOtherId] = useState<string | null>(null);
  const [otherAggregates, setOtherAggregates] = useState<EvalAggregateRow[]>([]);
  const [otherCandidates, setOtherCandidates] = useState<EvalCandidateRow[]>([]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      try {
        const all = await listRuns();
        if (!active) return;
        setRuns(all.filter((r) => r.id !== currentRunId));
      } catch (err) {
        console.error('Failed to list runs for comparison:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, currentRunId]);

  useEffect(() => {
    if (!open || !otherId) return;
    let active = true;
    void (async () => {
      try {
        const [aggs, cands] = await Promise.all([listAggregates(otherId), listCandidates(otherId)]);
        if (!active) return;
        setOtherAggregates(aggs);
        setOtherCandidates(cands);
      } catch (err) {
        console.error('Failed to load comparison run:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, otherId]);

  const compositeOf = (aggs: EvalAggregateRow[], id: string): number | null =>
    findAggregate(aggs, id, 'composite', 'composite')?.normalized ?? null;

  const otherRun = runs.find((r) => r.id === otherId) ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{t('eval.report.compare.title')}</DialogTitle>
        </DialogHeader>
        {runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('eval.report.compare.noRuns')}</p>
        ) : (
          <div className="space-y-2 text-xs">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">{t('eval.report.compare.pick')}</span>
              <select
                value={otherId ?? ''}
                onChange={(e) => setOtherId(e.target.value || null)}
                className="rounded border border-border bg-background px-1.5 py-1"
              >
                <option value="">-</option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} ({r.status})</option>
                ))}
              </select>
            </label>
            {otherRun && (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-muted/50 text-left text-muted-foreground">
                    <th className="px-2 py-1 font-medium">{t('eval.report.rank.candidate')}</th>
                    <th className="px-2 py-1 text-right font-medium">{t('eval.report.compare.current')}</th>
                    <th className="px-2 py-1 text-right font-medium">
                      {t('eval.report.compare.other')}: {otherRun.name}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {currentCandidates.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-2 py-1 font-medium">{c.label}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatScore(compositeOf(currentAggregates, c.id))}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {(() => {
                          const match = otherCandidates.find((o) => o.label === c.label);
                          return match ? formatScore(compositeOf(otherAggregates, match.id)) : '-';
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="outline" onClick={onClose}>
                {t('eval.report.compare.close')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
