/**
 * Binomial coefficient C(n, k) via multiplicative accumulation
 * (avoids factorial overflow for large n).
 * Returns 0 when k < 0 or k > n; C(n, 0) = 1.
 */
export function comb(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k)) return NaN;
  if (k < 0 || k > n || n < 0) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  let acc = 1;
  for (let i = 1; i <= kk; i++) {
    acc = (acc * (n - kk + i)) / i;
  }
  return acc;
}

/**
 * pass@k (unbiased estimator, Chen et al. 2021): 1 - C(n-c,k)/C(n,k).
 * n = samples generated, c = correct count, k = draws.
 * Returns NaN when n < k (caller maps to N/A).
 */
export function passAtK(n: number, c: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(c) || !Number.isInteger(k)) return NaN;
  if (n <= 0 || k <= 0 || c < 0 || c > n) return NaN;
  if (n < k) return NaN;
  return 1 - comb(n - c, k) / comb(n, k);
}

/**
 * pass^@k (all-k-correct rate, e.g. reliability across epochs):
 * C(c,k)/C(n,k). Returns NaN when n < k.
 */
export function passHatK(n: number, c: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(c) || !Number.isInteger(k)) return NaN;
  if (n <= 0 || k <= 0 || c < 0 || c > n) return NaN;
  if (n < k) return NaN;
  return comb(c, k) / comb(n, k);
}
