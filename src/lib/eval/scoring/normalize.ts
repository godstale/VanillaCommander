import { ANCHORS_V1, type AnchorSpec } from '../constants';
import type { MetricSpec } from '../types';

export function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export type Baseline = number | 'auto_choices';

export interface BaselineOptions {
  ceiling?: number;
  /** Number of answer choices (for 'auto_choices'). Defaults to 4. */
  choiceCount?: number;
  /** Circular eval: chance baseline becomes (1/k)^rotations. Defaults to false. */
  circular?: boolean;
  /** Rotation count for circular eval; defaults to choiceCount. */
  rotations?: number;
}

/**
 * GPQA-style baseline normalization:
 * clamp((raw - baseline) / (ceiling - baseline), 0, 1) * 100.
 * baseline 'auto_choices' = 1/k, or (1/k)^rotations for circular eval.
 * Null/NaN raw yields null.
 */
export function normalizeBaseline(
  raw: number | null,
  baseline: Baseline,
  opts?: BaselineOptions,
): number | null {
  if (raw === null || !Number.isFinite(raw)) return null;
  const ceiling = opts?.ceiling ?? 1;
  let b: number;
  if (baseline === 'auto_choices') {
    const k = opts?.choiceCount ?? 4;
    b = opts?.circular ? Math.pow(1 / Math.max(k, 1), Math.max(opts?.rotations ?? k, 1)) : 1 / Math.max(k, 1);
  } else {
    b = baseline;
  }
  if (!Number.isFinite(b) || !Number.isFinite(ceiling) || ceiling === b) {
    return raw >= ceiling ? 100 : 0;
  }
  return clamp01((raw - b) / (ceiling - b)) * 100;
}

/**
 * Anchor normalization (0-100) on log or linear curves.
 * dir 'up' rewards larger raw, 'down' rewards smaller raw.
 */
export function normalizeAnchor(raw: number | null, anchor: AnchorSpec): number | null {
  if (raw === null || !Number.isFinite(raw)) return null;
  const { curve, dir, zero, full } = anchor;
  if (curve === 'log') {
    if (zero <= 0 || full <= 0) return null;
    const denom = Math.log(full / zero);
    if (denom === 0) {
      if (dir === 'up') return raw >= full ? 100 : 0;
      return raw <= full ? 100 : 0;
    }
    if (dir === 'up') {
      if (raw <= 0) return 0;
      return clamp01(Math.log(raw / zero) / denom) * 100;
    }
    if (raw <= 0) return 100;
    return clamp01(Math.log(zero / raw) / Math.log(zero / full)) * 100;
  }
  const denom = full - zero;
  if (denom === 0) return raw >= full ? 100 : 0;
  if (dir === 'up') return clamp01((raw - zero) / denom) * 100;
  return clamp01((zero - raw) / (zero - full)) * 100;
}

export interface NormalizeContext {
  /** Defaults to ANCHORS_V1; profile anchorOverrides are merged on top by the caller. */
  anchors?: Record<string, AnchorSpec>;
  choiceCount?: number;
  rotations?: number;
}

const ANCHOR_ALIASES: Record<string, string> = {
  ttft_p95_ms: 'ttft_p50_ms',
};

/** Metrics excluded from composite scoring (auxiliary diagnostics). */
export const AUX_METRICS = new Set(['tokens_per_correct', 'seconds_per_correct', 'effective_context_tokens']);

/**
 * Normalize one raw metric value to 0-100 (null = N/A, excluded from means).
 * Order: S-dimension mappings, anchor table (+aliases), pack MetricSpec
 * normalization, then a 0-1 fallback (*100) for unknown score metrics.
 */
export function normalizeMetricValue(
  metricId: string,
  raw: number | null,
  spec?: MetricSpec | null,
  ctx?: NormalizeContext,
): number | null {
  if (raw === null || !Number.isFinite(raw)) return null;
  switch (metricId) {
    case 'failure_rate':
    case 'format_error_rate':
      return clamp01(1 - raw) * 100;
    case 'pass_hat_k':
      return clamp01(raw) * 100;
    case 'score_stddev':
      return clamp01(1 - 2 * raw) * 100;
    default:
      break;
  }
  if (AUX_METRICS.has(metricId)) return null;
  const anchors = ctx?.anchors ?? ANCHORS_V1;
  const anchorId = anchors[metricId] ? metricId : (ANCHOR_ALIASES[metricId] ?? null);
  if (anchorId && anchors[anchorId]) return normalizeAnchor(raw, anchors[anchorId]);
  const norm = spec?.normalization;
  if (norm) {
    if (norm.kind === 'baseline') {
      return normalizeBaseline(raw, norm.baseline, {
        ceiling: norm.ceiling,
        choiceCount: ctx?.choiceCount,
        rotations: ctx?.rotations,
      });
    }
    if (norm.kind === 'anchor') {
      const anchor = anchors[norm.anchorId];
      return anchor ? normalizeAnchor(raw, anchor) : null;
    }
    const span = spec.range.max - spec.range.min;
    if (span === 0) return raw >= spec.range.max ? 100 : 0;
    return clamp01((raw - spec.range.min) / span) * 100;
  }
  if (raw >= 0 && raw <= 1) return raw * 100;
  return null;
}

/** Mean of normalized values, skipping N/A; null when all are N/A. */
export function meanSkippingNA(values: (number | null | undefined)[]): number | null {
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (finite.length === 0) return null;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

export type SpecialCategory = 'P1' | 'P2' | 'R1' | 'S1';

/**
 * P1 = mean(norm ttft_p50_ms, norm load_ms)
 * P2 = mean(norm decode_tps, norm prefill_tps, norm depth_retention)
 * R1 = mean(norm vram_headroom, norm gpu_offload)
 * S1 = mean(norm format_error_rate, norm failure_rate, norm pass_hat_k, norm score_stddev)
 * N/A entries are skipped.
 */
export function categoryScoreFromMetrics(
  category: SpecialCategory,
  normalized: Record<string, number | null>,
): number | null {
  switch (category) {
    case 'P1':
      return meanSkippingNA([normalized['ttft_p50_ms'], normalized['load_ms']]);
    case 'P2':
      return meanSkippingNA([normalized['decode_tps'], normalized['prefill_tps'], normalized['depth_retention']]);
    case 'R1':
      return meanSkippingNA([normalized['vram_headroom'], normalized['gpu_offload']]);
    case 'S1':
      return meanSkippingNA([
        normalized['format_error_rate'],
        normalized['failure_rate'],
        normalized['pass_hat_k'],
        normalized['score_stddev'],
      ]);
  }
}
