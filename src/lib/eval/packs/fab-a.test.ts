import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  EvalPackManifestSchema,
  EvalSampleSchema,
  type EvalPackManifest,
  type EvalSample,
  type ScorerSpec,
} from '../types';
import type { ScorerInput } from '../scorers/types';
import { combineSampleScore, getScorer } from '../scorers/index';
import { createMemoryPackFs } from './packFs';
import { listPacks, loadPack } from './packLoader';
import { selectSampleIds } from './sampling';

vi.mock('mermaid', () => ({
  default: {
    parse: vi.fn(async (code: string) => {
      if (code.includes('INVALID')) throw new Error('Parse error on line 1: bad syntax');
      return true;
    }),
  },
}));

const ctx = { signal: new AbortController().signal };

const ReferenceEntrySchema = z.object({
  id: z.string(),
  output: z.string().optional(),
  toolCalls: z
    .array(z.object({ name: z.string(), arguments: z.record(z.unknown()) }))
    .optional(),
});
type ReferenceEntry = z.infer<typeof ReferenceEntrySchema>;

interface FabPackSpec {
  packId: string;
  fullCount: number;
  smokeCount: number;
}

const PACKS: FabPackSpec[] = [
  { packId: 'fab-tools-select', fullCount: 60, smokeCount: 15 },
  { packId: 'fab-tools-relevance', fullCount: 40, smokeCount: 10 },
  { packId: 'fab-viz', fullCount: 30, smokeCount: 10 },
];

function readPackFile(packId: string, relPath: string): string {
  return readFileSync(
    path.join(process.cwd(), 'src-tauri', 'resources', 'evals', packId, relPath),
    'utf-8',
  );
}

function specsFor(sample: EvalSample, manifest: EvalPackManifest): ScorerSpec[] {
  return sample.scorers ?? manifest.scorers;
}

async function scoreReference(
  sample: EvalSample,
  manifest: EvalPackManifest,
  entry: ReferenceEntry,
): Promise<{ value: number; verdict: string }> {
  const specs = specsFor(sample, manifest);
  expect(specs.length).toBeGreaterThan(0);
  const input: ScorerInput = {
    sample,
    pack: manifest,
    outputText: entry.output ?? '',
    toolCalls: (entry.toolCalls ?? []).map((c) => ({
      name: c.name,
      arguments: c.arguments,
    })),
  };
  const results = [];
  for (const spec of specs) {
    const scorer = getScorer(spec.type);
    const result = await scorer.score(input, spec.options, ctx);
    results.push({ spec, result });
  }
  return combineSampleScore(results);
}

describe.each(PACKS)('fab-a pack $packId', ({ packId, fullCount, smokeCount }) => {
  it('manifest and samples validate, load cleanly, and cover tiers', async () => {
    const manifestText = readPackFile(packId, 'manifest.json');
    const samplesText = readPackFile(packId, 'samples.jsonl');
    const manifest = EvalPackManifestSchema.parse(JSON.parse(manifestText) as unknown);
    expect(manifest.id).toBe(packId);
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.source.type).toBe('jsonl');

    const fs = createMemoryPackFs({
      builtin: { [packId]: { 'manifest.json': manifestText, 'samples.jsonl': samplesText } },
    });
    const { refs, errors } = await listPacks(fs);
    expect(errors).toEqual([]);
    const ref = refs.find((r) => r.manifest.id === packId);
    expect(ref).toBeDefined();
    const pack = await loadPack(fs, ref!);
    expect(pack.diagnostics).toEqual([]);
    expect(pack.samples).toHaveLength(fullCount);
    expect(new Set(pack.samples.map((s) => s.id)).size).toBe(fullCount);
    expect(manifest.tiers.smoke).toBe(smokeCount);
    expect(selectSampleIds(pack.samples, 'smoke', pack.manifest, 42)).toHaveLength(smokeCount);
    if (manifest.stratifyBy) {
      for (const s of pack.samples) {
        expect(s.metadata?.[manifest.stratifyBy]).toBeDefined();
      }
    }
    // Every raw line must also pass the sample schema (loadPack parity check).
    for (const line of samplesText.split('\n')) {
      if (line.trim() === '') continue;
      EvalSampleSchema.parse(JSON.parse(line) as unknown);
    }
  });

  it('every reference entry scores 100% correct', async () => {
    const manifestText = readPackFile(packId, 'manifest.json');
    const samplesText = readPackFile(packId, 'samples.jsonl');
    const manifest = EvalPackManifestSchema.parse(JSON.parse(manifestText) as unknown);
    const fs = createMemoryPackFs({
      builtin: { [packId]: { 'manifest.json': manifestText, 'samples.jsonl': samplesText } },
    });
    const { refs } = await listPacks(fs);
    const pack = await loadPack(fs, refs.find((r) => r.manifest.id === packId)!);
    const byId = new Map(pack.samples.map((s) => [s.id, s]));

    const refText = readPackFile(packId, 'reference.jsonl');
    const entries: ReferenceEntry[] = [];
    for (const line of refText.split('\n')) {
      if (line.trim() === '') continue;
      entries.push(ReferenceEntrySchema.parse(JSON.parse(line) as unknown));
    }
    expect(entries).toHaveLength(fullCount);
    expect(new Set(entries.map((e) => e.id)).size).toBe(fullCount);

    for (const entry of entries) {
      const sample = byId.get(entry.id);
      expect(sample, `reference ${entry.id} has no sample`).toBeDefined();
      const combined = await scoreReference(sample!, manifest, entry);
      expect(combined.verdict, `reference ${entry.id}`).toBe('correct');
      expect(combined.value, `reference ${entry.id}`).toBe(1);
    }
  });
});
