import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { EvalAggregateRow, EvalCandidateRow } from '@/lib/eval/types';
import { formatScore, hasQuantData, quantMetricValue } from './reportData';

export interface QuantFidelityTableProps {
  candidates: EvalCandidateRow[];
  aggregates: EvalAggregateRow[];
}

export function QuantFidelityTable({ candidates, aggregates }: QuantFidelityTableProps) {
  const { t } = useLanguage();
  if (!hasQuantData(aggregates)) {
    return <p className="text-xs text-muted-foreground">{t('eval.report.quant.noData')}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[480px] border-collapse text-xs">
        <thead>
          <tr className="bg-muted/50 text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">{t('eval.report.rank.candidate')}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t('eval.report.quant.meanKld')}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t('eval.report.quant.top1')}</th>
            <th className="px-2 py-1.5 text-right font-medium">{t('eval.report.quant.divPos')}</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="px-2 py-1.5 font-medium text-foreground">{c.label}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {formatScore(quantMetricValue(aggregates, c.id, 'mean_kld'), 3)}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {formatScore(quantMetricValue(aggregates, c.id, 'top1_agreement'), 3)}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {formatScore(quantMetricValue(aggregates, c.id, 'divergence_pos_median'), 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
