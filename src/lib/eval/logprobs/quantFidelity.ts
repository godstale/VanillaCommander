/**
 * Quantization-fidelity math over logprob traces (P10-14, Q8 report layer).
 *
 * Compares a reference trace (R, full-precision model) with a quantized trace
 * (Q, same base model) on the same prompt. All metrics here are report-only:
 * no anchors, no composite contribution.
 */
import { mean, median } from '../stats/descriptive';
import type { LogprobCandidate, LogprobTrace } from './client';

/** Length of the shared token prefix (first divergence position). */
export function commonPrefix(tokensA: string[], tokensB: string[]): number {
  const n = Math.min(tokensA.length, tokensB.length);
  let d = 0;
  while (d < n && tokensA[d] === tokensB[d]) d += 1;
  return d;
}

// NUL-prefixed so the residual bucket key can never collide with a real token
// (decoded tokens routinely carry leading spaces, e.g. ' A').
const RESIDUAL_KEY = '\u0000residual';

/**
 * KL(p || q) over the union of both top lists plus one residual bucket that
 * holds each side's unlisted mass (max(0, 1 - sum(exp(logprob)))). Additive
 * smoothing with `eps` keeps every bucket positive; buckets are renormalized
 * before the sum. Zero-mass p buckets contribute 0 by convention; positive
 * p mass against zero q mass yields +Infinity.
 */
export function klDivergence(
  p: LogprobCandidate[],
  q: LogprobCandidate[],
  eps = 1e-6,
): number {
  const pm = new Map<string, number>();
  for (const c of p) pm.set(c.token, Math.exp(c.logprob));
  const qm = new Map<string, number>();
  for (const c of q) qm.set(c.token, Math.exp(c.logprob));
  const sum = (m: Map<string, number>): number => {
    let s = 0;
    for (const v of m.values()) s += v;
    return s;
  };
  const keys = new Set<string>([...pm.keys(), ...qm.keys(), RESIDUAL_KEY]);
  const rawP = new Map<string, number>();
  const rawQ = new Map<string, number>();
  for (const k of keys) {
    if (k === RESIDUAL_KEY) {
      rawP.set(k, Math.max(0, 1 - sum(pm)));
      rawQ.set(k, Math.max(0, 1 - sum(qm)));
    } else {
      rawP.set(k, pm.get(k) ?? 0);
      rawQ.set(k, qm.get(k) ?? 0);
    }
  }
  const norm = (raw: Map<string, number>): Map<string, number> => {
    let total = eps * raw.size;
    for (const v of raw.values()) total += v;
    const out = new Map<string, number>();
    for (const [k, v] of raw) out.set(k, (v + eps) / total);
    return out;
  };
  const pn = norm(rawP);
  const qn = norm(rawQ);
  let kl = 0;
  for (const k of keys) {
    const pv = pn.get(k) ?? 0;
    const qv = qn.get(k) ?? 0;
    if (pv <= 0) continue;
    if (qv <= 0) return Number.POSITIVE_INFINITY;
    kl += pv * Math.log(pv / qv);
  }
  return kl;
}

/** Highest-logprob token of a top list (order-independent). */
export function top1(top: LogprobCandidate[]): string | null {
  let best: LogprobCandidate | null = null;
  for (const c of top) {
    if (!best || c.logprob > best.logprob) best = c;
  }
  return best?.token ?? null;
}

function alignedLength(traceR: LogprobTrace, traceQ: LogprobTrace): number {
  return Math.min(
    traceR.tokens.length,
    traceQ.tokens.length,
    traceR.topLogprobs.length,
    traceQ.topLogprobs.length,
  );
}

/**
 * Fraction of aligned positions whose top-1 token agrees. Positions after a
 * sampled-token divergence are still compared (the signal of interest for
 * fidelity); at temperature 0 the sampled token is the argmax, so agreement
 * inside the common prefix is 1 by construction and the metric measures how
 * far agreement persists. Empty alignment yields 0.
 */
export function top1Agreement(traceR: LogprobTrace, traceQ: LogprobTrace): number {
  const n = alignedLength(traceR, traceQ);
  if (n === 0) return 0;
  let hits = 0;
  for (let i = 0; i < n; i += 1) {
    if (top1(traceR.topLogprobs[i]) === top1(traceQ.topLogprobs[i])) hits += 1;
  }
  return hits / n;
}

/**
 * Mean per-position KL over the common-prefix positions only (identical
 * conditioning history, hence comparable). Null when the prefix is empty or
 * the traces have no aligned positions.
 */
export function meanKld(traceR: LogprobTrace, traceQ: LogprobTrace): number | null {
  const n = alignedLength(traceR, traceQ);
  const d = Math.min(commonPrefix(traceR.tokens, traceQ.tokens), n);
  if (d === 0) return null;
  const vals: number[] = [];
  for (let i = 0; i < d; i += 1) {
    vals.push(klDivergence(traceR.topLogprobs[i], traceQ.topLogprobs[i]));
  }
  return mean(vals);
}

export interface QuantPairResult {
  /** First divergence position (common-prefix length over sampled tokens). */
  divergencePos: number;
  /** Mean per-position KL over the common prefix; null when prefix is empty. */
  meanKld: number | null;
  /** Top-1 agreement fraction over all aligned positions. */
  top1Agreement: number;
  /** Number of aligned positions compared. */
  positions: number;
}

export function pairFidelity(traceR: LogprobTrace, traceQ: LogprobTrace): QuantPairResult {
  const n = alignedLength(traceR, traceQ);
  return {
    divergencePos: Math.min(commonPrefix(traceR.tokens, traceQ.tokens), n),
    meanKld: meanKld(traceR, traceQ),
    top1Agreement: top1Agreement(traceR, traceQ),
    positions: n,
  };
}

/** Report-only metric ids for Q8 quantization fidelity (no anchors). */
export const QUANT_FIDELITY_METRIC_IDS = [
  'mean_kld',
  'top1_agreement',
  'divergence_pos_median',
] as const;

export interface QuantFidelitySummary {
  mean_kld: number | null;
  top1_agreement: number | null;
  divergence_pos_median: number | null;
  pairs: number;
}

/** Aggregate per-pair results into the report-only Q8 metrics. */
export function summarizeQuantPairs(pairs: QuantPairResult[]): QuantFidelitySummary {
  if (pairs.length === 0) {
    return { mean_kld: null, top1_agreement: null, divergence_pos_median: null, pairs: 0 };
  }
  const klds = pairs
    .map((r) => r.meanKld)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  return {
    mean_kld: klds.length > 0 ? mean(klds) : null,
    top1_agreement: mean(pairs.map((r) => r.top1Agreement)),
    divergence_pos_median: median(pairs.map((r) => r.divergencePos)),
    pairs: pairs.length,
  };
}
