export interface WilsonInterval {
  low: number;
  high: number;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Wilson score interval for a binomial proportion.
 * successes/n is the observed rate; z=1.96 gives the 95% interval.
 * n <= 0 yields { low: 0, high: 1 } (no information).
 */
export function wilsonInterval(successes: number, n: number, z = 1.96): WilsonInterval {
  if (!Number.isFinite(successes) || !Number.isFinite(n) || n <= 0) {
    return { low: 0, high: 1 };
  }
  const s = Math.min(Math.max(successes, 0), n);
  const p = s / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const delta = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
  return { low: clamp01(center - delta), high: clamp01(center + delta) };
}
