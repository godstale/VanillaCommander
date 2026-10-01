/**
 * Minimum detectable difference (95% z) for a proportion at sample size n:
 * 1.96 * sqrt(p * (1-p) / n). The wizard shows it as "+/-x%p".
 * Returns NaN for n <= 0.
 */
export function detectableDiff(n: number, p = 0.5): number {
  if (!Number.isFinite(n) || n <= 0) return NaN;
  if (!Number.isFinite(p) || p < 0 || p > 1) return NaN;
  return 1.96 * Math.sqrt((p * (1 - p)) / n);
}
