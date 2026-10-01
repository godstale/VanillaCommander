import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { AlertCircle, Check, Copy } from 'lucide-react';
import { parseAndNormalizeChartDsl, type ChartDsl } from '../../lib/types/chartDsl';

interface RechartsViewerProps {
  code: string;
  initialParsed?: unknown;
}

const DEFAULT_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--destructive))',
  'hsl(var(--subtle-foreground))',
];

export const RechartsViewer: React.FC<RechartsViewerProps> = ({ code, initialParsed }) => {
  const [copied, setCopied] = useState(false);

  const { chartData, error } = useMemo<{ chartData: ChartDsl | null; error: string | null }>(() => {
    try {
      const target = initialParsed !== undefined ? initialParsed : code;
      const validated = parseAndNormalizeChartDsl(target);
      return { chartData: validated, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { chartData: null, error: message };
    }
  }, [code, initialParsed]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard error
    }
  };

  if (error || !chartData) {
    return (
      <div className="my-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-destructive mb-2">
          <AlertCircle className="w-4 h-4" />
          <span>Invalid Recharts JSON DSL</span>
        </div>
        <div className="text-muted-foreground mb-2 text-[11px] font-mono break-words">{error}</div>
        <div className="relative">
          <button
            type="button"
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1 rounded bg-background/80 hover:bg-background text-muted-foreground hover:text-foreground transition-colors"
            title="Copy code"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <pre className="overflow-x-auto rounded bg-background/50 p-2 font-mono text-[11px] text-foreground">
            <code>{code}</code>
          </pre>
        </div>
      </div>
    );
  }

  const { type, data, xKey, series, title } = chartData;

  const renderChart = () => {
    switch (type) {
      case 'bar':
        return (
          <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            {xKey && <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />}
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '12px' }} />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            {series.map((s, idx) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label || s.key}
                fill={s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        );

      case 'line':
        return (
          <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            {xKey && <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />}
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '12px' }} />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            {series.map((s, idx) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label || s.key}
                stroke={s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            ))}
          </LineChart>
        );

      case 'area':
        return (
          <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            {xKey && <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />}
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '12px' }} />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            {series.map((s, idx) => {
              const color = s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
              return (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label || s.key}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.25}
                  strokeWidth={2}
                />
              );
            })}
          </AreaChart>
        );

      case 'pie': {
        const valueKey = series[0]?.key;
        const nameKey = xKey || 'name';
        return (
          <PieChart margin={{ top: 10, right: 20, left: 20, bottom: 10 }}>
            <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '12px' }} />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            {valueKey && (
              <Pie
                data={data}
                dataKey={valueKey}
                nameKey={nameKey}
                cx="50%"
                cy="50%"
                outerRadius={80}
                label
              >
                {data.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
                  />
                ))}
              </Pie>
            )}
          </PieChart>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="relative my-3 rounded-lg border border-border bg-card p-4 overflow-x-auto shadow-sm">
      <div className="flex items-center justify-between mb-3">
        {title ? (
          <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        ) : (
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-mono">
            {type} chart
          </span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="p-1.5 rounded bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Copy chart JSON"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="w-full h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart() || <div />}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
