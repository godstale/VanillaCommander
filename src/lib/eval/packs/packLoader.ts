import {
  EvalPackManifestSchema,
  EvalSampleSchema,
  type EvalPackManifest,
  type EvalSample,
  type PackDiagnostic,
  type PackScope,
} from '../types';
import { canonicalJson, sha256Hex } from './hash';
import type { PackFs } from './packFs';
import { mulberry32, shuffleInPlace } from '../stats/random';
import { getGenerator } from './generators/index';
import './generators/longContext';
import './generators/perfProbe';
import { parseJsonl } from './sources/jsonl';
import { convertKmmluCsv } from './sources/kmmluCsv';

export interface LoadedPackRef {
  scope: PackScope;
  manifest: EvalPackManifest;
  contentHash: string;
  diagnostics: PackDiagnostic[];
}

export interface LoadedPack extends LoadedPackRef {
  samples: EvalSample[];
}

export interface PackListError {
  scope: PackScope;
  packId: string;
  error: string;
}

const SCOPE_PRIORITY: Record<PackScope, number> = { project: 0, user: 1, builtin: 2 };

// Fixed seed shared with the public-pack converters (scripts/evals/lib.mjs).
const RELIABILITY_SEED = 20260925;
const RELIABILITY_COUNT = 10;

function tagReliabilitySamples(samples: EvalSample[]): void {
  const rng = mulberry32(RELIABILITY_SEED);
  const order = shuffleInPlace(
    samples.map((_, i) => i),
    rng,
  );
  for (const i of order.slice(0, Math.min(RELIABILITY_COUNT, samples.length))) {
    const tags = samples[i].tags ?? [];
    if (!tags.includes('reliability')) tags.push('reliability');
    samples[i].tags = tags;
  }
}

function parseJson(text: string, what: string): { value: unknown; error: string | null } {
  try {
    return { value: JSON.parse(text) as unknown, error: null };
  } catch (err) {
    return { value: null, error: `${what}: ${err instanceof Error ? err.message : 'invalid JSON'}` };
  }
}

async function hashForManifest(
  manifest: EvalPackManifest,
  sourceBytes: string,
): Promise<string> {
  return sha256Hex(`${canonicalJson(manifest)}\n${sourceBytes}`);
}

export async function listPacks(
  fs: PackFs,
  workspaceRoot?: string,
): Promise<{ refs: LoadedPackRef[]; errors: PackListError[] }> {
  const refs: LoadedPackRef[] = [];
  const errors: PackListError[] = [];
  const seen = new Map<string, PackScope>();
  const scopes: PackScope[] = ['project', 'user', 'builtin'];

  for (const scope of scopes) {
    let items: Array<{ packId: string; manifestText: string }>;
    try {
      items = await fs.list(scope, workspaceRoot);
    } catch (err) {
      errors.push({
        scope,
        packId: '*',
        error: err instanceof Error ? err.message : 'list failed',
      });
      continue;
    }
    for (const item of items) {
      const { value, error } = parseJson(item.manifestText, 'manifest.json');
      if (error || value === null) {
        errors.push({ scope, packId: item.packId, error: error ?? 'empty manifest' });
        continue;
      }
      const parsed = EvalPackManifestSchema.safeParse(value);
      if (!parsed.success) {
        errors.push({
          scope,
          packId: item.packId,
          error: `manifest validation: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
        });
        continue;
      }
      const manifest = parsed.data;
      if (manifest.id !== item.packId) {
        errors.push({
          scope,
          packId: item.packId,
          error: `manifest id '${manifest.id}' does not match folder '${item.packId}'`,
        });
        continue;
      }
      const winner = seen.get(manifest.id);
      if (winner !== undefined) {
        // Lower priority scope is shadowed; record on the winning ref later.
        void winner;
        const existing = refs.find((r) => r.manifest.id === manifest.id);
        existing?.diagnostics.push({
          sampleId: null,
          message: `shadowed ${scope} pack '${manifest.id}'`,
        });
        continue;
      }
      seen.set(manifest.id, scope);
      // Hash needs source bytes; computed fully in loadPack. For the ref list,
      // use a manifest-only hash so listing stays fast; loadPack verifies.
      const contentHash = await hashForManifest(manifest, item.manifestText);
      refs.push({
        scope,
        manifest: scope === 'builtin' ? { ...manifest, trusted: true } : manifest,
        contentHash,
        diagnostics: [],
      });
    }
  }
  refs.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  return { refs, errors };
}

async function loadSamples(
  fs: PackFs,
  ref: LoadedPackRef,
  workspaceRoot?: string,
): Promise<{ samples: EvalSample[]; sourceBytes: string; diagnostics: PackDiagnostic[] }> {
  const { manifest, scope } = ref;
  const diagnostics: PackDiagnostic[] = [];
  const samples: EvalSample[] = [];
  let sourceBytes: string;

  if (manifest.source.type === 'jsonl') {
    const text = await fs.read(scope, manifest.id, manifest.source.file, workspaceRoot);
    sourceBytes = text;
    const { lines, diagnostics: jsonlDiag } = parseJsonl(text);
    for (const d of jsonlDiag) {
      diagnostics.push({ sampleId: null, message: `${manifest.source.file}:${d.line}: ${d.message}` });
    }
    for (const line of lines) {
      const parsed = EvalSampleSchema.safeParse(line.value);
      if (!parsed.success) {
        diagnostics.push({
          sampleId: null,
          message: `${manifest.source.file}:${line.line}: sample validation: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
        });
        continue;
      }
      samples.push(parsed.data);
    }
  } else if (manifest.source.type === 'kmmlu-csv') {
    const parts: string[] = [];
    for (const file of manifest.source.files) {
      const text = await fs.read(scope, manifest.id, file, workspaceRoot);
      parts.push(text);
      const converted = convertKmmluCsv(file, text);
      samples.push(...converted.samples);
      diagnostics.push(...converted.diagnostics);
    }
    sourceBytes = parts.join('\n');
    // CSV-backed samples carry no baked tags, so the loader applies the
    // pack-level deterministic reliability tagging here (P10-24): exactly 10
    // fixed-seed samples per pack, matching the jsonl converters.
    tagReliabilitySamples(samples);
  } else {
    const gen = getGenerator(manifest.source.generator);
    const generated = await gen(manifest.source.params, {});
    samples.push(...generated);
    sourceBytes = canonicalJson(manifest.source.params);
  }
  return { samples, sourceBytes, diagnostics };
}

export async function loadPack(
  fs: PackFs,
  ref: LoadedPackRef,
  workspaceRoot?: string,
): Promise<LoadedPack> {
  const { samples: raw, sourceBytes, diagnostics } = await loadSamples(fs, ref, workspaceRoot);
  const seen = new Set<string>();
  const samples: EvalSample[] = [];
  for (const s of raw) {
    if (seen.has(s.id)) {
      diagnostics.push({ sampleId: s.id, message: `duplicate sample id '${s.id}'` });
      continue;
    }
    seen.add(s.id);
    samples.push(s);
  }
  const contentHash = await hashForManifest(ref.manifest, sourceBytes);
  return { ...ref, contentHash, diagnostics: [...ref.diagnostics, ...diagnostics], samples };
}

export function diagnosticsForSample(
  pack: LoadedPack,
  sampleId: string,
): PackDiagnostic[] {
  return pack.diagnostics.filter((d) => d.sampleId === sampleId);
}

export function scopePriority(scope: PackScope): number {
  return SCOPE_PRIORITY[scope];
}
