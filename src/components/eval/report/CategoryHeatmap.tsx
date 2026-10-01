import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { EvalAggregateRow, EvalCandidateRow } from '@/lib/eval/types';
import { findAggregate, formatScore } from './reportData';

export interface CategoryHeatmapProps {
  candidates: EvalCandidateRow[];
  aggregates: EvalAggregateRow[];
  mode: 'raw' | 'normalized';
}

export function CategoryHeatmap({ candidates, aggregates, mode }: CategoryHeatmapProps) {
  const { t } = useLanguage();
  const cats = [...new Set(aggregates.filter((r) => r.level === 'category').map((r) => r.key))].sort();
  if (cats.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('eval.report.heatmap.noData')}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[480px] border-collapse text-xs">
        <thead>
          <tr className="bg-muted/50 text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">{t('eval.report.rank.candidate')}</th>
            {cats.map((c) => (
              <th key={c} className="px-2 py-1.5 text-right font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidates.map((cand) => (
            <tr key={cand.id} className="border-t border-border">
              <td className="px-2 py-1.5 font-medium text-foreground">{cand.label}</td>
              {cats.map((cat) => {
                const row = findAggregate(aggregates, cand.id, 'category', cat);
                const v = mode === 'raw' ? (row?.raw ?? row?.normalized ?? null) : (row?.normalized ?? row?.raw ?? null);
                const alpha = v !== null && Number.isFinite(v) ? 0.08 + (Math.max(0, Math.min(100, v)) / 100) * 0.5 : 0;
                return (
                  <td
                    key={cat}
                    className="px-2 py-1.5 text-right tabular-nums"
                    style={alpha > 0 ? { backgroundColor: `rgba(130, 202, 157, ${alpha.toFixed(2)})` } : undefined}
                    title={`${cat}: ${v ?? '-'}`}
                  >
                    {formatScore(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
