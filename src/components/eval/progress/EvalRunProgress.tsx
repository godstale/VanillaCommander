import { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, Pause, Play, SkipForward, XCircle, FileDown } from 'lucide-react';
import { useEval } from '@/lib/context/EvalContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FieldInfo } from '../wizard/FieldInfo';
import {
  getRun,
  listAggregates,
  listCandidates,
  listScores,
  listTrials,
} from '@/lib/db/repositories/evalRepo';
import type {
  EvalCandidateRow,
  EvalRunRow,
  EvalScoreRow,
  EvalTrialRow,
} from '@/lib/eval/types';
import type { RunnerEvent } from '@/lib/eval/runner/events';
import {
  mergeLogEvents,
  parseProgressLog,
  progressLogRelPath,
  tauriProgressLogStore,
  toPersistedLogs,
  toPersistedResources,
  type ProgressRecord,
} from '@/lib/eval/runner/progressLog';
import { CandidatePackMatrix } from './CandidatePackMatrix';
import { CandidateResults } from './CandidateResults';
import { LiveSamplePreview } from './LiveSamplePreview';
import { RunEnvironment } from './RunEnvironment';
import { RunLog } from './RunLog';
import { isDeferredScorerType } from '@/lib/eval/scorers/deferredScorers';
import { scorerKeyOf } from '@/lib/eval/scorers/index';

const POLL_MS = 2000;

type LogEvent = Extract<RunnerEvent, { type: 'log' }>;
type TrialStartEvent = Extract<RunnerEvent, { type: 'trial_start' }>;

function formatSeconds(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function statusBadgeClass(status: string): string {
  if (status === 'completed') return 'bg-success/15 text-success';
  if (status === 'failed') return 'bg-destructive/15 text-destructive';
  if (status === 'cancelled' || status === 'interrupted')
    return 'bg-warning/15 text-warning';
  if (status === 'running' || status === 'judging' || status === 'paused')
    return 'bg-primary/15 text-primary';
  return 'bg-muted text-muted-foreground';
}

function makeCellKey(candidateId: string, packId: string): string {
  return `${candidateId}|${packId}`;
}

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed']);

interface LatestResource {
  vramUsedMb: number | null;
  gpuUtilPct: number | null;
  gpuTempC: number | null;
}

function latestResourceOf(live: RunnerEvent[], persisted: ProgressRecord[]): LatestResource | null {
  for (let i = live.length - 1; i >= 0; i -= 1) {
    const e = live[i];
    if (e.type === 'resource') {
      return { vramUsedMb: e.vramUsedMb, gpuUtilPct: e.gpuUtilPct, gpuTempC: e.gpuTempC };
    }
  }
  const points = toPersistedResources(persisted);
  const last = points.length > 0 ? points[points.length - 1] : null;
  return last
    ? { vramUsedMb: last.vramUsedMb, gpuUtilPct: last.gpuUtilPct, gpuTempC: null }
    : null;
}

export function EvalRunProgress({ runId }: { runId: string }) {
  return <EvalRunProgressInner key={runId} runId={runId} />;
}

function EvalRunProgressInner({ runId }: { runId: string }) {
  const { t, locale } = useLanguage();
  const { runs, packs, activeRunner, events, pausePending, pauseRun, resumeRun, cancelRun, skipCandidate } =
    useEval();

  const [run, setRun] = useState<EvalRunRow | null>(null);
  const [candidates, setCandidates] = useState<EvalCandidateRow[]>([]);
  const [trials, setTrials] = useState<EvalTrialRow[]>([]);
  const [scores, setScores] = useState<EvalScoreRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cachedInput, setCachedInput] = useState<{
    key: string;
    input: string | null;
  } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [composites, setComposites] = useState<Record<string, number>>({});
  const [persistedRecords, setPersistedRecords] = useState<ProgressRecord[]>([]);
  const [logTruncated, setLogTruncated] = useState(false);

  const isActiveRun = activeRunner?.runId === runId;
  const liveEvents = useMemo(
    () => (isActiveRun ? events : []),
    [isActiveRun, events],
  );

  useEffect(() => {
    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const [nextRun, nextCandidates, nextTrials, nextScores, nextAggregates] = await Promise.all([
          getRun(runId),
          listCandidates(runId),
          listTrials(runId),
          listScores(runId),
          listAggregates(runId).catch(() => []),
        ]);
        if (cancelled) return;
        setRun(nextRun);
        setCandidates(nextCandidates);
        setTrials(nextTrials);
        setScores(nextScores);
        const comp: Record<string, number> = {};
        for (const row of nextAggregates) {
          if (row.level === 'composite' && row.normalized != null) comp[row.candidateId] = row.normalized;
        }
        setComposites(comp);
        setLoaded(true);
        setLoadError(nextRun == null);
      } catch {
        if (cancelled) return;
        setLoaded(true);
        setLoadError(true);
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId]);

  const status = isActiveRun && activeRunner ? activeRunner.status : (run?.status ?? 'pending');
  const isTerminal = TERMINAL_STATUSES.has(status);
  const showControls = isActiveRun && !isTerminal;
  const showPausePending = showControls && pausePending && status === 'running';

  // Run finished while watching: reload the file once for the final tail.
  const reloadedTailRef = useRef(false);
  useEffect(() => {
    if (!isTerminal || reloadedTailRef.current) return;
    reloadedTailRef.current = true;
    tauriProgressLogStore
      .read(runId)
      .then((readout) => {
        setPersistedRecords(parseProgressLog(readout.text));
        setLogTruncated(readout.truncated);
      })
      .catch(() => undefined);
  }, [isTerminal, runId]);

  useEffect(() => {
    if (!showControls) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [showControls]);

  const runName = run?.name ?? runs.find((r) => r.id === runId)?.name ?? runId;
  const done = run?.progressDone ?? 0;
  const total = run?.progressTotal ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  const startedAt = run?.startedAt ?? null;
  const finishedAt = run?.finishedAt ?? null;
  const elapsedSec = useMemo(() => {
    if (startedAt == null) return null;
    const start = new Date(startedAt).getTime();
    if (!Number.isFinite(start)) return null;
    const end = finishedAt != null ? new Date(finishedAt).getTime() : nowMs;
    if (!Number.isFinite(end) || end < start) return null;
    return (end - start) / 1000;
  }, [startedAt, finishedAt, nowMs]);

  const lastEtaSec = useMemo(() => {
    for (let i = liveEvents.length - 1; i >= 0; i -= 1) {
      const e = liveEvents[i];
      if (e.type === 'eta') return e.remainingSec;
    }
    return null;
  }, [liveEvents]);

  const fallbackEtaSec = useMemo(() => {
    if (elapsedSec == null || done <= 0 || total <= done) return null;
    return (elapsedSec * (total - done)) / done;
  }, [elapsedSec, done, total]);

  const etaSec = lastEtaSec ?? fallbackEtaSec;

  const packIds = useMemo(
    () => (run?.config.packs ?? []).map((p) => p.packId),
    [run],
  );

  const expectedPerCell = useMemo(() => {
    const out: Record<string, number> = {};
    const packDefs = run?.config.packs ?? [];
    for (const c of candidates) {
      for (const p of packDefs) {
        out[makeCellKey(c.id, p.packId)] = p.sampleIds.length * p.epochs;
      }
    }
    return out;
  }, [candidates, run]);

  const currentStart = useMemo<TrialStartEvent | null>(() => {
    for (let i = liveEvents.length - 1; i >= 0; i -= 1) {
      const e = liveEvents[i];
      if (e.type === 'trial_start') return e;
    }
    return null;
  }, [liveEvents]);

  const streamText = useMemo(() => {
    if (!currentStart) return '';
    const chunks: string[] = [];
    let afterStart = false;
    for (const e of liveEvents) {
      if (e === currentStart) {
        afterStart = true;
        continue;
      }
      if (!afterStart) continue;
      if (
        e.type === 'trial_delta' &&
        e.candidateId === currentStart.candidateId &&
        e.packId === currentStart.packId &&
        e.sampleId === currentStart.sampleId
      ) {
        chunks.push(e.text);
      }
    }
    return chunks.join('');
  }, [liveEvents, currentStart]);

  const currentTrialRow = useMemo<EvalTrialRow | null>(() => {
    if (!currentStart) return null;
    const matches = trials.filter(
      (tr) =>
        tr.candidateId === currentStart.candidateId &&
        tr.packId === currentStart.packId &&
        tr.sampleId === currentStart.sampleId,
    );
    if (matches.length === 0) return null;
    return matches.reduce((a, b) => (a.startedAt >= b.startedAt ? a : b));
  }, [trials, currentStart]);

  const currentOutcome = useMemo<string | null>(() => {
    if (currentTrialRow) return currentTrialRow.outcome;
    if (!currentStart) return null;
    for (let i = liveEvents.length - 1; i >= 0; i -= 1) {
      const e = liveEvents[i];
      if (
        e.type === 'trial_end' &&
        e.candidateId === currentStart.candidateId &&
        e.packId === currentStart.packId &&
        e.sampleId === currentStart.sampleId
      ) {
        return e.outcome;
      }
    }
    return null;
  }, [currentTrialRow, liveEvents, currentStart]);

  const trialKey = currentStart
    ? `${currentStart.packId}|${currentStart.sampleId}|${currentStart.epoch}`
    : null;
  const currentPackId = currentStart?.packId ?? null;
  const currentSampleId = currentStart?.sampleId ?? null;

  useEffect(() => {
    if (trialKey == null || currentPackId == null || currentSampleId == null) return;
    if (cachedInput?.key === trialKey) return;
    const ref = packs.find((p) => p.manifest.id === currentPackId);
    if (!ref) return;
    let cancelled = false;
    void (async () => {
      try {
        const [{ loadPack }, { tauriPackFs }] = await Promise.all([
          import('@/lib/eval/packs/packLoader'),
          import('@/lib/eval/packs/packFs'),
        ]);
        const pack = await loadPack(tauriPackFs, ref);
        const sample = pack.samples.find((s) => s.id === currentSampleId);
        const input =
          sample == null
            ? null
            : typeof sample.input === 'string'
              ? sample.input
              : sample.input.map((m) => m.content).join('\n');
        if (!cancelled) setCachedInput({ key: trialKey, input });
      } catch {
        if (!cancelled) setCachedInput({ key: trialKey, input: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trialKey, currentPackId, currentSampleId, packs, cachedInput]);

  const sampleInput = trialKey != null && cachedInput?.key === trialKey ? cachedInput.input : null;

  // Persisted JSONL history: loaded once on mount (covers restarts), and
  // reloaded when the run reaches a terminal state to pick up the tail
  // (aggregates summary, final status). Missing file / non-Tauri env → empty.
  useEffect(() => {
    let cancelled = false;
    tauriProgressLogStore
      .read(runId)
      .then((readout) => {
        if (cancelled) return;
        setPersistedRecords(parseProgressLog(readout.text));
        setLogTruncated(readout.truncated);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const logEvents = useMemo<LogEvent[]>(
    () => liveEvents.filter((e): e is LogEvent => e.type === 'log'),
    [liveEvents],
  );

  const persistedLogs = useMemo(() => toPersistedLogs(persistedRecords), [persistedRecords]);

  const mergedLogs = useMemo<LogEvent[]>(
    () =>
      mergeLogEvents(persistedLogs, logEvents).map((e) => ({
        type: 'log' as const,
        level: e.level,
        message: e.message,
      })) as LogEvent[],
    [persistedLogs, logEvents],
  );

  const latestResource = useMemo(
    () => latestResourceOf(liveEvents, persistedRecords),
    [liveEvents, persistedRecords],
  );

  const totalSamples = useMemo(
    () => (run?.config.packs ?? []).reduce((a, p) => a + p.sampleIds.length * p.epochs, 0),
    [run],
  );

  function downloadLog(): void {
    if (!run) return;
    const payload = {
      runId,
      runName: run.name,
      status: run.status,
      exportedAt: new Date().toISOString(),
      hardware: run.hardware,
      candidates: candidates.map((c) => ({ label: c.label, model: c.snapshot?.model ?? null })),
      persistedRecords,
      fileTruncated: logTruncated,
      liveTail: liveEvents.filter((e) => e.type !== 'trial_delta' && e.type !== 'eta'),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eval-log-${runId.slice(0, 8)}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const liveCell = useMemo(() => {
    if (!currentStart || isTerminal) return null;
    return { candidateId: currentStart.candidateId, packId: currentStart.packId };
  }, [currentStart, isTerminal]);

  const candidateLabel = useMemo(() => {
    if (!currentStart) return null;
    return candidates.find((c) => c.id === currentStart.candidateId)?.label ?? null;
  }, [candidates, currentStart]);

  const judgeLabel = useMemo(() => {
    const judge = run?.config.judge;
    if (!judge) return t('eval.progress.matrix.judgeNone');
    if (judge.target.type === 'local') return judge.target.model;
    return judge.target.integrationId;
  }, [run, t]);

  const packTitles = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of packs) {
      out[p.manifest.id] = locale === 'ko' ? p.manifest.title.ko : p.manifest.title.en;
    }
    for (const p of (run?.config.packs ?? [])) {
      if (!out[p.packId]) out[p.packId] = p.packId;
    }
    return out;
  }, [packs, run, locale]);

  const packHelps = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of packs) {
      const desc = locale === 'ko' ? p.manifest.description.ko : p.manifest.description.en;
      out[p.manifest.id] = `${desc} (${p.manifest.category} · ${p.manifest.kind})`;
    }
    return out;
  }, [packs, locale]);

  // Deferred (async) scorer keys per pack, from the pack manifest. A trial is
  // "pending finalization" while any of those keys has no score row yet:
  // its visible % covers deterministic checks only (FAB Q4) or nothing at
  // all (FAB Q5 before the code-exec pass).
  const deferredKeysByPack = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const p of packs) {
      const keys = (p.manifest.scorers ?? [])
        .filter((s) => isDeferredScorerType(s.type))
        .map((s) => scorerKeyOf(s));
      if (keys.length > 0) out[p.manifest.id] = keys;
    }
    for (const p of (run?.config.packs ?? [])) {
      out[p.packId] ??= [];
    }
    return out;
  }, [packs, run]);

  const pendingTrialIds = useMemo(() => {
    const keysByTrial = new Map<string, Set<string>>();
    for (const s of scores) {
      const set = keysByTrial.get(s.trialId) ?? new Set<string>();
      set.add(s.scorerKey);
      keysByTrial.set(s.trialId, set);
    }
    const out = new Set<string>();
    for (const tr of trials) {
      const keys = deferredKeysByPack[tr.packId];
      if (!keys || keys.length === 0) continue;
      const have = keysByTrial.get(tr.id);
      if (keys.some((k) => !have?.has(k))) out.add(tr.id);
    }
    return out;
  }, [trials, scores, deferredKeysByPack]);

  if (!loaded) {
    return (
      <p className="p-4 text-xs text-muted-foreground">
        {t('eval.progress.loading')}
      </p>
    );
  }

  if (loadError || !run) {
    return (
      <p className="p-4 text-xs text-destructive">
        {t('eval.progress.loadFailed')}
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <header className="rounded-xl border border-border bg-card/40 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <FlaskConical className="h-4 w-4 text-primary" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
            {runName}
          </h2>
          <FieldInfo label={t('eval.progress.title')} help={t('eval.progress.header.help')} />
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              statusBadgeClass(status),
            )}
          >
            {t('eval.progress.status')}: {status}
          </span>
          {showPausePending && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
              {t('eval.progress.pausePending')}
            </span>
          )}
        </div>
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('eval.progress.overall')}</span>
            <span className="font-mono">
              {t('eval.progress.trials', { done, total })} · {pct}%
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t('eval.progress.elapsed')}:{' '}
            <span className="font-mono text-foreground">
              {elapsedSec != null ? formatSeconds(elapsedSec) : t('eval.progress.etaUnknown')}
            </span>
          </span>
          <span>
            {t('eval.progress.eta')}:{' '}
            <span className="font-mono text-foreground">
              {etaSec != null ? formatSeconds(etaSec) : t('eval.progress.etaUnknown')}
            </span>
          </span>
        </div>
        {showControls && (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <FieldInfo label={t('eval.progress.pause')} help={t('eval.progress.controls.help')} />
              {status === 'running' && (
                <Button type="button" size="sm" variant="outline" disabled={showPausePending} onClick={pauseRun}>
                  <Pause className="h-3.5 w-3.5" />
                  {showPausePending ? t('eval.progress.pausePending') : t('eval.progress.pause')}
                </Button>
              )}
              {status === 'paused' && (
                <Button type="button" size="sm" onClick={resumeRun}>
                  <Play className="h-3.5 w-3.5" />
                  {t('eval.progress.resume')}
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" onClick={skipCandidate}>
                <SkipForward className="h-3.5 w-3.5" />
                {t('eval.progress.skipCandidate')}
              </Button>
              {confirmCancel ? (
                <>
                  <span className="w-full text-[11px] text-muted-foreground">
                    {t('eval.progress.cancelAsk')}
                  </span>
                  <Button type="button" size="sm" variant="destructive" onClick={cancelRun}>
                    <XCircle className="h-3.5 w-3.5" />
                    {t('eval.progress.cancelYes')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmCancel(false)}
                  >
                    {t('eval.progress.cancelNo')}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmCancel(true)}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  {t('eval.progress.cancel')}
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {t('eval.progress.pauseNote')}
            </p>
          </div>
        )}
      </header>

      <section className="rounded-xl border border-border bg-card/40 p-3.5">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
          {t('eval.progress.env.title')}
          <FieldInfo label={t('eval.progress.env.title')} help={t('eval.progress.env.help')} />
        </h3>
        <RunEnvironment
          run={run}
          judgeLabel={judgeLabel}
          totalSamples={totalSamples}
          latest={latestResource}
        />
      </section>

      {status === 'completed' && (
        <div className="rounded-xl border border-success/30 bg-success/5 p-3 text-xs">
          <p className="font-medium text-foreground">{t('eval.progress.completed')}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            disabled
            data-future-view="report"
            title={t('eval.progress.viewReport')}
          >
            {t('eval.progress.viewReport')}
          </Button>
        </div>
      )}

      <section className="rounded-xl border border-border bg-card/40 p-3.5">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
          {t('eval.progress.matrix.title')}
          <FieldInfo label={t('eval.progress.matrix.title')} help={t('eval.progress.matrix.help')} />
        </h3>
        <div className="mb-3 space-y-1 rounded-md border border-border/60 bg-card/30 p-2.5 text-[11px]">
          <div className="flex items-start gap-1.5">
            <span className="shrink-0 font-semibold text-foreground">
              {t('eval.progress.matrix.models')}
            </span>
            <FieldInfo label={t('eval.progress.matrix.models')} help={t('eval.progress.models.help')} />
            <span className="min-w-0 flex-1 text-muted-foreground">
              {candidates.map((c) => `${c.label} · ${c.snapshot?.model ?? '?'}`).join(' / ') || '—'}
            </span>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="shrink-0 font-semibold text-foreground">
              {t('eval.progress.matrix.judge')}
            </span>
            <FieldInfo label={t('eval.progress.matrix.judge')} help={t('eval.progress.models.help')} />
            <span className="min-w-0 flex-1 font-mono text-muted-foreground">{judgeLabel}</span>
          </div>
        </div>
        <CandidatePackMatrix
          candidates={candidates}
          packIds={packIds}
          trials={trials}
          scores={scores}
          expectedPerCell={expectedPerCell}
          liveCell={liveCell}
          packTitles={packTitles}
          packHelps={packHelps}
          pendingTrialIds={pendingTrialIds}
        />
      </section>

      <section className="rounded-xl border border-border bg-card/40 p-3.5">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
          {t('eval.progress.results.title')}
          <FieldInfo label={t('eval.progress.results.title')} help={t('eval.progress.results.help')} />
        </h3>
        <CandidateResults
          candidates={candidates}
          trials={trials}
          scores={scores}
          config={run.config}
          composites={composites}
          hardware={run.hardware}
          pendingTrialIds={pendingTrialIds}
        />
      </section>

      <section className="rounded-xl border border-border bg-card/40 p-3.5">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
          {t('eval.progress.preview.title')}
          <FieldInfo label={t('eval.progress.preview.title')} help={t('eval.progress.preview.help')} />
        </h3>
        <LiveSamplePreview
          packId={currentStart?.packId ?? null}
          sampleId={currentStart?.sampleId ?? null}
          candidateLabel={candidateLabel}
          sampleInput={sampleInput}
          streamText={streamText}
          turns={currentTrialRow?.turns ?? null}
          toolCallCount={currentTrialRow?.toolCalls ?? null}
          outcome={currentOutcome}
        />
      </section>

      <section className="rounded-xl border border-border bg-card/40 p-3.5">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            {t('eval.progress.log.title')}
            <FieldInfo label={t('eval.progress.log.title')} help={t('eval.progress.log.help')} />
          </h3>
          <span className="flex-1" />
          <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={downloadLog}>
            <FileDown className="h-3 w-3" />
            {t('eval.progress.log.download')}
          </Button>
        </div>
        <p className="mb-2 font-mono text-[11px] text-muted-foreground">
          {t('eval.progress.log.fileNote', { path: progressLogRelPath(runId) })}
          {logTruncated && ` ${t('eval.progress.log.truncated')}`}
        </p>
        <RunLog events={mergedLogs} />
      </section>
    </div>
  );
}
