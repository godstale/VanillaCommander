// FAB-C pack validation (P10-23).
//
// Covers the five packs owned by this task: fab-longctx, fab-perf-probe,
// fab-ko-writing, fab-code-js, fab-quant-probe. Disk files are validated with
// the zod schemas plus the real pack loader, generators are checked for
// determinism, and every scorer that already exists (includes) is executed
// against all of its samples.
//
// Deferred, asserted structurally only:
// - llm_judge_rubric needs the Judge integration (P10-13); the run wizard
//   blocks Judge-gated packs until a Judge is configured.
// - code_exec needs the JS sandbox runner (P10-12).
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  EvalPackManifestSchema,
  EvalSampleSchema,
  type EvalPackManifest,
  type EvalSample,
} from '../types';
import { createMemoryPackFs } from './packFs';
import { listPacks, loadPack } from './packLoader';
import { getScorer } from '../scorers/index';
import { getGenerator } from './generators/index';
import './generators/longContext';
import './generators/perfProbe';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const EVALS_DIR = join(ROOT, 'src-tauri', 'resources', 'evals');

const PACK_IDS = [
  'fab-longctx',
  'fab-perf-probe',
  'fab-ko-writing',
  'fab-code-js',
  'fab-quant-probe',
] as const;

type PackId = (typeof PACK_IDS)[number];

const ReferenceLineSchema = z.object({ id: z.string(), reference: z.string() });

async function readText(packId: string, rel: string): Promise<string | null> {
  try {
    return await readFile(join(EVALS_DIR, packId, rel), 'utf8');
  } catch {
    return null;
  }
}

interface DiskPack {
  manifest: EvalPackManifest;
  samples: EvalSample[];
  references: Array<{ id: string; reference: string }>;
}

// Load a pack exactly as the app would: manifest through zod, samples
// through the real loader (jsonl file or registered generator).
async function loadDiskPack(packId: PackId): Promise<DiskPack> {
  const manifestText = await readText(packId, 'manifest.json');
  expect(manifestText, `${packId}/manifest.json exists`).not.toBeNull();
  const manifest = EvalPackManifestSchema.parse(JSON.parse(manifestText as string));
  expect(manifest.id, 'manifest id matches folder').toBe(packId);

  const files: Record<string, string> = { 'manifest.json': manifestText as string };
  for (const rel of ['samples.jsonl', 'reference.jsonl']) {
    const text = await readText(packId, rel);
    if (text !== null) files[rel] = text;
  }
  const fs = createMemoryPackFs({ builtin: { [packId]: files } });
  const { refs, errors } = await listPacks(fs);
  expect(errors, `${packId} lists without errors`).toEqual([]);
  const ref = refs.find((r) => r.manifest.id === packId);
  expect(ref, `${packId} ref found`).toBeDefined();
  const pack = await loadPack(fs, ref!);
  expect(pack.diagnostics, `${packId} loads without diagnostics`).toEqual([]);

  const references: Array<{ id: string; reference: string }> = [];
  const refText = files['reference.jsonl'];
  if (refText !== undefined) {
    for (const line of refText.split('\n')) {
      if (line.trim() === '') continue;
      references.push(ReferenceLineSchema.parse(JSON.parse(line)));
    }
  }
  return { manifest, samples: pack.samples, references };
}

function scorerSignal(): { signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

describe('fab-c pack manifests', () => {
  it.each(PACK_IDS)('%s has version 1.0.0 and sane tiers', async (packId) => {
    const { manifest, samples } = await loadDiskPack(packId);
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.tiers.smoke).toBeGreaterThan(0);
    expect(manifest.tiers.standard).toBeGreaterThanOrEqual(manifest.tiers.smoke);
    const ids = samples.map((s) => s.id);
    expect(new Set(ids).size, `${packId} ids unique`).toBe(ids.length);
  });
});

describe('fab-longctx (Q6)', () => {
  it('manifest declares the long-context generator and tiers', async () => {
    const { manifest } = await loadDiskPack('fab-longctx');
    expect(manifest.kind).toBe('long_context');
    expect(manifest.category).toBe('Q6');
    expect(manifest.source.type).toBe('generator');
    if (manifest.source.type !== 'generator') throw new Error('unreachable');
    expect(manifest.source.generator).toBe('long-context-v1');
    // Smoke tier is exactly the 3 requested probes (2k/8k/32k x 0.5 x niah-single x ko x 1).
    expect(manifest.tiers.smoke).toBe(3);
    expect(manifest.tiers.standard).toBe(84);
    expect(manifest.tiers.full).toBe('all');
    expect(manifest.metrics.map((m) => m.id)).toEqual(
      expect.arrayContaining(['accuracy', 'effective_context_tokens']),
    );
    expect(manifest.scorers.some((s) => s.type === 'includes')).toBe(true);
  });

  it('generates the full 336-sample grid', async () => {
    const { samples } = await loadDiskPack('fab-longctx');
    // 7 lengths x 3 depths x 4 tasks x 2 langs x perCell 2.
    expect(samples).toHaveLength(336);
    for (const s of samples) {
      expect(s.id).toMatch(/^L\d+-D\d+-(niah-single|niah-multikey|niah-multivalue|var-trace)-(ko|en)-[12]$/);
      expect(typeof s.input === 'string' && s.input.length > 0).toBe(true);
      const input = s.input as string;
      const targets = Array.isArray(s.target) ? s.target : [s.target];
      if (s.id.includes('var-trace')) {
        // The answer is computed, not quoted: replay the scattered chain.
        const start = /X1 = (\d+)\./.exec(input);
        expect(start, `${s.id} declares X1`).not.toBeNull();
        let value = Number((start as RegExpExecArray)[1]);
        const steps = [...input.matchAll(/X([2-5]) = X\d ([+-]) (\d+)\./g)];
        expect(steps.map((m) => m[1]), `${s.id} scatters X2..X5`).toEqual(['2', '3', '4', '5']);
        for (const m of steps) {
          value = m[2] === '+' ? value + Number(m[3]) : value - Number(m[3]);
        }
        expect(String(value), `${s.id} chain resolves to target`).toBe(String(s.target));
      } else {
        for (const t of targets) {
          expect(input, `${s.id} input contains target`).toContain(String(t));
        }
      }
    }
  }, 60000);

  it('is deterministic for identical params', async () => {
    const gen = getGenerator('long-context-v1');
    const params = {
      lengths: [2048, 4096],
      depths: [0.5],
      tasks: ['niah-single', 'var-trace'],
      perCell: 1,
      lang: ['ko'],
      seed: 20260925,
    };
    const first = await gen(params, {});
    const second = await gen(params, {});
    expect(first.map((s) => s.id)).toEqual(second.map((s) => s.id));
    expect(first.map((s) => s.input)).toEqual(second.map((s) => s.input));
    expect(first.map((s) => s.target)).toEqual(second.map((s) => s.target));
  }, 60000);

  it('scores 100% via the existing includes scorer on target text', async () => {
    const { samples } = await loadDiskPack('fab-longctx');
    const scorer = getScorer('includes');
    const manifest = EvalPackManifestSchema.parse(
      JSON.parse((await readText('fab-longctx', 'manifest.json')) as string),
    );
    for (const sample of samples) {
      const spec = sample.scorers?.[0];
      expect(spec?.type, `${sample.id} carries an includes spec`).toBe('includes');
      const targets = Array.isArray(sample.target) ? sample.target : [sample.target];
      const result = await scorer.score(
        {
          sample,
          pack: manifest,
          outputText: targets.map(String).join(' '),
          toolCalls: [],
        },
        spec?.options ?? {},
        scorerSignal(),
      );
      expect(result.verdict, `${sample.id} includes`).toBe('correct');
    }
    // niah-multivalue requires every value (mode all).
    const multi = samples.filter((s) => s.id.includes('niah-multivalue'));
    expect(multi.length).toBeGreaterThan(0);
    for (const s of multi) {
      expect(s.scorers?.[0].options).toMatchObject({ mode: 'all' });
    }
  }, 60000);
});

describe('fab-perf-probe (P1/P2)', () => {
  it('manifest declares the perf generator with trial-field metrics and no scorers', async () => {
    const { manifest } = await loadDiskPack('fab-perf-probe');
    expect(manifest.kind).toBe('perf_probe');
    expect(manifest.source.type).toBe('generator');
    if (manifest.source.type !== 'generator') throw new Error('unreachable');
    expect(manifest.source.generator).toBe('perf-probe-v1');
    expect(manifest.tiers).toMatchObject({ smoke: 3, standard: 6, full: 'all' });
    expect(manifest.scorers).toEqual([]);
    for (const m of manifest.metrics) {
      expect(m.source).toBe('trial_field');
    }
    expect(manifest.metrics.map((m) => m.id)).toEqual(
      expect.arrayContaining(['decode_tps', 'prefill_tps', 'ttft_p50_ms']),
    );
  });

  it('maps tiers to scenarios (smoke S1/S3/S5, standard S1-S6, full all)', async () => {
    const gen = getGenerator('perf-probe-v1');
    const smoke = await gen({ tier: 'smoke' }, {});
    const standard = await gen({ tier: 'standard' }, {});
    const full = await gen({ tier: 'full' }, {});
    expect(smoke.map((s) => s.id)).toEqual(['S1', 'S3', 'S5']);
    expect(standard.map((s) => s.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    expect(full.map((s) => s.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    // Deterministic: same params twice give identical samples.
    const again = await gen({ tier: 'full' }, {});
    expect(again.map((s) => s.input)).toEqual(full.map((s) => s.input));
    // Declared token loads, incl. depth scenarios derived from context size.
    const byId = new Map(full.map((s) => [s.id, s]));
    expect(byId.get('S1')?.perf).toMatchObject({ inputTokens: 64, outputTokens: 128 });
    expect(byId.get('S6')?.perf).toMatchObject({ inputTokens: 4096, outputTokens: 1024 });
    expect(byId.get('S7')?.perf).toMatchObject({
      inputTokens: Math.round(8192 * 0.5),
      outputTokens: 128,
      depthRatio: 0.5,
    });
    expect(byId.get('S8')?.perf).toMatchObject({
      inputTokens: Math.round(8192 * 0.9),
      outputTokens: 128,
      depthRatio: 0.9,
    });
    for (const s of full) {
      expect(s.scorers ?? [], `${s.id} has no scorers`).toEqual([]);
    }
  });
});

describe('fab-ko-writing (Q4)', () => {
  it('holds 20 samples stratified 5 genres x 4', async () => {
    const { manifest, samples } = await loadDiskPack('fab-ko-writing');
    expect(manifest.kind).toBe('single_turn');
    expect(manifest.category).toBe('Q4');
    expect(manifest.stratifyBy).toBe('genre');
    expect(manifest.tiers).toMatchObject({ smoke: 5, standard: 20, full: 20 });
    expect(samples).toHaveLength(20);
    const byGenre = new Map<string, number>();
    for (const s of samples) {
      const genre = s.metadata?.['genre'];
      expect(typeof genre).toBe('string');
      byGenre.set(String(genre), (byGenre.get(String(genre)) ?? 0) + 1);
      expect(s.rubric, `${s.id} has a rubric`).toBeTruthy();
      expect(s.reference, `${s.id} has a reference`).toBeTruthy();
    }
    expect([...byGenre.entries()].sort()).toEqual([
      ['email', 4],
      ['meeting', 4],
      ['notice', 4],
      ['report', 4],
      ['tech', 4],
    ]);
  });

  it('reference.jsonl mirrors sample references', async () => {
    const { samples, references } = await loadDiskPack('fab-ko-writing');
    expect(references).toHaveLength(20);
    const byId = new Map(samples.map((s) => [s.id, s]));
    for (const r of references) {
      const sample = byId.get(r.id);
      expect(sample, `reference ${r.id} matches a sample`).toBeDefined();
      expect(r.reference.length).toBeGreaterThan(0);
      expect(r.reference).toBe(sample!.reference);
    }
  });

  it('deterministic checks pass 100% on the reference answers', async () => {
    const { manifest, samples, references } = await loadDiskPack('fab-ko-writing');
    const byId = new Map(references.map((r) => [r.id, r.reference]));
    // NOTE: Judge-gated pack — the run wizard blocks execution without a
    // configured Judge (P10-13), so llm_judge_rubric specs are asserted
    // structurally only; the co-located deterministic check really runs.
    for (const sample of samples) {
      const specs = sample.scorers ?? [];
      expect(specs.some((s) => s.type === 'llm_judge_rubric')).toBe(true);
      const check = specs.find((s) => s.type !== 'llm_judge_rubric');
      expect(check, `${sample.id} has a deterministic check`).toBeDefined();
      expect(check!.weight).toBe(0.2);
      const scorer = getScorer(check!.type);
      const result = await scorer.score(
        { sample, pack: manifest, outputText: byId.get(sample.id) ?? '', toolCalls: [] },
        check!.options ?? {},
        scorerSignal(),
      );
      expect(result.verdict, `${sample.id} deterministic check`).toBe('correct');
    }
  });
});

describe('fab-code-js (Q5)', () => {
  it('holds 40 tasks across string/array/date-numeric/algo with executable assertions', async () => {
    const { manifest, samples } = await loadDiskPack('fab-code-js');
    expect(manifest.kind).toBe('single_turn');
    expect(manifest.category).toBe('Q5');
    expect(manifest.tiers).toMatchObject({ smoke: 10, standard: 40, full: 40 });
    expect(manifest.requires.codeRuntime).toBe('js');
    expect(manifest.systemPrompt).toContain('```js');
    expect(manifest.metrics.map((m) => m.id)).toEqual(
      expect.arrayContaining(['pass_at_1', 'pass_at_5']),
    );
    expect(samples).toHaveLength(40);
    const byCat = new Map<string, number>();
    for (const s of samples) {
      const cat = String(s.metadata?.['category']);
      byCat.set(cat, (byCat.get(cat) ?? 0) + 1);
      expect(s.code?.language).toBe('js');
      expect(s.code?.entryPoint).toBe('solve');
      const stmts = (s.code?.tests ?? '').split('\n').filter((l) => l.trim() !== '');
      // 6-12 assertions including boundary cases per task spec.
      expect(stmts.length, `${s.id} assertion count`).toBeGreaterThanOrEqual(6);
      expect(stmts.length, `${s.id} assertion count`).toBeLessThanOrEqual(12);
      expect(s.scorers?.some((sp) => sp.type === 'code_exec')).toBe(true);
    }
    expect([...byCat.entries()].sort()).toEqual([
      ['algo', 8],
      ['array-object', 12],
      ['date-numeric', 8],
      ['string', 12],
    ]);
  });

  it('reference.jsonl holds one reference solution per sample (code_exec deferred to P10-12)', async () => {
    // code_exec does not exist yet, so no sample is executed here; the
    // reference solutions were verified offline against every assertion.
    const { samples, references } = await loadDiskPack('fab-code-js');
    expect(references).toHaveLength(40);
    const byId = new Map(samples.map((s) => [s.id, s]));
    for (const r of references) {
      expect(byId.has(r.id), `reference ${r.id} matches a sample`).toBe(true);
      expect(r.reference).toContain('function solve');
    }
  });
});

describe('fab-quant-probe (Q8)', () => {
  it('holds 30 short instructions, ko 15 / en 15, with no scorers', async () => {
    const { manifest, samples } = await loadDiskPack('fab-quant-probe');
    expect(manifest.kind).toBe('logprob_trace');
    expect(manifest.category).toBe('Q8');
    expect(manifest.tiers).toMatchObject({ smoke: 10, standard: 30, full: 30 });
    expect(manifest.requires.logprobs).toBe(true);
    expect(manifest.scorers).toEqual([]);
    expect(samples).toHaveLength(30);
    const ko = samples.filter((s) => s.metadata?.['lang'] === 'ko');
    const en = samples.filter((s) => s.metadata?.['lang'] === 'en');
    expect(ko).toHaveLength(15);
    expect(en).toHaveLength(15);
    for (const s of samples) {
      expect(typeof s.input === 'string' && (s.input as string).length > 0).toBe(true);
      expect(s.scorers ?? [], `${s.id} has no scorers`).toEqual([]);
    }
  });
});

describe('fab-c sample schema spot checks', () => {
  it('every sample on disk parses as EvalSample', async () => {
    for (const packId of PACK_IDS) {
      const text = await readText(packId, 'samples.jsonl');
      if (packId === 'fab-longctx' || packId === 'fab-perf-probe') {
        expect(text, `${packId} is generator-backed (no samples.jsonl)`).toBeNull();
        continue;
      }
      const lines = (text as string).split('\n').filter((l) => l.trim() !== '');
      for (const line of lines) {
        EvalSampleSchema.parse(JSON.parse(line));
      }
    }
  });
});
