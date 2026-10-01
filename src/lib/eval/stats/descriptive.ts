export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return percentile(xs, 50);
}

/**
 * Percentile with linear interpolation between closest ranks.
 * p is in [0, 100]. rank = (p/100) * (n-1) on the sorted array.
 */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  if (!Number.isFinite(p)) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const clamped = Math.min(Math.max(p, 0), 100);
  const rank = (clamped / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Population standard deviation (divides by n; single value yields 0).
 * Empty input yields NaN.
 */
export function stddev(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const m = mean(xs);
  let acc = 0;
  for (const x of xs) acc += (x - m) * (x - m);
  return Math.sqrt(acc / xs.length);
}
