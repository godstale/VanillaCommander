import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { cn } from '@/lib/utils';
import type {
  EvalCandidateRow,
  EvalScoreRow,
  EvalTrialRow,
} from '@/lib/eval/types';
import { FieldInfo } from '../wizard/FieldInfo';

export interface LiveCell {
  candidateId: string;
  packId: string;
}

interface CandidatePackMatrixProps {
  candidates: EvalCandidateRow[];
  packIds: string[];
  trials: EvalTrialRow[];
  scores: EvalScoreRow[];
  expectedPerCell: Record<string, number>;
  liveCell: LiveCell | null;
  packTitles?: Record<string, string>;
  packHelps?: Record<string, string>;
  /** Trial IDs whose deferred (Judge / code-exec / human) scores are still missing. */
  pendingTrialIds?: ReadonlySet<string>;
}

interface CellData {
  done: number;
  total: number;
  pct: number;
  accuracy: number | null;
  pending: number;
}

function cellKey(candidateId: string, packId: string): string {
  return `${candidateId}|${packId}`;
}

export function CandidatePackMatrix({
  candidates,
  packIds,
  trials,
  scores,
  expectedPerCell,
  liveCell,
  packTitles,
  packHelps,
  pendingTrialIds,
}: CandidatePackMatrixProps) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<LiveCell | null>(liveCell);

  const active = useMemo(() => {
    const valid =
      selected != null &&
      candidates.some((c) => c.id === selected.candidateId) &&
      packIds.includes(selected.packId);
    if (valid) return selected;
    if (liveCell) return liveCell;
    if (candidates.length > 0 && packIds.length > 0) {
      return { candidateId: candidates[0].id, packId: packIds[0] };
    }
    return null;
  }, [selected, candidates, packIds, liveCell]);

  const valuesByTrial = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const s of scores) {
      const list = m.get(s.trialId) ?? [];
      list.push(s.value);
      m.set(s.trialId, list);
    }
    return m;
  }, [scores]);

  const trialsByCell = useMemo(() => {
    const m = new Map<string, EvalTrialRow[]>();
    for (const tr of trials) {
      const key = cellKey(tr.candidateId, tr.packId);
      const list = m.get(key) ?? [];
      list.push(tr);
      m.set(key, list);
    }
    return m;
  }, [trials]);

  const cells = useMemo(() => {
    const out = new Map<string, CellData>();
    for (const c of candidates) {
      for (const packId of packIds) {
        const key = cellKey(c.id, packId);
        const cellTrials = trialsByCell.get(key) ?? [];
        const done = cellTrials.length;
        const total = expectedPerCell[key] ?? done;
        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        const values: number[] = [];
        let pending = 0;
        for (const tr of cellTrials) {
          const v = valuesByTrial.get(tr.id);
          if (v) values.push(...v);
          if (pendingTrialIds?.has(tr.id)) pending += 1;
        }
        const accuracy =
          values.length > 0
            ? values.reduce((a, b) => a + b, 0) / values.length
            : null;
        out.set(key, { done, total, pct, accuracy, pending });
      }
    }
    return out;
  }, [candidates, packIds, trialsByCell, valuesByTrial, expectedPerCell, pendingTrialIds]);

  const detail = useMemo(() => {
    if (!active) return null;
    const key = cellKey(active.candidateId, active.packId);
    const cellTrials = [...(trialsByCell.get(key) ?? [])].sort((a, b) =>
      a.startedAt < b.startedAt ? -1 : 1,
    );
    const outcomes = new Map<string, number>();
    for (const tr of cellTrials) {
      outcomes.set(tr.outcome, (outcomes.get(tr.outcome) ?? 0) + 1);
    }
    const values: number[] = [];
    let pending = 0;
    for (const tr of cellTrials) {
      const v = valuesByTrial.get(tr.id);
      if (v) values.push(...v);
      if (pendingTrialIds?.has(tr.id)) pending += 1;
    }
    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
    return { cellTrials, outcomes, scoreCount: values.length, avg, pending };
  }, [active, trialsByCell, valuesByTrial, pendingTrialIds]);

  if (candidates.length === 0 || packIds.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('eval.progress.matrix.empty')}
      </p>
    );
  }

  const activeCandidate = active ? candidates.find((c) => c.id === active.candidateId) : null;
  const activePackLabel = active ? (packTitles?.[active.packId] ?? active.packId) : null;

  return (
    <div className="space-y-3">
      {candidates.map((c) => (
        <div key={c.id} className="space-y-1.5">
          <div
            className="max-w-full truncate text-[11px] font-semibold text-foreground"
            title={c.label}
          >
            {c.label}
          </div>
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
            {packIds.map((packId) => {
              const key = cellKey(c.id, packId);
              const cell = cells.get(key) ?? { done: 0, total: 0, pct: 0, accuracy: null, pending: 0 };
              const live =
                liveCell?.candidateId === c.id && liveCell?.packId === packId;
              const isSelected =
                active?.candidateId === c.id && active?.packId === packId;
              const packLabel = packTitles?.[packId] ?? packId;
              const packHelp = packHelps?.[packId];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected({ candidateId: c.id, packId })}
                  aria-pressed={isSelected}
                  aria-label={live ? t('eval.progress.matrix.live') : `${c.label} ${packLabel}`}
                  className={cn(
                    'min-h-20 rounded-md border border-border/60 bg-card/40 p-2 text-left transition-colors hover:border-primary/50',
                    live && 'border-primary/60 bg-primary/5 ring-1 ring-primary/40',
                    isSelected && 'border-primary ring-1 ring-primary/60',
                  )}
                >
                  <div className="flex items-center justify-between gap-1 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="truncate font-medium text-foreground" title={packLabel}>
                        {packLabel}
                      </span>
                      <FieldInfo
                        label={packLabel}
                        help={packHelp ?? t('eval.progress.matrix.cellHelp')}
                      />
                    </span>
                    {live && (
                      <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-px font-medium text-primary">
                        {t('eval.progress.matrix.live')}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {t('eval.progress.matrix.progress')} {cell.done}/{cell.total}
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        live ? 'bg-primary' : 'bg-muted-foreground/50',
                      )}
                      style={{ width: `${cell.pct}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {t('eval.progress.matrix.accuracy')}{' '}
                    <span className="font-mono font-medium text-foreground">
                      {cell.accuracy != null
                        ? `${(cell.accuracy * 100).toFixed(1)}%`
                        : t('eval.progress.matrix.noScore')}
                    </span>
                    {cell.pending > 0 && (
                      <span className="ml-1 rounded-full bg-warning/15 px-1.5 py-px font-medium text-warning">
                        {t('eval.progress.matrix.pendingFinal', { n: cell.pending })}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="rounded-md border border-border/60 bg-card/30 p-2.5 text-xs">
        {!active || !detail ? (
          <p className="text-muted-foreground">{t('eval.progress.matrix.detailHint')}</p>
        ) : detail.cellTrials.length === 0 ? (
          <div className="space-y-1">
            <p className="font-semibold text-foreground">
              {activeCandidate?.label} · {activePackLabel}
            </p>
            <p className="text-muted-foreground">{t('eval.progress.matrix.noTrials')}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="font-semibold text-foreground">
              {activeCandidate?.label} · {activePackLabel}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {t('eval.progress.matrix.detailTrials', { n: detail.cellTrials.length })}
              {detail.avg != null && (
                <> · {t('eval.progress.matrix.detailScores', { n: detail.scoreCount, avg: `${(detail.avg * 100).toFixed(1)}%` })}</>
              )}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {t('eval.progress.matrix.detailOutcomes')}:{' '}
              {[...detail.outcomes.entries()]
                .map(([outcome, n]) => `${outcome} ${n}`)
                .join(' · ')}
            </p>
            {detail.pending > 0 && (
              <p className="text-[11px] text-warning">
                {t('eval.progress.matrix.pendingHint')}
              </p>
            )}
            <ul className="max-h-36 space-y-1 overflow-y-auto">
              {detail.cellTrials.slice(-20).map((tr) => {
                const v = valuesByTrial.get(tr.id);
                const avgV = v && v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
                const pending = pendingTrialIds?.has(tr.id) ?? false;
                return (
                  <li
                    key={tr.id}
                    className="flex items-center justify-between gap-2 rounded border border-border/40 px-2 py-1 font-mono text-[11px]"
                  >
                    <span className="truncate">
                      {tr.sampleId} · e{tr.epoch} · {tr.outcome}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                      {pending && (
                        <span className="rounded-full bg-warning/15 px-1.5 py-px font-medium text-warning">
                          {avgV != null
                            ? t('eval.progress.matrix.rowPartial')
                            : t('eval.progress.matrix.rowPending')}
                        </span>
                      )}
                      {avgV != null ? `${(avgV * 100).toFixed(0)}%` : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
