/**
 * Rank an array with averaged ranks for ties (1-based).
 */
function rankAverageTies(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(xs.length);
  let pos = 0;
  while (pos < order.length) {
    let end = pos;
    while (end + 1 < order.length && order[end + 1].v === order[pos].v) end += 1;
    const avg = (pos + 1 + end + 1) / 2;
    for (let k = pos; k <= end; k++) ranks[order[k].i] = avg;
    pos = end + 1;
  }
  return ranks;
}

/**
 * Spearman rank correlation (ρ), or null when it is undefined
 * (fewer than 3 pairs or a constant rank vector).
 */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = rankAverageTies(xs);
  const ry = rankAverageTies(ys);
  const n = xs.length;
  const mx = rx.reduce((a, v) => a + v, 0) / n;
  const my = ry.reduce((a, v) => a + v, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - mx;
    const dy = ry[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

export interface LengthBiasInput {
  trialId: string;
  outputLength: number;
  judgeValue: number;
}

export interface LengthBiasResult {
  n: number;
  rho: number | null;
  /** True when |ρ| >= 0.5: judge scores track answer length. */
  warn: boolean;
}

/**
 * Length-bias check: correlate output length with judge score.
 * |ρ| >= 0.5 raises the warn flag (report-only; never mutates scores).
 */
export function lengthBias(items: LengthBiasInput[]): LengthBiasResult {
  const finite = items.filter(
    (it) => Number.isFinite(it.outputLength) && Number.isFinite(it.judgeValue),
  );
  const rho = spearman(
    finite.map((it) => it.outputLength),
    finite.map((it) => it.judgeValue),
  );
  return { n: finite.length, rho, warn: rho !== null && Math.abs(rho) >= 0.5 };
}

export type AgreementFlag = 'ok' | 'low-trust' | 'insufficient-data';

export interface HumanAgreementResult {
  n: number;
  agreementRate: number | null;
  kappa: number | null;
  flag: AgreementFlag;
}

/**
 * Judge↔human agreement on binarized values (>= threshold counts as
 * correct). Needs >= 20 pairs for a trustworthy κ; κ < 0.4 flags
 * the judge as 'low-trust'.
 */
export function judgeHumanAgreement(
  pairs: Array<{ judgeValue: number; humanValue: number }>,
  threshold = 0.5,
): HumanAgreementResult {
  const finite = pairs.filter(
    (p) => Number.isFinite(p.judgeValue) && Number.isFinite(p.humanValue),
  );
  const n = finite.length;
  if (n === 0) {
    return { n, agreementRate: null, kappa: null, flag: 'insufficient-data' };
  }
  const jb = finite.map((p) => (p.judgeValue >= threshold ? 1 : 0));
  const hb = finite.map((p) => (p.humanValue >= threshold ? 1 : 0));
  let agree = 0;
  let j1 = 0;
  let h1 = 0;
  for (let i = 0; i < n; i++) {
    if (jb[i] === hb[i]) agree += 1;
    j1 += jb[i];
    h1 += hb[i];
  }
  const agreementRate = agree / n;
  if (n < 20) {
    return { n, agreementRate, kappa: null, flag: 'insufficient-data' };
  }
  const pj1 = j1 / n;
  const ph1 = h1 / n;
  const pe = pj1 * ph1 + (1 - pj1) * (1 - ph1);
  const kappa = pe === 1 ? (agreementRate === 1 ? 1 : 0) : (agreementRate - pe) / (1 - pe);
  return { n, agreementRate, kappa, flag: kappa < 0.4 ? 'low-trust' : 'ok' };
}
