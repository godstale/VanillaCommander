import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, Coins, Cpu, Server, Zap } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { cn } from '@/lib/utils';
import { getModelArchitectureInfo } from '@/lib/llm/ollamaClient';
import type { OllamaModelArchitectureInfo } from '@/lib/types/monitoring';
import type {
  EvalCandidateRow,
  EvalRunConfig,
  EvalScoreRow,
  EvalTrialRow,
  HardwareFingerprint,
} from '@/lib/eval/types';
import { formatScore } from '../report/reportData';
import { FieldInfo } from '../wizard/FieldInfo';

function mean(xs: Array<number | null | undefined>): number | null {
  const vals = xs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function sum(xs: Array<number | null | undefined>): number {
  let total = 0;
  for (const v of xs) {
    if (typeof v === 'number' && Number.isFinite(v)) total += v;
  }
  return total;
}

function max(xs: Array<number | null | undefined>): number | null {
  const vals = xs.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (vals.length === 0) return null;
  return Math.max(...vals);
}

function fmtPct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}

function fmtInt(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v).toLocaleString() : '—';
}

function fmtMs(v: number | null): string {
  return v == null ? '—' : `${Math.round(v)} ms`;
}

function fmtTps(v: number | null): string {
  return v == null ? '—' : `${v.toFixed(1)} t/s`;
}

function formatTimeOfDay(value: string, locale: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleTimeString(locale === 'ko' ? 'ko-KR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function MiniCard({
  icon,
  title,
  aside,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-3 rounded-xl border border-border/60 bg-card/20 p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h3 className="truncate text-xs font-semibold text-foreground">{title}</h3>
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** Fetched /api/show details, shared across mounts so re-polls don't refetch. */
const archCache = new Map<string, OllamaModelArchitectureInfo | null>();

interface ArchTarget {
  baseUrl: string;
  model: string;
  ids: string[];
}

/** Best-effort architecture lookup for ollama candidates (others stay '—'). */
function useArchInfo(candidates: EvalCandidateRow[]): Record<string, OllamaModelArchitectureInfo | null> {
  const [info, setInfo] = useState<Record<string, OllamaModelArchitectureInfo | null>>({});
  const targetSig = useMemo(() => {
    const grouped = new Map<string, ArchTarget>();
    for (const c of candidates) {
      const snap = c.snapshot;
      if (!snap || snap.provider !== 'ollama' || !snap.model) continue;
      const key = `${snap.baseUrl}\n${snap.model}`;
      const g = grouped.get(key) ?? { baseUrl: snap.baseUrl, model: snap.model, ids: [] };
      g.ids.push(c.id);
      grouped.set(key, g);
    }
    return JSON.stringify([...grouped.entries()]);
  }, [candidates]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const entries = JSON.parse(targetSig) as Array<[string, ArchTarget]>;
      await Promise.all(
        entries.map(async ([key, g]) => {
          if (!archCache.has(key)) {
            try {
              archCache.set(key, await getModelArchitectureInfo(g.baseUrl, g.model));
            } catch {
              archCache.set(key, null);
            }
          }
        }),
      );
      if (!alive) return;
      const out: Record<string, OllamaModelArchitectureInfo | null> = {};
      for (const [key, g] of entries) {
        for (const id of g.ids) out[id] = archCache.get(key) ?? null;
      }
      setInfo(out);
    })();
    return () => {
      alive = false;
    };
  }, [targetSig]);

  return info;
}

export function CandidateResults({
  candidates,
  trials,
  scores,
  config,
  composites,
  hardware,
  pendingTrialIds,
}: {
  candidates: EvalCandidateRow[];
  trials: EvalTrialRow[];
  scores: EvalScoreRow[];
  config: EvalRunConfig;
  composites: Record<string, number>;
  hardware: HardwareFingerprint;
  pendingTrialIds: ReadonlySet<string>;
}) {
  const { t, locale } = useLanguage();

  const valuesByTrial = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const s of scores) {
      const list = m.get(s.trialId) ?? [];
      list.push(s.value);
      m.set(s.trialId, list);
    }
    return m;
  }, [scores]);

  const expectedPerCandidate = useMemo(() => {
    let per = 0;
    for (const p of config.packs) per += p.sampleIds.length * p.epochs;
    return per;
  }, [config]);

  const archInfo = useArchInfo(candidates);

  if (candidates.length === 0) return null;

  // Per-candidate monitoring block. Inner rows mirror AgentMonitorTab:
  // row 1 = 3 columns (offload / memory / trend), row 2 = 2 columns
  // (tokens / architecture), so no half-empty gutter remains.
  return (
    <div className="space-y-3">
      {candidates.map((c) => {
        const cellTrials = trials.filter((tr) => tr.candidateId === c.id);
        const values: number[] = [];
        for (const tr of cellTrials) {
          const v = valuesByTrial.get(tr.id);
          if (v) values.push(...v);
        }
        const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
        const outcomes = new Map<string, number>();
        for (const tr of cellTrials) outcomes.set(tr.outcome, (outcomes.get(tr.outcome) ?? 0) + 1);
        const pct =
          expectedPerCandidate > 0
            ? Math.min(100, Math.round((cellTrials.length / expectedPerCandidate) * 100))
            : 0;
        const composite = composites[c.id] ?? null;
        const pendingCount = cellTrials.filter((tr) => pendingTrialIds.has(tr.id)).length;

        const offload = mean(cellTrials.map((tr) => tr.offloadRatio));
        const offloadPct = offload != null ? Math.round(offload * 100) : null;
        const vramPeak = max(cellTrials.map((tr) => tr.vramPeakMb));
        const vramTotal = hardware.vramTotalMb > 0 ? hardware.vramTotalMb : null;
        const vramFreeMb =
          vramPeak != null && vramTotal != null ? Math.max(0, vramTotal - vramPeak) : null;

        const usedKey = t('eval.progress.results.memUsed');
        const freeKey = t('monitor.freeSpace');
        const totalKey = t('eval.progress.results.memTotal');
        const memoryBreakdownData: Array<Record<string, string | number>> = [];
        if (vramTotal != null) {
          memoryBreakdownData.push({
            name: t('monitor.vramDistShort'),
            [usedKey]: vramPeak != null ? Number((vramPeak / 1024).toFixed(2)) : 0,
            [freeKey]: vramFreeMb != null ? Number((vramFreeMb / 1024).toFixed(2)) : 0,
          });
        }
        if (hardware.ramTotalMb > 0) {
          memoryBreakdownData.push({
            name: t('monitor.ramDistShort'),
            [totalKey]: Number((hardware.ramTotalMb / 1024).toFixed(2)),
          });
        }

        const trendPoints = [...cellTrials]
          .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
          .map((tr) => ({
            time: formatTimeOfDay(tr.startedAt, locale),
            vramUsedGb: tr.vramPeakMb != null ? Number((tr.vramPeakMb / 1024).toFixed(2)) : null,
            gpuUtilization: tr.gpuUtilAvg != null ? Math.round(tr.gpuUtilAvg) : null,
          }));
        const hasTrend = trendPoints.some((p) => p.vramUsedGb != null || p.gpuUtilization != null);

        const inSum = sum(cellTrials.map((tr) => tr.inputTokens));
        const outSum = sum(cellTrials.map((tr) => tr.outputTokens));
        const thinkSum = sum(cellTrials.map((tr) => tr.thinkingTokens));
        const ttft = mean(cellTrials.map((tr) => tr.ttftMs));
        const decode = mean(cellTrials.map((tr) => tr.decodeTps));
        const sources = new Map<string, number>();
        for (const tr of cellTrials) {
          if (tr.timingSource) sources.set(tr.timingSource, (sources.get(tr.timingSource) ?? 0) + 1);
        }
        const turnSum = sum(cellTrials.map((tr) => tr.turns));
        const toolSum = sum(cellTrials.map((tr) => tr.toolCalls));
        const totalSum = inSum + outSum + thinkSum;
        const recentTrials = [...cellTrials]
          .sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1))
          .slice(0, 5);

        const snap = c.snapshot;
        const arch = archInfo[c.id] ?? null;
        return (
          <div
            key={c.id}
            className="space-y-2 rounded-md border border-border/60 bg-card/30 p-2.5 text-xs"
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="min-w-0 truncate font-semibold text-foreground" title={c.label}>
                {c.label}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                <FieldInfo
                  label={c.label}
                  help={t('eval.progress.results.help')}
                />
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px font-medium',
                    c.status === 'done' && 'bg-success/15 text-success',
                    c.status === 'failed' && 'bg-destructive/15 text-destructive',
                    c.status === 'skipped' && 'bg-warning/15 text-warning',
                    (c.status === 'running' || c.status === 'pending') && 'bg-primary/15 text-primary',
                  )}
                >
                  {c.status}
                </span>
              </span>
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {cellTrials.length}/{expectedPerCandidate} · {pct}% · {fmtPct(avg)}
              {composite != null && (
                <span className="text-foreground"> · {t('eval.progress.results.composite')} {formatScore(composite)}</span>
              )}
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-muted-foreground/50" style={{ width: `${pct}%` }} />
            </div>
            <div className="space-y-0.5 text-[11px] text-muted-foreground">
              <div>
                {t('eval.progress.results.outcomes')}:{' '}
                {outcomes.size > 0
                  ? [...outcomes.entries()].map(([o, n]) => `${o} ${n}`).join(' · ')
                  : t('eval.progress.results.noData')}
              </div>
              {pendingCount > 0 && (
                <div className="font-medium text-warning">
                  {t('eval.progress.results.pendingNote', { n: pendingCount })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <MiniCard
                icon={<Zap className="h-4 w-4 shrink-0 text-warning" />}
                title={t('monitor.sysResources')}
                aside={
                  <span
                    className="max-w-[160px] truncate text-right font-mono text-[11px] text-muted-foreground"
                    title={hardware.gpuName}
                  >
                    {hardware.gpuName}
                  </span>
                }
              >
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">{t('monitor.offloadRatio')}</span>
                    <span className="font-mono font-bold text-warning">
                      {offloadPct != null ? `${offloadPct}%` : '0%'}
                    </span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-warning"
                      style={{ width: `${offloadPct ?? 0}%` }}
                      title={t('monitor.gpuOffload')}
                    />
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${100 - (offloadPct ?? 0)}%` }}
                      title={t('monitor.cpuCompute')}
                    />
                  </div>
                  <div className="flex justify-between pt-0.5 text-[10px] text-muted-foreground">
                    <span>{t('monitor.gpuAccel', { v: offloadPct ?? 0 })}</span>
                    <span>{t('monitor.cpuShare', { v: 100 - (offloadPct ?? 0) })}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/40 p-2.5 font-mono">
                  <span className="shrink-0 font-sans text-[11px] text-muted-foreground">
                    {t('monitor.vramState')}
                  </span>
                  <span className="whitespace-nowrap text-right text-[11px] font-semibold text-foreground">
                    {vramTotal != null
                      ? t('monitor.gbFree', {
                        total: (vramTotal / 1024).toFixed(1),
                        free: vramFreeMb != null ? (vramFreeMb / 1024).toFixed(1) : '—',
                      })
                      : 'N/A'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/40 p-2.5 font-mono">
                  <span className="shrink-0 font-sans text-[11px] text-muted-foreground">
                    {t('monitor.hostRam')}
                  </span>
                  <span className="whitespace-nowrap text-right text-[11px] font-semibold text-foreground">
                    {hardware.ramTotalMb > 0 ? `${(hardware.ramTotalMb / 1024).toFixed(1)} GB` : 'N/A'}
                  </span>
                </div>
              </MiniCard>

              <MiniCard
                icon={<Cpu className="h-4 w-4 shrink-0 text-tertiary" />}
                title={t('monitor.memDist')}
                aside={
                  <span className="font-mono text-[10px] text-muted-foreground">{t('monitor.unitGb')}</span>
                }
              >
                <div className="h-48 w-full">
                  {memoryBreakdownData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      {t('monitor.aggregating')}
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={memoryBreakdownData} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} unit=" GB" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--popover))',
                            color: 'hsl(var(--popover-foreground))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            fontSize: '11px',
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '10px' }} />
                        <Bar dataKey={usedKey} stackId="a" fill="hsl(var(--chart-2))" unit=" GB" isAnimationActive={false} />
                        <Bar dataKey={freeKey} stackId="a" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} unit=" GB" isAnimationActive={false} />
                        <Bar dataKey={totalKey} stackId="b" fill="hsl(var(--chart-5))" radius={[4, 4, 0, 0]} unit=" GB" isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </MiniCard>

              <MiniCard
                icon={<Activity className="h-4 w-4 shrink-0 text-success" />}
                title={t('monitor.realtimeGpu', { n: trendPoints.length })}
                aside={
                  <div className="flex items-center gap-4 font-mono text-[11px]">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span
                        className="h-2.5 w-2.5 rounded-full shadow-sm"
                        style={{ backgroundColor: 'hsl(var(--chart-3))' }}
                      />
                      <span className="font-medium text-success">{t('monitor.gpuShareUnit')}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span
                        className="h-2.5 w-2.5 rounded-full shadow-sm"
                        style={{ backgroundColor: 'hsl(var(--chart-2))' }}
                      />
                      <span className="font-medium text-tertiary">{t('monitor.vramUsage')}</span>
                    </span>
                  </div>
                }
              >
                <div className="h-48 w-full">
                  {hasTrend ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendPoints} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                        <YAxis
                          yAxisId="left"
                          orientation="left"
                          domain={[0, 100]}
                          stroke="hsl(var(--chart-3))"
                          tick={{ fontSize: 10 }}
                          unit="%"
                          width={38}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          stroke="hsl(var(--chart-2))"
                          tick={{ fontSize: 10 }}
                          unit=" GB"
                          width={44}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--popover))',
                            color: 'hsl(var(--popover-foreground))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            fontSize: '11px',
                          }}
                        />
                        <Area
                          yAxisId="left"
                          type="monotone"
                          dataKey="gpuUtilization"
                          name={t('monitor.gpuShare')}
                          stroke="hsl(var(--chart-3))"
                          fill="hsl(var(--chart-3))"
                          fillOpacity={0.2}
                          connectNulls
                          isAnimationActive={false}
                        />
                        <Area
                          yAxisId="right"
                          type="monotone"
                          dataKey="vramUsedGb"
                          name={t('monitor.vramUsageShort')}
                          stroke="hsl(var(--chart-2))"
                          fill="hsl(var(--chart-2))"
                          fillOpacity={0.18}
                          unit=" GB"
                          connectNulls
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      {t('eval.progress.results.trendEmpty')}
                    </div>
                  )}
                </div>
              </MiniCard>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <MiniCard
                icon={<Coins className="h-4 w-4 shrink-0 text-warning" />}
                title={t('monitor.tokenInfo')}
                aside={
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {t('eval.progress.matrix.detailTrials', { n: cellTrials.length })}
                  </span>
                }
              >
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  <div className="rounded-md border border-border/50 bg-muted/40 p-1.5">
                    <div className="font-sans text-[10px] text-muted-foreground">{t('monitor.inputTok')}</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-warning">{fmtInt(inSum)}</div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/40 p-1.5">
                    <div className="font-sans text-[10px] text-muted-foreground">{t('monitor.outputTok')}</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-primary">{fmtInt(outSum)}</div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/40 p-1.5">
                    <div className="font-sans text-[10px] text-muted-foreground">{t('monitor.thinkTok')}</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-chart-1">{fmtInt(thinkSum)}</div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/40 p-1.5">
                    <div className="font-sans text-[10px] text-muted-foreground">{t('monitor.totalTok')}</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-foreground">{fmtInt(totalSum)}</div>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t('eval.progress.results.timingValue', {
                    t: fmtMs(ttft),
                    d: fmtTps(decode),
                  })}
                </div>
                {recentTrials.length === 0 ? (
                  <p className="py-2 text-center text-[11px] text-muted-foreground">
                    {t('eval.progress.matrix.noTrials')}
                  </p>
                ) : (
                  <div className="max-h-28 space-y-1 overflow-y-auto">
                    {recentTrials.map((tr) => (
                      <div
                        key={tr.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/40 px-1.5 py-1 font-mono text-[10px]"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate" title={tr.sampleId}>{tr.sampleId}</span>
                          <span className="shrink-0 text-muted-foreground">· {tr.outcome}</span>
                          <span className="shrink-0 text-muted-foreground">· {tr.turns ?? 0} turns</span>
                        </span>
                        <span
                          className="shrink-0"
                          title={`${t('monitor.inputTok')}: ${fmtInt(tr.inputTokens)}, ${t('monitor.outputTok')}: ${fmtInt(tr.outputTokens)}, ${t('monitor.thinkTok')}: ${fmtInt(tr.thinkingTokens)}`}
                        >
                          <span className="text-warning">{fmtInt(tr.inputTokens)}</span>
                          <span className="text-muted-foreground"> / </span>
                          <span className="text-primary">{fmtInt(tr.outputTokens)}</span>
                          <span className="text-muted-foreground"> / </span>
                          <span className="text-chart-1">+{fmtInt(tr.thinkingTokens)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground">
                  {sources.size > 0
                    ? t('eval.progress.results.timingSource', {
                      s: [...sources.entries()].map(([s, n]) => `${s} ${n}`).join(' · '),
                    })
                    : t('eval.progress.results.noData')}
                  {` · ${turnSum} turns/${toolSum} tools`}
                </div>
              </MiniCard>

              <MiniCard
                icon={<Server className="h-4 w-4 shrink-0 text-info" />}
                title={t('monitor.archDetail')}
                aside={
                  <span className="truncate font-mono text-[11px] text-muted-foreground" title={snap?.model}>
                    {snap?.model ?? t('eval.progress.results.noData')}
                  </span>
                }
              >
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  <div className="rounded-md border border-border/50 bg-muted/40 p-1.5">
                    <div className="font-sans text-[10px] text-muted-foreground">{t('monitor.archKindShort')}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] font-bold uppercase text-foreground">
                      {arch?.architecture || '—'}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/40 p-1.5">
                    <div className="font-sans text-[10px] text-muted-foreground">{t('monitor.blockCount')}</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-foreground">
                      {arch?.blockCount ? t('monitor.blockUnit', { n: String(arch.blockCount) }) : '—'}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/40 p-1.5">
                    <div className="font-sans text-[10px] text-muted-foreground">{t('monitor.embedDim')}</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-foreground">
                      {arch?.embeddingLength ? `${arch.embeddingLength}` : '—'}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/40 p-1.5">
                    <div className="font-sans text-[10px] text-muted-foreground">{t('monitor.heads')}</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-foreground">
                      {arch?.headCount ? `${arch.headCount} Heads` : '—'}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/40 p-1.5">
                    <div className="font-sans text-[10px] text-muted-foreground">{t('monitor.kvHeads')}</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-foreground">
                      {arch?.headCountKv ? `${arch.headCountKv} KV Heads` : '—'}
                    </div>
                  </div>
                  <div className="rounded-md border border-border/50 bg-muted/40 p-1.5">
                    <div className="font-sans text-[10px] text-muted-foreground">{t('monitor.ffnDim')}</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-foreground">
                      {arch?.feedForwardLength ? `${arch.feedForwardLength}` : '—'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                  <span>{snap?.provider ?? ''}</span>
                  {arch?.parameterSize && (
                    <span className="text-foreground">
                      {arch.parameterSize}
                      {arch.quantizationLevel ? ` (${arch.quantizationLevel})` : ''}
                    </span>
                  )}
                  <span>
                    {t('eval.progress.results.archCtx')}{' '}
                    {(snap?.contextSize ?? 0) > 0 ? (snap?.contextSize ?? 0).toLocaleString() : t('eval.progress.results.noData')}
                  </span>
                  <span>T {snap?.temperature ?? '—'}</span>
                  <span>
                    {t('eval.progress.results.archReasoning')}{' '}
                    {snap?.reasoning === 'on' ? `on:${snap?.reasoningEffort ?? 'medium'}` : (snap?.reasoning ?? 'default')}
                  </span>
                  <span>
                    {t('eval.progress.results.load')} {c.loadMs != null ? fmtMs(c.loadMs) : t('eval.progress.results.noData')}
                  </span>
                </div>
              </MiniCard>
            </div>
          </div>
        );
      })}
    </div>
  );
}
