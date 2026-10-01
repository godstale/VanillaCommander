import { mulberry32, shuffleInPlace } from '../stats/random';
import type { EvalPackManifest, EvalSample, TierName } from '../types';

function stratumKey(sample: EvalSample, stratifyBy: string | undefined): string {
  if (!stratifyBy) return '__all__';
  const v = sample.metadata?.[stratifyBy];
  if (v === undefined) return '__missing__';
  return String(v);
}

export function selectSampleIds(
  samples: EvalSample[],
  tier: TierName,
  manifest: EvalPackManifest,
  seed: number,
): string[] {
  const tierCount = manifest.tiers[tier];
  const total = tierCount === 'all' ? samples.length : Math.min(tierCount, samples.length);
  if (total <= 0) return [];

  const groups = new Map<string, EvalSample[]>();
  for (const s of samples) {
    const key = stratumKey(s, manifest.stratifyBy);
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }

  const rng = mulberry32(seed);
  const picked: EvalSample[] = [];
  if (groups.size <= 1 || manifest.stratifyBy === undefined) {
    const shuffled = shuffleInPlace([...samples], rng);
    return shuffled.slice(0, total).map((s) => s.id);
  }

  // Proportional allocation with at least 1 per stratum, then fix the total.
  const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const counts = new Map<string, number>();
  for (const [key, arr] of entries) {
    counts.set(key, Math.min(arr.length, Math.max(1, Math.round((total * arr.length) / samples.length))));
  }
  let sum = [...counts.values()].reduce((a, b) => a + b, 0);
  let i = 0;
  while (sum !== total && entries.length > 0) {
    const [key, arr] = entries[i % entries.length];
    const cur = counts.get(key) ?? 0;
    if (sum < total && cur < arr.length) {
      counts.set(key, cur + 1);
      sum += 1;
    } else if (sum > total && cur > 1) {
      counts.set(key, cur - 1);
      sum -= 1;
    }
    i += 1;
    if (i > entries.length * (total + samples.length + 8)) break;
  }

  for (const [key, arr] of entries) {
    const shuffled = shuffleInPlace([...arr], rng);
    picked.push(...shuffled.slice(0, counts.get(key) ?? 0));
  }
  const shuffledPicked = shuffleInPlace(picked, rng);
  return shuffledPicked.slice(0, total).map((s) => s.id);
}
