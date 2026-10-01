import {
  CartesianGrid,
  ComposedChart,
  Line,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { EvalAggregateRow, EvalCandidateRow, EvalTrialRow } from '@/lib/eval/types';
import { findAggregate } from './reportData';

export interface ParetoScatterProps {
  candidates: EvalCandidateRow[];
  aggregates: EvalAggregateRow[];
  trials: EvalTrialRow[];
  pareto: string[];
}

interface Point {
  x: number;
  y: number;
  z: number;
  label: string;
}

export function ParetoScatter({ candidates, aggregates, trials, pareto }: ParetoScatterProps) {
  const { t } = useLanguage();

  const vramPeak = (candidateId: string): number => {
    const peaks = trials
      .filter((tr) => tr.candidateId === candidateId)
      .map((tr) => tr.vramPeakMb)
      .filter((v): v is number => v !== null);
    return peaks.length > 0 ? Math.max(...peaks) : 0;
  };

  const points: Point[] = [];
  for (const c of candidates) {
    const p = findAggregate(aggregates, c.id, 'dimension', 'P')?.normalized;
    const q = findAggregate(aggregates, c.id, 'dimension', 'Q')?.normalized;
    const a = findAggregate(aggregates, c.id, 'dimension', 'A')?.normalized;
    if (p == null || q == null || a == null) continue;
    points.push({ x: p, y: (q + a) / 2, z: Math.max(40, vramPeak(c.id)), label: c.label });
  }
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const frontier: Point[] = pareto
    .map((id) => {
      const c = byId.get(id);
      if (!c) return null;
      const p = findAggregate(aggregates, id, 'dimension', 'P')?.normalized;
      const q = findAggregate(aggregates, id, 'dimension', 'Q')?.normalized;
      const a = findAggregate(aggregates, id, 'dimension', 'A')?.normalized;
      if (p == null || q == null || a == null) return null;
      return { x: p, y: (q + a) / 2, z: 0, label: c.label };
    })
    .filter((pt): pt is Point => pt !== null)
    .sort((u, v) => u.x - v.x);

  return (
    <div className="rounded-lg border border-border p-2.5">
      <ComposedChart width={420} height={280} margin={{ top: 8, right: 12, bottom: 8, left: -8 }}>
        <CartesianGrid />
        <XAxis type="number" dataKey="x" name={t('eval.report.pareto.xLabel')} tick={{ fontSize: 11 }} />
        <YAxis type="number" dataKey="y" name={t('eval.report.pareto.yLabel')} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(value, name, props) => {
            const pt = (props?.payload ?? {}) as Partial<Point>;
            return [value, pt.label ? `${pt.label} (${String(name)})` : String(name)];
          }}
        />
        <Scatter name="candidates" data={points} dataKey="y" fill="#8884d8" />
        {frontier.length > 1 && (
          <Line
            data={frontier}
            dataKey="y"
            name={t('eval.report.pareto.frontier')}
            stroke="#82ca9d"
            dot={false}
            strokeDasharray="5 5"
          />
        )}
      </ComposedChart>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {t('eval.report.pareto.xLabel')} × {t('eval.report.pareto.yLabel')} · {t('eval.report.pareto.frontier')}
      </p>
    </div>
  );
}
