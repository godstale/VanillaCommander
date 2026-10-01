import { mulberry32 } from './random';
import { percentile } from './descriptive';

export interface BradleyTerryMatch {
  a: string;
  b: string;
  /** 'tie' covers draws and both-bad votes (0.5 win each). */
  winner: 'a' | 'b' | 'tie';
}

export interface BradleyTerryResult {
  /** Raw strengths, normalized to geometric mean 1. */
  strengths: Record<string, number>;
  /** Elo-style display scores: 400*log10(strength) + 1000. */
  display: Record<string, number>;
  players: string[];
  games: Record<string, number>;
  iterations: number;
  converged: boolean;
}

const MAX_ITERATIONS = 200;
const TOLERANCE = 1e-6;

export function btDisplayScore(strength: number): number {
  if (!Number.isFinite(strength) || strength <= 0) return Number.NEGATIVE_INFINITY;
  return 400 * Math.log10(strength) + 1000;
}

function collectPlayers(matches: BradleyTerryMatch[]): string[] {
  const set = new Set<string>();
  for (const m of matches) {
    set.add(m.a);
    set.add(m.b);
  }
  return [...set].sort();
}

function isConnected(players: string[], matches: BradleyTerryMatch[]): boolean {
  if (players.length <= 1) return players.length === 1;
  const parent = new Map<string, string>();
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
  for (const p of players) parent.set(p, p);
  for (const m of matches) {
    const ra = find(m.a);
    const rb = find(m.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const root = find(players[0]);
  return players.every((p) => find(p) === root);
}

/**
 * Bradley-Terry strengths via the MM algorithm (Hunter 2004).
 * Ties count as 0.5 win for each side. Strengths are normalized
 * to geometric mean 1 each iteration. Returns null when the
 * comparison graph is disconnected (a player never faced the rest).
 */
export function fitBradleyTerry(matches: BradleyTerryMatch[]): BradleyTerryResult | null {
  const players = collectPlayers(matches);
  if (players.length === 0 || matches.length === 0) return null;
  if (!isConnected(players, matches)) return null;

  const index = new Map(players.map((p, i) => [p, i]));
  const count = players.length;
  const wins = new Array<number>(count).fill(0);
  const pairGames = new Map<string, number>();
  const games = new Array<number>(count).fill(0);
  const pairKey = (i: number, j: number) => (i < j ? `${i}:${j}` : `${j}:${i}`);

  for (const m of matches) {
    const i = index.get(m.a);
    const j = index.get(m.b);
    if (i === undefined || j === undefined || i === j) continue;
    const key = pairKey(i, j);
    pairGames.set(key, (pairGames.get(key) ?? 0) + 1);
    games[i] += 1;
    games[j] += 1;
    if (m.winner === 'a') wins[i] += 1;
    else if (m.winner === 'b') wins[j] += 1;
    else {
      wins[i] += 0.5;
      wins[j] += 0.5;
    }
  }

  let strengths = new Array<number>(count).fill(1);
  let iterations = 0;
  let converged = false;
  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    iterations = iter;
    const next = new Array<number>(count);
    for (let i = 0; i < count; i++) {
      let denom = 0;
      for (let j = 0; j < count; j++) {
        if (i === j) continue;
        const n = pairGames.get(pairKey(i, j)) ?? 0;
        if (n > 0) denom += n / (strengths[i] + strengths[j]);
      }
      next[i] = denom > 0 ? wins[i] / denom : strengths[i];
      if (!(next[i] > 0)) next[i] = 1e-12;
    }
    const logMean = next.reduce((acc, s) => acc + Math.log(s), 0) / count;
    const norm = Math.exp(logMean);
    let maxRel = 0;
    for (let i = 0; i < count; i++) {
      next[i] /= norm;
      const rel = Math.abs(next[i] - strengths[i]) / Math.max(strengths[i], 1e-12);
      if (rel > maxRel) maxRel = rel;
    }
    strengths = next;
    if (maxRel < TOLERANCE) {
      converged = true;
      break;
    }
  }

  const strengthsRec: Record<string, number> = {};
  const displayRec: Record<string, number> = {};
  const gamesRec: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    strengthsRec[players[i]] = strengths[i];
    displayRec[players[i]] = btDisplayScore(strengths[i]);
    gamesRec[players[i]] = games[i];
  }
  return { strengths: strengthsRec, display: displayRec, players, games: gamesRec, iterations, converged };
}

export interface BradleyTerryCIOptions {
  iterations?: number;
  seed?: number;
  alpha?: number;
}

/**
 * Bootstrap CI over display scores by resampling votes with replacement.
 * Returns null when the base fit is disconnected (null).
 */
export function bradleyTerryCI(
  matches: BradleyTerryMatch[],
  opts?: BradleyTerryCIOptions,
): Record<string, { low: number; high: number; estimate: number }> | null {
  const base = fitBradleyTerry(matches);
  if (!base) return null;
  const iterations = opts?.iterations ?? 1000;
  const seed = opts?.seed ?? 42;
  const alpha = opts?.alpha ?? 0.05;
  const rng = mulberry32(seed);
  const samples = new Map<string, number[]>();
  for (const p of base.players) samples.set(p, []);
  for (let iter = 0; iter < iterations; iter++) {
    const resample: BradleyTerryMatch[] = new Array(matches.length);
    for (let i = 0; i < matches.length; i++) {
      resample[i] = matches[Math.floor(rng() * matches.length)];
    }
    const fit = fitBradleyTerry(resample);
    if (!fit) continue;
    for (const p of base.players) {
      const d = fit.display[p];
      if (d !== undefined && Number.isFinite(d)) samples.get(p)?.push(d);
    }
  }
  const out: Record<string, { low: number; high: number; estimate: number }> = {};
  for (const p of base.players) {
    const vals = samples.get(p) ?? [];
    out[p] = {
      low: vals.length > 0 ? percentile(vals, (alpha / 2) * 100) : NaN,
      high: vals.length > 0 ? percentile(vals, (1 - alpha / 2) * 100) : NaN,
      estimate: base.display[p],
    };
  }
  return out;
}
