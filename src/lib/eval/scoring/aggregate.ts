import { ANCHORS_V1, CATEGORY_META, type AnchorSpec } from '../constants';
import { mulberry32 } from '../stats/random';
import { mean, percentile } from '../stats/descriptive';
import { fitBradleyTerry } from '../stats/bradleyTerry';
import type {
  AggregateLevel,
  CandidateSnapshot,
  EvalAggregateRow,
  EvalCategoryId,
  EvalDimension,
  EvalPackManifest,
  EvalProfile,
  EvalRunConfig,
  EvalScoreRow,
  EvalTrialRow,
  HardwareFingerprint,
  MetricSpec,
  PackKind,
} from '../types';
import {
  computeCandidateMetrics,
  computeMetrics,
  type ComputedMetric,
} from './metrics';
import {
  categoryScoreFromMetrics,
  meanSkippingNA,
  normalizeMetricValue,
  type SpecialCategory,
} from './normalize';

export interface AggregateCandidate {
  id: string;
  label: string;
  snapshot?: CandidateSnapshot;
  loadMs: number | null;
}

export interface AggregateArenaVote {
  a: string;
  b: string;
  /** Caller maps arena 'both_bad' to 'tie'. */
  winner: 'a' | 'b' | 'tie';
}

export interface AggregateInput {
  runId: string;
  config: EvalRunConfig;
  candidates: AggregateCandidate[];
  trials: EvalTrialRow[];
  scores: EvalScoreRow[];
  packs: EvalPackManifest[];
  hardware: HardwareFingerprint | null;
  arena?: AggregateArenaVote[];
  sampleClusters?: Record<string, string>;
  /** Bootstrap seed override (default: config.options.sampleOrderSeed). */
  seed?: number;
  compositeIterations?: number;
}

export interface AggregateOutput {
  rows: EvalAggregateRow[];
  coverage: Record<string, number>;
}

const SPECIAL_CATEGORIES: SpecialCategory[] = ['P1', 'P2', 'R1', 'S1'];

/** Profile anchorOverrides carry only {zero, full}; base curve/dir are kept. */
function mergeAnchors(overrides: Record<string, { zero: number; full: number }>): Record<string, AnchorSpec> {
  const merged: Record<string, AnchorSpec> = { ...ANCHORS_V1 };
  for (const [id, o] of Object.entries(overrides)) {
    const base = merged[id];
    if (base) merged[id] = { ...base, zero: o.zero, full: o.full };
  }
  return merged;
}

function resampleMeanWithRng(values: number[], clusters: (string | undefined)[], rng: () => number): number {
  if (clusters.some((c) => c !== undefined)) {
    const byCluster = new Map<string, number[]>();
    for (let i = 0; i < values.length; i++) {
      const key = clusters[i] ?? `item:${i}`;
      const g = byCluster.get(key);
      if (g) g.push(values[i]);
      else byCluster.set(key, [values[i]]);
    }
    const ids = [...byCluster.keys()];
    let sum = 0;
    let count = 0;
    for (let c = 0; c < ids.length; c++) {
      const g = byCluster.get(ids[Math.floor(rng() * ids.length)]) ?? [];
      for (const v of g) {
        sum += v;
        count += 1;
      }
    }
    return count > 0 ? sum / count : NaN;
  }
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[Math.floor(rng() * values.length)];
  return values.length > 0 ? sum / values.length : NaN;
}

interface PackContributor {
  packId: string;
  category: EvalCategoryId;
  weight: number;
  metrics: {
    sampleValues: number[];
    clusters: (string | undefined)[];
    normalize: (raw: number) => number | null;
  }[];
}

export function aggregateRun(input: AggregateInput): AggregateOutput {
  const profile = input.config.profile;
  const seed = input.seed ?? input.config.options.sampleOrderSeed ?? 42;
  const anchors = mergeAnchors(profile.anchorOverrides);
  const computedAt = new Date().toISOString();
  const specByPackMetric = new Map<string, MetricSpec>();
  for (const p of input.packs) {
    for (const m of p.metrics) specByPackMetric.set(`${p.id}::${m.id}`, m);
  }
  const packKinds: Record<string, PackKind> = {};
  for (const p of input.packs) packKinds[p.id] = p.kind;

  const computed = computeMetrics(input.trials, input.scores, input.packs, {
    reliabilityEpochs: input.config.options.reliabilityEpochs,
    sampleClusters: input.sampleClusters,
  });
  const byCandidatePack = new Map<string, ComputedMetric[]>();
  for (const cm of computed) {
    const key = `${cm.candidateId}::${cm.packId}`;
    const arr = byCandidatePack.get(key);
    if (arr) arr.push(cm);
    else byCandidatePack.set(key, [cm]);
  }

  const arenaScore = computeArenaScores(input.arena ?? [], input.candidates.map((c) => c.id), profile.arena);

  const rows: EvalAggregateRow[] = [];
  const coverage: Record<string, number> = {};
  const push = (
    candidateId: string,
    level: AggregateLevel,
    key: string,
    raw: number | null,
    normalized: number | null,
    n: number | null,
    ciLow: number | null = null,
    ciHigh: number | null = null,
  ): void => {
    rows.push({
      runId: input.runId,
      candidateId,
      level,
      key,
      raw: raw !== null && Number.isFinite(raw) ? raw : null,
      normalized: normalized !== null && Number.isFinite(normalized) ? normalized : null,
      ciLow,
      ciHigh,
      n,
      anchorsVersion: profile.anchorsVersion,
      computedAt,
    });
  };

  for (const cand of input.candidates) {
    const candMetrics = computeCandidateMetrics(input.trials, input.scores, cand.id, {
      loadMs: cand.loadMs,
      vramTotalMb: input.hardware?.vramTotalMb ?? null,
      packKinds,
      reliabilityEpochs: input.config.options.reliabilityEpochs,
    });
    const normCand: Record<string, number | null> = {};
    for (const [metricId, mv] of Object.entries(candMetrics)) {
      const norm = normalizeMetricValue(metricId, mv.value, null, { anchors });
      normCand[metricId] = norm;
      push(cand.id, 'metric', `@all:${metricId}`, mv.value, norm, mv.n);
    }

    const packScores = new Map<string, { score: number | null; n: number }>();
    const contributors: PackContributor[] = [];
    for (const pack of input.packs) {
      const cms = byCandidatePack.get(`${cand.id}::${pack.id}`) ?? [];
      if (cms.length === 0) continue;
      const normed: number[] = [];
      const metricsForBoot: PackContributor['metrics'] = [];
      let n = 0;
      for (const cm of cms) {
        n = Math.max(n, cm.n);
        const spec = specByPackMetric.get(`${pack.id}::${cm.metricId}`);
        if (spec && spec.countsTowardComposite === false) continue;
        const norm = normalizeMetricValue(cm.metricId, cm.value, spec ?? null, { anchors });
        if (norm !== null) normed.push(norm);
        if (cm.sampleValues.length > 0) {
          metricsForBoot.push({
            sampleValues: cm.sampleValues,
            clusters: cm.clusters,
            normalize: (raw: number) => normalizeMetricValue(cm.metricId, raw, spec ?? null, { anchors }),
          });
        }
      }
      const score = meanSkippingNA(normed);
      packScores.set(pack.id, { score, n });
      push(cand.id, 'pack', pack.id, null, score, n || null);
      if (score !== null && metricsForBoot.length > 0) {
        const ci = bootstrapPack(metricsForBoot, seed + hashString(`${cand.id}::${pack.id}`));
        const row = rows[rows.length - 1];
        row.ciLow = ci.low;
        row.ciHigh = ci.high;
        contributors.push({ packId: pack.id, category: pack.category, weight: n || 1, metrics: metricsForBoot });
      }
    }

    const categoryScores = new Map<EvalCategoryId, number | null>();
    const byCategory = new Map<EvalCategoryId, { packId: string; score: number; weight: number }[]>();
    for (const c of contributors) {
      const ps = packScores.get(c.packId);
      if (!ps || ps.score === null) continue;
      const arr = byCategory.get(c.category);
      const entry = { packId: c.packId, score: ps.score, weight: c.weight };
      if (arr) arr.push(entry);
      else byCategory.set(c.category, [entry]);
    }
    const categories = [...new Set<EvalCategoryId>([
      ...input.packs.map((p) => p.category),
      ...SPECIAL_CATEGORIES,
      'Q7' as EvalCategoryId,
    ])];
    for (const cat of categories) {
      let score: number | null;
      let n: number | null = null;
      if (SPECIAL_CATEGORIES.includes(cat as SpecialCategory)) {
        score = categoryScoreFromMetrics(cat as SpecialCategory, normCand);
      } else if (cat === 'Q7' && arenaScore) {
        score = arenaScore[cand.id] ?? null;
      } else {
        const entries = byCategory.get(cat) ?? [];
        if (entries.length === 0) {
          score = null;
        } else {
          const totalW = entries.reduce((a, e) => a + e.weight, 0);
          score = totalW > 0 ? entries.reduce((a, e) => a + e.score * e.weight, 0) / totalW : null;
          n = entries.reduce((a, e) => a + e.weight, 0);
        }
      }
      categoryScores.set(cat, score);
      push(cand.id, 'category', cat, null, score, n);
    }

    const dimScores = new Map<EvalDimension, number | null>();
    const dims: EvalDimension[] = ['Q', 'A', 'P', 'R', 'S'];
    for (const dim of dims) {
      const cats = (Object.keys(CATEGORY_META) as EvalCategoryId[]).filter(
        (c) => CATEGORY_META[c].dimension === dim && CATEGORY_META[c].countsTowardComposite,
      );
      let num = 0;
      let den = 0;
      for (const cat of cats) {
        const s = categoryScores.get(cat);
        if (s === null || s === undefined) continue;
        const w = profile.categoryWeights[cat] ?? 1;
        num += s * w;
        den += w;
      }
      const dimScore = den > 0 ? num / den : null;
      dimScores.set(dim, dimScore);
      push(cand.id, 'dimension', dim, null, dimScore, null);
    }

    let cNum = 0;
    let cDen = 0;
    for (const dim of dims) {
      const s = dimScores.get(dim);
      if (s === null || s === undefined) continue;
      const w = profile.dimensionWeights[dim] ?? 0;
      cNum += s * w;
      cDen += w;
    }
    const composite = cDen > 0 ? cNum / cDen : null;
    const ci = bootstrapComposite(
      contributors,
      categoryScores,
      normCand,
      profile,
      arenaScore,
      cand.id,
      seed + hashString(cand.id),
      input.compositeIterations,
    );
    push(cand.id, 'composite', 'composite', null, composite, null, ci?.low ?? null, ci?.high ?? null);

    const totalW = dims.reduce((a, d) => a + (profile.dimensionWeights[d] ?? 0), 0);
    const coveredW = dims.reduce(
      (a, d) => a + (dimScores.get(d) !== null && dimScores.get(d) !== undefined ? (profile.dimensionWeights[d] ?? 0) : 0),
      0,
    );
    coverage[cand.id] = totalW > 0 ? coveredW / totalW : 1;
  }

  return { rows, coverage };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function bootstrapPack(
  metrics: PackContributor['metrics'],
  seed: number,
  iterations = 1000,
): { low: number | null; high: number | null } {
  const rng = mulberry32(seed);
  const reps: number[] = [];
  for (let iter = 0; iter < iterations; iter++) {
    const vals: number[] = [];
    for (const m of metrics) {
      const r = resampleMeanWithRng(m.sampleValues, m.clusters, rng);
      const norm = m.normalize(r);
      if (norm !== null) vals.push(norm);
    }
    if (vals.length > 0) reps.push(mean(vals));
  }
  if (reps.length === 0) return { low: null, high: null };
  return { low: percentile(reps, 2.5), high: percentile(reps, 97.5) };
}

function recomputeComposite(
  packScores: Map<string, number>,
  packContribs: PackContributor[],
  fixedCategories: Map<EvalCategoryId, number | null>,
  normCand: Record<string, number | null>,
  arenaScore: Record<string, number> | null,
  candidateId: string,
  profile: EvalProfile,
): number | null {
  const byCat = new Map<EvalCategoryId, { score: number; weight: number }[]>();
  for (const c of packContribs) {
    const s = packScores.get(c.packId);
    if (s === undefined) continue;
    const arr = byCat.get(c.category);
    if (arr) arr.push({ score: s, weight: c.weight });
    else byCat.set(c.category, [{ score: s, weight: c.weight }]);
  }
  const catScores = new Map<EvalCategoryId, number | null>();
  const cats = new Set<EvalCategoryId>([...fixedCategories.keys()]);
  for (const cat of cats) {
    if (SPECIAL_CATEGORIES.includes(cat as SpecialCategory)) {
      catScores.set(cat, categoryScoreFromMetrics(cat as SpecialCategory, normCand));
    } else if (cat === 'Q7' && arenaScore) {
      catScores.set(cat, arenaScore[candidateId] ?? null);
    } else {
      const entries = byCat.get(cat) ?? [];
      if (entries.length === 0) catScores.set(cat, fixedCategories.get(cat) ?? null);
      else {
        const totalW = entries.reduce((a, e) => a + e.weight, 0);
        catScores.set(cat, totalW > 0 ? entries.reduce((a, e) => a + e.score * e.weight, 0) / totalW : null);
      }
    }
  }
  const dims: EvalDimension[] = ['Q', 'A', 'P', 'R', 'S'];
  let cNum = 0;
  let cDen = 0;
  for (const dim of dims) {
    const catsInDim = (Object.keys(CATEGORY_META) as EvalCategoryId[]).filter(
      (c) => CATEGORY_META[c].dimension === dim && CATEGORY_META[c].countsTowardComposite,
    );
    let num = 0;
    let den = 0;
    for (const cat of catsInDim) {
      const s = catScores.get(cat);
      if (s === null || s === undefined) continue;
      const w = profile.categoryWeights[cat] ?? 1;
      num += s * w;
      den += w;
    }
    if (den <= 0) continue;
    const w = profile.dimensionWeights[dim] ?? 0;
    cNum += (num / den) * w;
    cDen += w;
  }
  return cDen > 0 ? cNum / cDen : null;
}

function bootstrapComposite(
  contributors: PackContributor[],
  categoryScores: Map<EvalCategoryId, number | null>,
  normCand: Record<string, number | null>,
  profile: EvalProfile,
  arenaScore: Record<string, number> | null,
  candidateId: string,
  seed: number,
  overrideIterations: number | undefined,
): { low: number | null; high: number | null } | null {
  if (contributors.length === 0) return null;
  const totalSamples = contributors.reduce(
    (a, c) => a + c.metrics.reduce((x, m) => x + m.sampleValues.length, 0),
    0,
  );
  let iterations = overrideIterations ?? 1000;
  if (totalSamples * iterations > 30000000) {
    iterations = Math.max(200, Math.floor(30000000 / Math.max(totalSamples, 1)));
  }
  const rng = mulberry32(seed);
  const reps: number[] = [];
  for (let iter = 0; iter < iterations; iter++) {
    const packScores = new Map<string, number>();
    for (const c of contributors) {
      const vals: number[] = [];
      for (const m of c.metrics) {
        const r = resampleMeanWithRng(m.sampleValues, m.clusters, rng);
        const norm = m.normalize(r);
        if (norm !== null) vals.push(norm);
      }
      if (vals.length > 0) packScores.set(c.packId, mean(vals));
    }
    const comp = recomputeComposite(packScores, contributors, categoryScores, normCand, arenaScore, candidateId, profile);
    if (comp !== null && Number.isFinite(comp)) reps.push(comp);
  }
  if (reps.length === 0) return null;
  return { low: percentile(reps, 2.5), high: percentile(reps, 97.5) };
}

function computeArenaScores(
  votes: AggregateArenaVote[],
  candidateIds: string[],
  arena: { enabled: boolean; minVotes: number },
): Record<string, number> | null {
  if (!arena.enabled || votes.length === 0) return null;
  const inRun = new Set(candidateIds);
  const relevant = votes.filter((v) => inRun.has(v.a) && inRun.has(v.b));
  if (relevant.length < arena.minVotes) return null;
  const fit = fitBradleyTerry(relevant.map((v) => ({ a: v.a, b: v.b, winner: v.winner })));
  if (!fit) return null;
  const present = candidateIds.filter((id) => fit.display[id] !== undefined);
  if (present.length === 0) return null;
  const vals = present.map((id) => fit.display[id]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const out: Record<string, number> = {};
  for (const id of present) {
    out[id] = max === min ? 50 : ((fit.display[id] - min) / (max - min)) * 100;
  }
  return out;
}
