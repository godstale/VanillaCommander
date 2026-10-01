import {
  getRun,
  listAggregates,
  listCandidates,
  listScores,
  listTrials,
} from '@/lib/db/repositories/evalRepo';
import { QUANT_FIDELITY_METRIC_IDS } from '@/lib/eval/logprobs/quantFidelity';
import type {
  AggregateLevel,
  EvalAggregateRow,
  EvalCandidateRow,
  EvalRunRow,
  EvalScoreRow,
  EvalTrialRow,
} from '@/lib/eval/types';

/**
 * Plain JSON-able snapshot backing the P10-18 evaluation report UI and the
 * P10-25 exporter.
 *
 * Shape:
 * {
 *   run: EvalRunRow | null,          // eval_runs row (config.profile holds weights/constraints)
 *   candidates: EvalCandidateRow[],  // ordered by position; snapshot holds the model config
 *   aggregates: EvalAggregateRow[],  // levels: metric (key `@all:<metricId>` or `<packId>:<metricId>`),
 *                                    //   pack (key `<packId>`), category (key `<categoryId>`),
 *                                    //   dimension (key Q|A|P|R|S), composite (key `composite`);
 *                                    //   composite carries ciLow/ciHigh
 *   trials: EvalTrialRow[],          // per (candidate, pack, sample, epoch) I/O + perf fields
 *   scores: EvalScoreRow[]           // per-trial scores; source human > judge > auto via pickEffectiveScore
 * }
 */
export interface EvalReportData {
  run: EvalRunRow | null;
  candidates: EvalCandidateRow[];
  aggregates: EvalAggregateRow[];
  trials: EvalTrialRow[];
  scores: EvalScoreRow[];
}

export async function collectReportData(runId: string): Promise<EvalReportData> {
  const [run, candidates, aggregates, trials, scores] = await Promise.all([
    getRun(runId),
    listCandidates(runId),
    listAggregates(runId),
    listTrials(runId),
    listScores(runId),
  ]);
  return { run, candidates, aggregates, trials, scores };
}

/** Find one aggregate cell for (candidate, level, key). */
export function findAggregate(
  aggregates: EvalAggregateRow[],
  candidateId: string,
  level: AggregateLevel,
  key: string,
): EvalAggregateRow | undefined {
  return aggregates.find(
    (r) => r.candidateId === candidateId && r.level === level && r.key === key,
  );
}

/** Display value honoring the raw-vs-normalized toggle (falls back to whichever exists). */
export function displayValue(
  row: EvalAggregateRow | undefined,
  mode: 'raw' | 'normalized',
): number | null {
  if (!row) return null;
  if (mode === 'raw') return row.raw ?? row.normalized;
  return row.normalized ?? row.raw;
}

export function formatScore(v: number | null, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return '-';
  return v.toFixed(digits);
}

/** Fraction of the 5 dimension aggregates present for a candidate (0..1). */
export function dimensionCoverage(
  aggregates: EvalAggregateRow[],
  candidateId: string,
): number {
  const dims = ['Q', 'A', 'P', 'R', 'S'];
  let n = 0;
  for (const d of dims) {
    if (findAggregate(aggregates, candidateId, 'dimension', d)?.normalized != null) n += 1;
  }
  return n / dims.length;
}

/**
 * Report-only quantization-fidelity value for a candidate: prefers the
 * candidate-level `@all:<metricId>` row, else averages per-pack metric rows.
 */
export function quantMetricValue(
  aggregates: EvalAggregateRow[],
  candidateId: string,
  metricId: string,
): number | null {
  const own = aggregates.find(
    (r) => r.candidateId === candidateId && r.level === 'metric' && r.key === `@all:${metricId}`,
  );
  if (own) return own.raw ?? own.normalized;
  const packRows = aggregates.filter(
    (r) => r.candidateId === candidateId && r.level === 'metric' && r.key.endsWith(`:${metricId}`),
  );
  const vals = packRows.map((r) => r.raw ?? r.normalized).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** True when any Q8 quant-fidelity metric row is present. */
export function hasQuantData(aggregates: EvalAggregateRow[]): boolean {
  return QUANT_FIDELITY_METRIC_IDS.some((id) =>
    aggregates.some((r) => r.level === 'metric' && (r.key === `@all:${id}` || r.key.endsWith(`:${id}`))),
  );
}
