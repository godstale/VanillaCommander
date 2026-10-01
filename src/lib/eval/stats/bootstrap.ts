import { mulberry32 } from './random';
import { percentile } from './descriptive';

export interface BootstrapOptions {
  iterations?: number;
  seed?: number;
  alpha?: number;
  /** Parallel to `values`: resample whole clusters instead of individual items. */
  clusters?: (string | undefined)[];
}

export interface ConfidenceInterval {
  low: number;
  high: number;
  estimate: number;
}

function resolveOpts(opts: BootstrapOptions | undefined): {
  iterations: number;
  seed: number;
  alpha: number;
} {
  return {
    iterations: opts?.iterations ?? 1000,
    seed: opts?.seed ?? 42,
    alpha: opts?.alpha ?? 0.05,
  };
}

/**
 * Nonparametric bootstrap CI for an arbitrary statistic.
 * With `clusters`, resamples whole clusters with replacement
 * (samples sharing a clusterId move together).
 */
export function bootstrapCI(
  values: number[],
  stat: (xs: number[]) => number,
  opts?: BootstrapOptions,
): ConfidenceInterval {
  const { iterations, seed, alpha } = resolveOpts(opts);
  const estimate = values.length > 0 ? stat(values) : NaN;
  if (values.length === 0 || iterations <= 0) {
    return { low: NaN, high: NaN, estimate };
  }
  const rng = mulberry32(seed);
  const clusters = opts?.clusters;
  let clusterIds: string[] | null = null;
  let byCluster: Map<string, number[]> | null = null;
  if (clusters && clusters.length === values.length) {
    byCluster = new Map<string, number[]>();
    for (let i = 0; i < values.length; i++) {
      const key = clusters[i] ?? `\u0000item:${i}`;
      const group = byCluster.get(key);
      if (group) group.push(values[i]);
      else byCluster.set(key, [values[i]]);
    }
    clusterIds = [...byCluster.keys()];
  }
  const replicates: number[] = [];
  for (let iter = 0; iter < iterations; iter++) {
    let resample: number[];
    if (byCluster && clusterIds) {
      resample = [];
      for (let c = 0; c < clusterIds.length; c++) {
        const picked = clusterIds[Math.floor(rng() * clusterIds.length)];
        const group = byCluster.get(picked);
        if (group) for (const v of group) resample.push(v);
      }
    } else {
      resample = new Array<number>(values.length);
      for (let i = 0; i < values.length; i++) {
        resample[i] = values[Math.floor(rng() * values.length)];
      }
    }
    const s = stat(resample);
    if (Number.isFinite(s)) replicates.push(s);
  }
  if (replicates.length === 0) return { low: NaN, high: NaN, estimate };
  return {
    low: percentile(replicates, (alpha / 2) * 100),
    high: percentile(replicates, (1 - alpha / 2) * 100),
    estimate,
  };
}

export interface PairedDiffOptions {
  iterations?: number;
  seed?: number;
  alpha?: number;
}

export interface PairedDiffResult extends ConfidenceInterval {
  n: number;
}

function meanOf(xs: number[]): number {
  let sum = 0;
  for (const x of xs) sum += x;
  return xs.length > 0 ? sum / xs.length : NaN;
}

/**
 * Bootstrap CI for the paired mean difference (a - b).
 * Only keys present in both maps are used; pairs are resampled together.
 */
export function pairedBootstrapDiff(
  a: Map<string, number>,
  b: Map<string, number>,
  opts?: PairedDiffOptions,
): PairedDiffResult {
  const iterations = opts?.iterations ?? 1000;
  const seed = opts?.seed ?? 42;
  const alpha = opts?.alpha ?? 0.05;
  const diffs: number[] = [];
  for (const [key, av] of a) {
    const bv = b.get(key);
    if (bv !== undefined && Number.isFinite(av) && Number.isFinite(bv)) {
      diffs.push(av - bv);
    }
  }
  const n = diffs.length;
  const estimate = meanOf(diffs);
  if (n === 0 || iterations <= 0) return { low: NaN, high: NaN, estimate, n };
  const rng = mulberry32(seed);
  const replicates: number[] = [];
  for (let iter = 0; iter < iterations; iter++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += diffs[Math.floor(rng() * n)];
    replicates.push(sum / n);
  }
  return {
    low: percentile(replicates, (alpha / 2) * 100),
    high: percentile(replicates, (1 - alpha / 2) * 100),
    estimate,
    n,
  };
}
