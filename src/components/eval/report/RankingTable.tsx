import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { EvalAggregateRow, EvalCandidateRow } from '@/lib/eval/types';
import type { ConstraintViolation } from '@/lib/eval/scoring/recommend';
import {
  dimensionCoverage,
  displayValue,
  findAggregate,
  formatScore,
} from './reportData';
import { cn } from '@/lib/utils';

const DIMS = ['Q', 'A', 'P', 'R', 'S'] as const;

export interface RankingTableProps {
  candidates: EvalCandidateRow[];
  aggregates: EvalAggregateRow[];
  /** Connected components of indistinguishable candidates, ordered by composite. */
  groups: string[][];
  violations: Record<string, ConstraintViolation[]>;
  mode: 'raw' | 'normalized';
}

/** Rank index of a candidate inside its tie group (0-based); -1 when grouped alone. */
function groupRank(groups: string[][], candidateId: string): number {
  for (const g of groups) {
    if (g.length > 1 && g.includes(candidateId)) return g.indexOf(candidateId);
  }
  return -1;
}

export function RankingTable({ candidates, aggregates, groups, violations, mode }: RankingTableProps) {
  const { t } = useLanguage();

  const rows = [...candidates].sort((a, b) => {
    const ca = findAggregate(aggregates, a.id, 'composite', 'composite');
    const cb = findAggregate(aggregates, b.id, 'composite', 'composite');
    return (cb?.normalized ?? Number.NEGATIVE_INFINITY) - (ca?.normalized ?? Number.NEGATIVE_INFINITY);
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] border-collapse text-xs">
        <thead>
          <tr className="bg-muted/50 text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">{t('eval.report.rank.candidate')}</th>
            <th className="px-2 py-1.5 font-medium">{t('eval.report.rank.composite')}</th>
            {DIMS.map((d) => (
              <th key={d} className="px-2 py-1.5 text-right font-medium">{d}</th>
            ))}
            <th className="px-2 py-1.5 text-right font-medium">{t('eval.report.rank.coverage')}</th>
            <th className="px-2 py-1.5 font-medium">{t('eval.report.rank.constraints')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const comp = findAggregate(aggregates, c.id, 'composite', 'composite');
            const cv = displayValue(comp, mode);
            const ci =
              comp?.ciLow !== null && comp?.ciLow !== undefined && comp?.ciHigh !== null && comp?.ciHigh !== undefined
                ? ` ±[${formatScore(comp.ciLow)}–${formatScore(comp.ciHigh)}]`
                : '';
            const tied = groupRank(groups, c.id) >= 0;
            const viols = violations[c.id] ?? [];
            return (
              <tr
                key={c.id}
                className={cn('border-t border-border', tied && 'bg-primary/5')}
              >
                <td className="px-2 py-1.5 font-medium text-foreground">
                  {c.label}
                  {tied && (
                    <span
                      className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-px text-[10px] text-primary"
                      title={t('eval.report.rank.tie')}
                    >
                      =
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 tabular-nums">
                  {formatScore(cv)}
                  <span className="text-muted-foreground">{ci}</span>
                </td>
                {DIMS.map((d) => (
                  <td key={d} className="px-2 py-1.5 text-right tabular-nums">
                    {formatScore(displayValue(findAggregate(aggregates, c.id, 'dimension', d), mode))}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {Math.round(dimensionCoverage(aggregates, c.id) * 100)}%
                </td>
                <td className="px-2 py-1.5">
                  {viols.length === 0 ? (
                    <span className="rounded-full bg-success/15 px-1.5 py-px text-[10px] text-success">
                      {t('eval.report.rank.ok')}
                    </span>
                  ) : (
                    <span
                      className="rounded-full bg-destructive/15 px-1.5 py-px text-[10px] text-destructive"
                      title={viols.map((v) => `${v.metric} ${v.op} ${v.value} (actual ${v.actual ?? 'n/a'})`).join('\n')}
                    >
                      {t('eval.report.rank.violations', { count: viols.length })}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
