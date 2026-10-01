#!/usr/bin/env node
// Shared helpers for Fortress public eval-pack converters (P10-24).
// All converters are deterministic: every random choice flows from mulberry32(SEED).
// Network calls go to official origins only (huggingface.co / raw.githubusercontent.com).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEED = 20260925;
export const CONVERTER_VERSION = '1.0.0';
export const DOWNLOAD_DATE = '2026-09-25';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..');
export const EVALS_ROOT = join(REPO_ROOT, 'src-tauri', 'resources', 'evals');

const DS_SERVER = 'https://datasets-server.huggingface.co';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function fetchJson(url, { tries = 8, baseDelayMs = 4000 } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (attempt === tries - 1) {
      throw new Error(`fetch failed ${res.status} ${url}`);
    }
    await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
  }
  throw new Error(`unreachable: ${url}`);
}

export async function fetchBytes(url, { tries = 8, baseDelayMs = 4000 } = {}) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt === tries - 1) {
      throw new Error(`fetch failed ${res.status} ${url}`);
    }
    await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
  }
  throw new Error(`unreachable: ${url}`);
}

// Paginated read of every row of a datasets-server split. Returns rows in
// original order. Polite delay between pages to avoid rate limiting.
export async function fetchAllDsRows(dataset, config, split, { page = 100, delayMs = 1500 } = {}) {
  const rows = [];
  let offset = 0;
  let total = -1;
  for (;;) {
    const url = `${DS_SERVER}/rows?dataset=${dataset}&config=${config}&split=${split}&offset=${offset}&length=${page}`;
    const body = await fetchJson(url);
    if (!body.rows || body.rows.length === 0) break;
    if (total === -1) total = body.num_rows_total;
    for (const r of body.rows) rows.push(r.row);
    offset += body.rows.length;
    if (offset >= total) break;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { rows, total };
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export function writeText(path, text) {
  writeFileSync(path, text.replace(/\r\n/g, '\n'), 'utf8');
}

export function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeJsonl(path, samples) {
  writeText(path, `${samples.map((s) => JSON.stringify(s)).join('\n')}\n`);
}

export function writeManifest(packId, manifest) {
  const dir = join(EVALS_ROOT, packId);
  ensureDir(dir);
  writeJson(join(dir, 'manifest.json'), manifest);
  return dir;
}

export function writeLicense(packId, lines) {
  writeText(join(EVALS_ROOT, packId, 'LICENSE.md'), `${lines.join('\n')}\n`);
}

// Tags 10 fixed-seed samples per pack with the `reliability` tag.
export function tagReliability(samples, seed = SEED, count = 10) {
  const rng = mulberry32(seed);
  const order = shuffleInPlace(samples.map((_, i) => i), rng);
  const picked = new Set(order.slice(0, Math.min(count, samples.length)));
  for (const i of picked) {
    const tags = samples[i].tags ?? [];
    if (!tags.includes('reliability')) tags.push('reliability');
    samples[i].tags = tags;
  }
  return picked.size;
}

export function assertUniqueIds(samples, packId) {
  const seen = new Set();
  for (const s of samples) {
    if (seen.has(s.id)) throw new Error(`${packId}: duplicate sample id ${s.id}`);
    seen.add(s.id);
  }
}

export function metricAccuracy(baseline = 0) {
  return {
    id: 'accuracy',
    description: { ko: '정확도', en: 'Accuracy' },
    source: 'score',
    aggregation: 'mean',
    lowerIsBetter: false,
    scoreType: 'binary',
    range: { min: 0, max: 1 },
    normalization: { kind: 'baseline', baseline },
  };
}

export function log(...args) {
  console.log('[evals]', ...args);
}

// True when the module was invoked directly (`node scripts/evals/convert-x.mjs`).
export function isMain(metaUrl) {
  const arg = (process.argv[1] ?? '').replace(/\\/g, '/');
  try {
    const file = new URL(metaUrl).pathname;
    return arg.endsWith(file) || file.endsWith(arg.slice(arg.lastIndexOf('/')));
  } catch {
    return false;
  }
}
