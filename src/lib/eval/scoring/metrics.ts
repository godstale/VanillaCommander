import type {
  EvalPackManifest,
  EvalScoreRow,
  EvalScoreSource,
  EvalTrialRow,
  MetricSpec,
  PackKind,
  TrialOutcome,
} from '../types';
import { median, mean, percentile, stddev } from '../stats/descriptive';
import { passAtK, passHatK } from '../stats/passk';

const SOURCE_RANK: Record<EvalScoreSource, number> = { auto: 1, judge: 2, human: 3 };

/** Correctness threshold applied to continuous scores when a binary verdict is needed. */
export const CORRECT_THRESHOLD = 0.5;

/**
 * For the same (trialId, scorerKey) keep a single score with
 * priority human > judge > auto. Ties keep the first input row.
 */
export function pickEffectiveScore(scores: EvalScoreRow[]): EvalScoreRow[] {
  const best = new Map<string, EvalScoreRow>();
  for (const s of scores) {
    const key = `${s.trialId}::${s.scorerKey}`;
    const prev = best.get(key);
    if (!prev || (SOURCE_RANK[s.source] ?? 0) > (SOURCE_RANK[prev.source] ?? 0)) {
      best.set(key, s);
    }
  }
  return [...best.values()];
}

/**
 * Placeholder for the scorer-combine module (parallel task):
 * mean of a trial's effective score values. Null when no finite values.
 */
export function combineTrialScores(scores: EvalScoreRow[]): number | null {
  const vals = scores.map((s) => s.value).filter((v) => Number.isFinite(v));
  if (vals.length === 0) return null;
  return mean(vals);
}

export interface ComputedMetric {
  candidateId: string;
  packId: string;
  metricId: string;
  value: number | null;
  /** Number of samples backing the value. */
  n: number;
  /** Raw per-sample values (epoch-averaged), for sample bootstrap. */
  sampleValues: number[];
  /** Cluster id per sample value, for cluster-aware bootstrap. */
  clusters: (string | undefined)[];
}

export interface ComputeMetricsOptions {
  reliabilityEpochs?: number;
  sampleClusters?: Record<string, string>;
}

function toCamel(field: string): string {
  return field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function trialFieldValue(trial: EvalTrialRow, field: string): number | null {
  const rec = trial as unknown as Record<string, unknown>;
  const raw = rec[field] ?? rec[toCamel(field)];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function aggregateSamples(
  samples: { sampleId: string; values: number[] }[],
  spec: MetricSpec,
  reliabilityEpochs: number,
): { value: number | null; n: number; sampleValues: number[] } {
  const perSample = samples
    .map((s) => ({ sampleId: s.sampleId, m: s.values.length > 0 ? mean(s.values) : NaN }))
    .filter((s) => Number.isFinite(s.m));
  const means = perSample.map((s) => s.m);
  if (means.length === 0) return { value: null, n: 0, sampleValues: [] };
  const k = spec.k ?? 1;
  switch (spec.aggregation) {
    case 'mean':
      return { value: mean(means), n: means.length, sampleValues: means };
    case 'median':
      return { value: median(means), n: means.length, sampleValues: means };
    case 'p95':
      return { value: percentile(means, 95), n: means.length, sampleValues: means };
    case 'rate': {
      const v = mean(means.map((m) => (m >= CORRECT_THRESHOLD ? 1 : 0)));
      return { value: v, n: means.length, sampleValues: means };
    }
    case 'pass_at_k':
    case 'pass_hat_k': {
      const fn = spec.aggregation === 'pass_at_k' ? passAtK : passHatK;
      const kk = spec.aggregation === 'pass_hat_k' ? (spec.k ?? reliabilityEpochs) : k;
      const vals: number[] = [];
      for (const s of samples) {
        const finite = s.values.filter((v) => Number.isFinite(v));
        if (finite.length === 0) continue;
        const c = finite.filter((v) => v >= CORRECT_THRESHOLD).length;
        const r = fn(finite.length, c, kk);
        if (Number.isFinite(r)) vals.push(r);
      }
      if (vals.length === 0) return { value: null, n: 0, sampleValues: [] };
      return { value: mean(vals), n: vals.length, sampleValues: vals };
    }
  }
}

/**
 * Per (candidate, pack, MetricSpec.id) values.
 * `source='score'` uses the epoch-averaged combined trial score
 * (simple mean; the scorer-combine module may refine this later).
 * `source='derived'` yields null here (candidate-level metrics in
 * computeCandidateMetrics cover the known derived ids).
 */
export function computeMetrics(
  trials: EvalTrialRow[],
  scores: EvalScoreRow[],
  packs: EvalPackManifest[],
  opts?: ComputeMetricsOptions,
): ComputedMetric[] {
  const reliabilityEpochs = opts?.reliabilityEpochs ?? 2;
  const manifestById = new Map(packs.map((p) => [p.id, p]));
  const effective = pickEffectiveScore(scores);
  const byTrial = new Map<string, EvalScoreRow[]>();
  for (const s of effective) {
    const arr = byTrial.get(s.trialId);
    if (arr) arr.push(s);
    else byTrial.set(s.trialId, [s]);
  }
  const groups = new Map<string, EvalTrialRow[]>();
  for (const t of trials) {
    const key = `${t.candidateId}::${t.packId}`;
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }
  const out: ComputedMetric[] = [];
  for (const [groupKey, groupTrials] of groups) {
    const sep = groupKey.indexOf('::');
    const candidateId = groupKey.slice(0, sep);
    const packId = groupKey.slice(sep + 2);
    const manifest = manifestById.get(packId);
    if (!manifest) continue;
    const bySample = new Map<string, EvalTrialRow[]>();
    for (const t of groupTrials) {
      const arr = bySample.get(t.sampleId);
      if (arr) arr.push(t);
      else bySample.set(t.sampleId, [t]);
    }
    for (const spec of manifest.metrics) {
      if (spec.source === 'derived') {
        out.push({ candidateId, packId, metricId: spec.id, value: null, n: 0, sampleValues: [], clusters: [] });
        continue;
      }
      const samples = [...bySample.entries()].map(([sampleId, ts]) => ({
        sampleId,
        values: ts
          .map((t) => {
            if (spec.source === 'score') {
              return combineTrialScores(byTrial.get(t.id) ?? []);
            }
            return trialFieldValue(t, spec.field ?? spec.id);
          })
          .filter((v): v is number => v !== null),
      }));
      const agg = aggregateSamples(samples, spec, reliabilityEpochs);
      out.push({
        candidateId,
        packId,
        metricId: spec.id,
        value: agg.value,
        n: agg.n,
        sampleValues: agg.sampleValues,
        clusters: samples
          .filter((s) => s.values.length > 0)
          .map((s) => opts?.sampleClusters?.[s.sampleId]),
      });
    }
  }
  return out;
}

export interface CandidateMetricValue {
  value: number | null;
  n: number;
}

export interface CandidateMetricContext {
  loadMs: number | null;
  vramTotalMb: number | null;
  packKinds: Record<string, PackKind>;
  reliabilityEpochs?: number;
}

const FAILURE_OUTCOMES: TrialOutcome[] = ['timeout', 'oom', 'provider_error', 'max_turns'];

function parseExtra(trial: EvalTrialRow): Record<string, unknown> {
  if (!trial.extraJson) return {};
  try {
    const parsed: unknown = JSON.parse(trial.extraJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // malformed extraJson is ignored
  }
  return {};
}

/**
 * Candidate-level special metrics (used by the P1/P2/R1/S1 category
 * mappings and constraint checks). Keys: ttft_p50_ms, ttft_p95_ms,
 * decode_tps, prefill_tps, load_ms, depth_retention, vram_headroom,
 * gpu_offload, format_error_rate, failure_rate, pass_hat_k,
 * score_stddev, effective_context_tokens, tokens_per_correct,
 * seconds_per_correct.
 */
export function computeCandidateMetrics(
  trials: EvalTrialRow[],
  scores: EvalScoreRow[],
  candidateId: string,
  ctx: CandidateMetricContext,
): Record<string, CandidateMetricValue> {
  const own = trials.filter((t) => t.candidateId === candidateId);
  const effective = pickEffectiveScore(scores);
  const byTrial = new Map<string, EvalScoreRow[]>();
  for (const s of effective) {
    const arr = byTrial.get(s.trialId);
    if (arr) arr.push(s);
    else byTrial.set(s.trialId, [s]);
  }
  const trialScore = (trialId: string): number | null =>
    combineTrialScores(byTrial.get(trialId) ?? []);
  const nonPerf = own.filter((t) => ctx.packKinds[t.packId] !== 'perf_probe');
  const nullMetric = (): CandidateMetricValue => ({ value: null, n: 0 });
  const result: Record<string, CandidateMetricValue> = {};

  const ttfts = own.map((t) => t.ttftMs).filter((v): v is number => v !== null);
  result['ttft_p50_ms'] = ttfts.length > 0 ? { value: median(ttfts), n: ttfts.length } : nullMetric();
  result['ttft_p95_ms'] = ttfts.length > 0 ? { value: percentile(ttfts, 95), n: ttfts.length } : nullMetric();

  const decodes = own.map((t) => t.decodeTps).filter((v): v is number => v !== null);
  result['decode_tps'] = decodes.length > 0 ? { value: median(decodes), n: decodes.length } : nullMetric();

  const prefills = own
    .filter((t) => t.cacheHit === false)
    .map((t) => t.prefillTps)
    .filter((v): v is number => v !== null);
  result['prefill_tps'] = prefills.length > 0 ? { value: median(prefills), n: prefills.length } : nullMetric();

  result['load_ms'] =
    ctx.loadMs !== null && Number.isFinite(ctx.loadMs) ? { value: ctx.loadMs, n: 1 } : nullMetric();

  const deepDecodes: number[] = [];
  const baseDecodes: number[] = [];
  for (const t of own) {
    if (t.decodeTps === null) continue;
    const extra = parseExtra(t);
    const depthRatio = extra['depthRatio'];
    if (typeof depthRatio === 'number' && depthRatio >= 0.9) deepDecodes.push(t.decodeTps);
    else if (typeof depthRatio !== 'number' && t.inputTokens !== null && t.inputTokens <= 2048) {
      baseDecodes.push(t.decodeTps);
    }
  }
  result['depth_retention'] =
    deepDecodes.length > 0 && baseDecodes.length > 0 && median(baseDecodes) > 0
      ? { value: median(deepDecodes) / median(baseDecodes), n: deepDecodes.length + baseDecodes.length }
      : nullMetric();

  const peaks = own.map((t) => t.vramPeakMb).filter((v): v is number => v !== null);
  result['vram_headroom'] =
    peaks.length > 0 && ctx.vramTotalMb !== null && ctx.vramTotalMb > 0
      ? { value: 1 - Math.max(...peaks) / ctx.vramTotalMb, n: peaks.length }
      : nullMetric();

  const offloads = own.map((t) => t.offloadRatio).filter((v): v is number => v !== null);
  result['gpu_offload'] = offloads.length > 0 ? { value: median(offloads), n: offloads.length } : nullMetric();

  if (nonPerf.length > 0) {
    let bad = 0;
    for (const t of nonPerf) {
      if (t.outcome === 'parse_error' || t.outcome === 'no_answer') {
        bad += 1;
        continue;
      }
      const ts = byTrial.get(t.id) ?? [];
      if (ts.some((s) => s.verdict === 'no_answer')) bad += 1;
    }
    result['format_error_rate'] = { value: bad / nonPerf.length, n: nonPerf.length };
  } else {
    result['format_error_rate'] = nullMetric();
  }

  if (own.length > 0) {
    const failed = own.filter((t) => FAILURE_OUTCOMES.includes(t.outcome)).length;
    result['failure_rate'] = { value: failed / own.length, n: own.length };
  } else {
    result['failure_rate'] = nullMetric();
  }

  const k = ctx.reliabilityEpochs ?? 2;
  // Group by pack + sample: identical sample ids in different packs are unrelated.
  const bySample = new Map<string, EvalTrialRow[]>();
  for (const t of own) {
    const key = `${t.packId}::${t.sampleId}`;
    const arr = bySample.get(key);
    if (arr) arr.push(t);
    else bySample.set(key, [t]);
  }
  const passVals: number[] = [];
  const stdVals: number[] = [];
  for (const ts of bySample.values()) {
    const epochScores = ts.map((t) => trialScore(t.id)).filter((v): v is number => v !== null);
    if (epochScores.length >= 2) {
      stdVals.push(stddev(epochScores));
      const c = epochScores.filter((v) => v >= CORRECT_THRESHOLD).length;
      const r = passHatK(epochScores.length, c, k);
      if (Number.isFinite(r)) passVals.push(r);
    }
  }
  result['pass_hat_k'] = passVals.length > 0 ? { value: mean(passVals), n: passVals.length } : nullMetric();
  result['score_stddev'] = stdVals.length > 0 ? { value: mean(stdVals), n: stdVals.length } : nullMetric();

  const longTrials = own.filter(
    (t) => ctx.packKinds[t.packId] === 'long_context' && trialScore(t.id) !== null && t.inputTokens !== null,
  );
  const buckets = new Map<number, number[]>();
  for (const t of longTrials) {
    const len = t.inputTokens as number;
    const sc = trialScore(t.id) as number;
    const arr = buckets.get(len);
    if (arr) arr.push(sc);
    else buckets.set(len, [sc]);
  }
  const sortedLens = [...buckets.keys()].sort((a, b) => a - b);
  if (sortedLens.length > 0) {
    const acc = (len: number): number => mean(buckets.get(len) ?? [NaN]);
    const baseline = acc(sortedLens[0]);
    let effective = sortedLens[0];
    for (const len of sortedLens) {
      if (Number.isFinite(acc(len)) && acc(len) >= 0.85 * baseline) effective = len;
    }
    result['effective_context_tokens'] = { value: effective, n: longTrials.length };
  } else {
    result['effective_context_tokens'] = nullMetric();
  }

  let totalTokens = 0;
  let totalSec = 0;
  let correct = 0;
  for (const t of own) {
    const sc = trialScore(t.id);
    if (sc === null || sc < CORRECT_THRESHOLD) continue;
    correct += 1;
    totalTokens += (t.inputTokens ?? 0) + (t.outputTokens ?? 0);
    totalSec += (t.totalMs ?? 0) / 1000;
  }
  result['tokens_per_correct'] = correct > 0 ? { value: totalTokens / correct, n: correct } : nullMetric();
  result['seconds_per_correct'] = correct > 0 ? { value: totalSec / correct, n: correct } : nullMetric();

  return result;
}
