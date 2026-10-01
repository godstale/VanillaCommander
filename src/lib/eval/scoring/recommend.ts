import { CATEGORY_META } from '../constants';
import { pairedBootstrapDiff } from '../stats/bootstrap';
import type { EvalAggregateRow, EvalProfile } from '../types';

export interface ConstraintViolation {
  metric: string;
  op: '>=' | '<=';
  value: number;
  actual: number | null;
}

export interface Recommendation {
  eligible: string[];
  violations: Record<string, ConstraintViolation[]>;
  /** Pareto-optimal (max (Q+A)/2 vs max P) among eligible candidates. */
  pareto: string[];
  picks: { best?: string; fast?: string; quality?: string };
  /** Rank groups: connected components of indistinguishable pairs, ordered by composite. */
  groups: string[][];
}

/**
 * Canonical key for an unordered candidate pair in an indistinguishability set.
 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

export interface RecommendOptions {
  /**
   * Pair keys (see pairKey) whose paired mean-difference CI contains 0,
   * i.e. the two candidates are statistically indistinguishable.
   * When absent but `sampleScores` is given, it is computed internally
   * with pairedBootstrapDiff; when both are absent every pair is treated
   * as distinguishable (fast pick is then omitted).
   */
  indistinguishable?: Set<string>;
  /**
   * Per-candidate per-sample scores (candidateId -> sampleKey -> score),
   * e.g. composite contributions or a headline accuracy, used to derive
   * indistinguishability via paired bootstrap.
   */
  sampleScores?: Map<string, Map<string, number>>;
  bootstrapOpts?: { iterations?: number; seed?: number; alpha?: number };
}

function compositeOf(aggregates: EvalAggregateRow[], candidateId: string): number | null {
  const row = aggregates.find((r) => r.candidateId === candidateId && r.level === 'composite');
  return row?.normalized ?? null;
}

function dimensionOf(aggregates: EvalAggregateRow[], candidateId: string, dim: string): number | null {
  const row = aggregates.find((r) => r.candidateId === candidateId && r.level === 'dimension' && r.key === dim);
  return row?.normalized ?? null;
}

function constraintActual(
  aggregates: EvalAggregateRow[],
  candidateId: string,
  metric: string,
): number | null {
  if ((Object.keys(CATEGORY_META) as string[]).includes(metric)) {
    const row = aggregates.find(
      (r) => r.candidateId === candidateId && r.level === 'category' && r.key === metric,
    );
    return row?.normalized ?? null;
  }
  const own = aggregates.filter(
    (r) => r.candidateId === candidateId && r.level === 'metric' && r.key === `@all:${metric}`,
  );
  if (own.length > 0) return own[0].raw;
  const packRaws = aggregates.filter(
    (r) => r.candidateId === candidateId && r.level === 'metric' && r.key.endsWith(`:${metric}`),
  );
  const vals = packRaws.map((r) => r.raw).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function computeIndistinguishable(
  candidateIds: string[],
  opts: RecommendOptions | undefined,
): Set<string> {
  if (opts?.indistinguishable) return opts.indistinguishable;
  const out = new Set<string>();
  const scores = opts?.sampleScores;
  if (!scores) return out;
  for (let i = 0; i < candidateIds.length; i++) {
    for (let j = i + 1; j < candidateIds.length; j++) {
      const a = scores.get(candidateIds[i]);
      const b = scores.get(candidateIds[j]);
      if (!a || !b) continue;
      const diff = pairedBootstrapDiff(a, b, opts?.bootstrapOpts);
      if (
        Number.isFinite(diff.low) &&
        Number.isFinite(diff.high) &&
        diff.low <= 0 &&
        diff.high >= 0
      ) {
        out.add(pairKey(candidateIds[i], candidateIds[j]));
      }
    }
  }
  return out;
}

/**
 * Recommend candidates from aggregate rows.
 *
 * - eligible: candidates satisfying every profile constraint
 *   (missing data counts as a violation).
 * - pareto: eligible candidates on the ((Q+A)/2, P) frontier.
 * - best: eligible candidate with the highest composite.
 * - fast: pareto candidate (other than best) with the highest P that is
 *   indistinguishable from best; omitted when evidence is unavailable.
 * - quality: pareto candidate (other than best) with the highest (Q+A)/2.
 * - groups: indistinguishable-pair connected components over all ranked
 *   candidates, ordered by composite descending.
 */
export function recommend(
  aggregates: EvalAggregateRow[],
  candidates: { id: string }[],
  profile: EvalProfile,
  options?: RecommendOptions,
): Recommendation {
  const ids = candidates.map((c) => c.id);
  const violations: Record<string, ConstraintViolation[]> = {};
  const eligible: string[] = [];
  for (const id of ids) {
    const list: ConstraintViolation[] = [];
    for (const c of profile.constraints) {
      const actual = constraintActual(aggregates, id, c.metric);
      const ok =
        actual !== null && (c.op === '>=' ? actual >= c.value : actual <= c.value);
      if (!ok) list.push({ metric: c.metric, op: c.op, value: c.value, actual });
    }
    violations[id] = list;
    if (list.length === 0) eligible.push(id);
  }

  const qa = (id: string): number | null => {
    const q = dimensionOf(aggregates, id, 'Q');
    const a = dimensionOf(aggregates, id, 'A');
    if (q === null || a === null) return null;
    return (q + a) / 2;
  };
  const pOf = (id: string): number | null => dimensionOf(aggregates, id, 'P');

  const pareto = eligible.filter((id) => {
    const qaX = qa(id);
    const pX = pOf(id);
    if (qaX === null || pX === null) return false;
    return !eligible.some((other) => {
      if (other === id) return false;
      const qaY = qa(other);
      const pY = pOf(other);
      if (qaY === null || pY === null) return false;
      return (qaY > qaX && pY >= pX) || (qaY >= qaX && pY > pX);
    });
  });

  const byComposite = [...eligible].sort(
    (x, y) => (compositeOf(aggregates, y) ?? Number.NEGATIVE_INFINITY) - (compositeOf(aggregates, x) ?? Number.NEGATIVE_INFINITY),
  );
  const best = byComposite[0];

  const indistinguishable = computeIndistinguishable(ids, options);
  let fast: string | undefined;
  if (best !== undefined) {
    const contenders = pareto
      .filter((id) => id !== best && pOf(id) !== null)
      .sort((x, y) => (pOf(y) ?? 0) - (pOf(x) ?? 0));
    for (const c of contenders) {
      if (indistinguishable.has(pairKey(best, c))) {
        fast = c;
        break;
      }
    }
  }

  let quality: string | undefined;
  if (best !== undefined) {
    const contenders = pareto
      .filter((id) => id !== best && qa(id) !== null)
      .sort((x, y) => (qa(y) ?? 0) - (qa(x) ?? 0));
    quality = contenders[0];
  }

  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) ?? root;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const key of indistinguishable) {
    const [x, y] = key.split('||');
    if (!parent.has(x) || !parent.has(y)) continue;
    parent.set(find(x), find(y));
  }
  const rankedAll = [...ids].sort(
    (x, y) => (compositeOf(aggregates, y) ?? Number.NEGATIVE_INFINITY) - (compositeOf(aggregates, x) ?? Number.NEGATIVE_INFINITY),
  );
  const groupsByRoot = new Map<string, string[]>();
  for (const id of rankedAll) {
    const root = find(id);
    const g = groupsByRoot.get(root);
    if (g) g.push(id);
    else groupsByRoot.set(root, [id]);
  }
  const groups = [...groupsByRoot.values()].sort(
    (a, b) => (compositeOf(aggregates, b[0]) ?? Number.NEGATIVE_INFINITY) - (compositeOf(aggregates, a[0]) ?? Number.NEGATIVE_INFINITY),
  );

  return { eligible, violations, pareto, picks: { best, fast, quality }, groups };
}
