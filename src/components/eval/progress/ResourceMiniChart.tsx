import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface ResourcePoint {
  t: number;
  decodeTps: number | null;
  vramUsedMb: number | null;
  gpuUtilPct: number | null;
}

export const RESOURCE_WINDOW_MS = 120_000;

const CHART_COLORS = {
  decode: 'hsl(var(--chart-5))',
  vram: 'hsl(var(--chart-2))',
  gpu: 'hsl(var(--chart-3))',
} as const;

function formatClock(t: number): string {
  return new Date(t).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ResourceMiniChart({
  points,
  now,
}: {
  points: ResourcePoint[];
  now: number;
}) {
  const { t } = useLanguage();

  const windowed = useMemo(() => {
    const cutoff = now - RESOURCE_WINDOW_MS;
    return points
      .filter((p) => p.t >= cutoff)
      .map((p) => ({ ...p, time: formatClock(p.t) }));
  }, [points, now]);

  if (windowed.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('eval.progress.resources.empty')}
      </p>
    );
  }

  const decodeLabel = t('eval.progress.resources.decode');
  const vramLabel = t('eval.progress.resources.vram');
  const gpuLabel = t('eval.progress.resources.gpu');

  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={windowed} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={40} />
          <YAxis yAxisId="left" tick={{ fontSize: 10 }} width={44} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} width={52} />
          <Tooltip
            contentStyle={{ fontSize: 11 }}
            labelStyle={{ fontSize: 11 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="decodeTps"
            name={decodeLabel}
            stroke={CHART_COLORS.decode}
            fill={CHART_COLORS.decode}
            fillOpacity={0.2}
            connectNulls
            dot={false}
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="gpuUtilPct"
            name={gpuLabel}
            stroke={CHART_COLORS.gpu}
            fill={CHART_COLORS.gpu}
            fillOpacity={0.2}
            connectNulls
            dot={false}
          />
          <Area
            yAxisId="right"
            type="monotone"
            dataKey="vramUsedMb"
            name={vramLabel}
            stroke={CHART_COLORS.vram}
            fill={CHART_COLORS.vram}
            fillOpacity={0.2}
            connectNulls
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
