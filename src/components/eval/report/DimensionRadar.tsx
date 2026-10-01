import { useState } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
} from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { EvalAggregateRow, EvalCandidateRow } from '@/lib/eval/types';
import { findAggregate } from './reportData';

const DIMS = ['Q', 'A', 'P', 'R', 'S'] as const;
const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#8dd1e1', '#a4de6c'];

export interface DimensionRadarProps {
  candidates: EvalCandidateRow[];
  aggregates: EvalAggregateRow[];
}

export function DimensionRadar({ candidates, aggregates }: DimensionRadarProps) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<string[]>(() => candidates.slice(0, 3).map((c) => c.id));

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 6) return prev;
      return [...prev, id];
    });
  };

  const data = DIMS.map((d) => {
    const row: Record<string, string | number | null> = { dim: d };
    for (const id of selected) {
      row[id] = findAggregate(aggregates, id, 'dimension', d)?.normalized ?? 0;
    }
    return row;
  });
  const byId = new Map(candidates.map((c) => [c.id, c]));

  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="mb-1 flex flex-wrap gap-1.5">
        {candidates.map((c, i) => {
          const on = selected.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground'}`}
              title={t('eval.report.radar.selectHint')}
            >
              <span
                className="mr-1 inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              {c.label}
            </button>
          );
        })}
      </div>
      <RadarChart width={360} height={260} data={data}>
        <PolarGrid />
        <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11 }} />
        {selected.map((id, i) => (
          <Radar
            key={id}
            name={byId.get(id)?.label ?? id}
            dataKey={id}
            stroke={COLORS[(candidates.findIndex((c) => c.id === id) + COLORS.length) % COLORS.length] ?? COLORS[i % COLORS.length]}
            fill={COLORS[(candidates.findIndex((c) => c.id === id) + COLORS.length) % COLORS.length] ?? COLORS[i % COLORS.length]}
            fillOpacity={0.25}
          />
        ))}
      </RadarChart>
    </div>
  );
}
