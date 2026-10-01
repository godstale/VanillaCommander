import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { recommend } from '@/lib/eval/scoring/recommend';
import { collectReportData, type EvalReportData } from './reportData';
import { RecommendationCards } from './RecommendationCards';
import { RankingTable } from './RankingTable';
import { DimensionRadar } from './DimensionRadar';
import { ParetoScatter } from './ParetoScatter';
import { CategoryHeatmap } from './CategoryHeatmap';
import { ContextCurveChart } from './ContextCurveChart';
import { PackDrilldown } from './PackDrilldown';
import { QuantFidelityTable } from './QuantFidelityTable';
import { CompareRunsDialog } from './CompareRunsDialog';
import { ExportDialog } from '@/components/eval/interop/ExportDialog';
import { Button } from '@/components/ui/button';

export interface EvalReportProps {
  runId: string;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function EvalReport({ runId }: EvalReportProps) {
  const { t } = useLanguage();
  const [data, setData] = useState<EvalReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'raw' | 'normalized'>('normalized');
  const [compareOpen, setCompareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await collectReportData(runId);
        if (!active) return;
        setData(loaded);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [runId]);

  const handleRefresh = useCallback(async () => {
    try {
      setData(await collectReportData(runId));
    } catch (err) {
      console.error('Failed to refresh report:', err);
    }
  }, [runId]);

  const recommendation = useMemo(() => {
    if (!data?.run) return null;
    try {
      return recommend(data.aggregates, data.candidates, data.run.config.profile);
    } catch {
      return null;
    }
  }, [data]);

  if (loading) return <p className="p-4 text-xs text-muted-foreground">{t('eval.report.loading')}</p>;
  if (error) return <p className="p-4 text-xs text-destructive">{t('eval.report.loadError', { err: error })}</p>;
  if (!data?.run) return <p className="p-4 text-xs text-muted-foreground">{t('eval.report.runMissing')}</p>;

  const { run, candidates, aggregates, trials, scores } = data;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{run.name}</h2>
          <p className="text-[11px] text-muted-foreground">{run.status}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border text-[11px]">
            {(['raw', 'normalized'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2 py-1 ${mode === m ? 'bg-primary/15 text-foreground' : 'text-muted-foreground'}`}
              >
                {m === 'raw' ? t('eval.report.raw') : t('eval.report.normalized')}
              </button>
            ))}
          </div>
          <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setCompareOpen(true)}>
            {t('eval.report.compare')}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setExportOpen(true)}>
            {t('eval.interop.export.title')}
          </Button>
        </div>
      </div>

      {aggregates.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('eval.report.noData')}</p>
      ) : (
        <>
          {recommendation && (
            <Section title={t('eval.report.sections.recommendations')}>
              <RecommendationCards candidates={candidates} aggregates={aggregates} recommendation={recommendation} />
            </Section>
          )}
          <Section title={t('eval.report.sections.ranking')}>
            <RankingTable
              candidates={candidates}
              aggregates={aggregates}
              groups={recommendation?.groups ?? []}
              violations={recommendation?.violations ?? {}}
              mode={mode}
            />
          </Section>
          <Section title={t('eval.report.sections.radar')}>
            <DimensionRadar candidates={candidates} aggregates={aggregates} />
          </Section>
          <Section title={t('eval.report.sections.pareto')}>
            <ParetoScatter candidates={candidates} aggregates={aggregates} trials={trials} pareto={recommendation?.pareto ?? []} />
          </Section>
          <Section title={t('eval.report.sections.heatmap')}>
            <CategoryHeatmap candidates={candidates} aggregates={aggregates} mode={mode} />
          </Section>
          <Section title={t('eval.report.sections.context')}>
            <ContextCurveChart trials={trials} scores={scores} />
          </Section>
          <Section title={t('eval.report.sections.packs')}>
            <PackDrilldown trials={trials} scores={scores} candidates={candidates} onScoresChanged={() => void handleRefresh()} />
          </Section>
          <Section title={t('eval.report.sections.quant')}>
            <QuantFidelityTable candidates={candidates} aggregates={aggregates} />
          </Section>
        </>
      )}

      <CompareRunsDialog
        open={compareOpen}
        currentRunId={runId}
        currentAggregates={aggregates}
        currentCandidates={candidates}
        onClose={() => setCompareOpen(false)}
      />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} runId={runId} />
    </div>
  );
}

export default EvalReport;
