import {
  EvalPackManifestSchema,
  EvalSampleSchema,
  type EvalCategoryId,
  type EvalPackManifest,
  type EvalSample,
  type ScorerSpec,
} from '../types';

// Shared helpers for P10-25 pack importers (Inspect / CSV / promptfoo / HF).

export const IMPORT_PACK_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

export function isValidPackId(id: string): boolean {
  return IMPORT_PACK_ID_RE.test(id);
}

export interface ImportManifestOptions {
  packId: string;
  title?: string;
  description?: string;
  licenseId?: string;
  sourceUrl?: string;
  category?: EvalCategoryId;
  scorers?: ScorerSpec[];
}

export function defaultAccuracyMetric(): EvalPackManifest['metrics'][number] {
  return {
    id: 'accuracy',
    description: { ko: '정확도', en: 'Accuracy' },
    source: 'score',
    aggregation: 'mean',
    lowerIsBetter: false,
    scoreType: 'binary',
    range: { min: 0, max: 1 },
    normalization: { kind: 'baseline', baseline: 0, ceiling: 1 },
    countsTowardComposite: true,
  };
}

export function buildImportManifest(opts: ImportManifestOptions): EvalPackManifest {
  const title = opts.title ?? opts.packId;
  const sampleCount = 0;
  return {
    schemaVersion: '1.0',
    id: opts.packId,
    version: '0.1.0',
    title: { ko: title, en: title },
    description: {
      ko: opts.description ?? `가져온 평가 팩 (${opts.packId})`,
      en: opts.description ?? `Imported eval pack (${opts.packId})`,
    },
    category: opts.category ?? 'Q9',
    lang: ['en'],
    license: {
      id: opts.licenseId ?? 'imported-unknown',
      source: opts.sourceUrl,
    },
    kind: 'single_turn',
    useAgentSystemPrompt: false,
    source: { type: 'jsonl', file: 'samples.jsonl' },
    scorers: opts.scorers ?? [{ type: 'exact', weight: 1, gate: false, options: {} }],
    metrics: [defaultAccuracyMetric()],
    tiers: {
      smoke: Math.max(1, Math.min(10, sampleCount || 10)),
      standard: Math.max(1, Math.min(100, sampleCount || 100)),
      full: 'all',
    },
    defaults: { timeoutSec: 180, maxTurns: 12, epochs: 1, circular: false },
    requires: { toolCalling: false, logprobs: false },
    trusted: false,
  };
}

/** Fill tier sample counts once the converted sample count is known. */
export function withTierCounts(
  manifest: EvalPackManifest,
  sampleCount: number,
): EvalPackManifest {
  if (sampleCount <= 0) return manifest;
  return {
    ...manifest,
    tiers: {
      smoke: Math.max(1, Math.min(10, sampleCount)),
      standard: Math.max(1, Math.min(100, sampleCount)),
      full: 'all',
    },
  };
}

export function samplesToJsonl(samples: EvalSample[]): string {
  return samples.map((s) => JSON.stringify(s)).join('\n') + (samples.length > 0 ? '\n' : '');
}

export interface ValidatedImportPack {
  manifest: EvalPackManifest;
  samples: EvalSample[];
  errors: string[];
}

/** Schema-validate a converter's output before any pack write. */
export function validateImportPack(
  manifest: unknown,
  samples: unknown[],
): ValidatedImportPack {
  const errors: string[] = [];
  const manifestParsed = EvalPackManifestSchema.safeParse(manifest);
  if (!manifestParsed.success) {
    const first = manifestParsed.error.issues[0];
    errors.push(`manifest: ${first?.path.join('.') ?? ''} ${first?.message ?? 'invalid'}`);
    throw new Error(`import manifest invalid: ${errors[0]}`);
  }
  const valid: EvalSample[] = [];
  samples.forEach((s, i) => {
    const parsed = EvalSampleSchema.safeParse(s);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      errors.push(
        `sample[${i}]: ${first?.path.join('.') ?? ''} ${first?.message ?? 'invalid'}`,
      );
      return;
    }
    valid.push(parsed.data);
  });
  return { manifest: manifestParsed.data, samples: valid, errors };
}

/**
 * GPQA-origin packs are detected by preset id/name containing 'gpqa'
 * (case-insensitive). Their sample bodies must be stripped from exports.
 */
export function isGpqaPack(packIdOrName: string): boolean {
  return packIdOrName.toLowerCase().includes('gpqa');
}

export const GPQA_REDACT_NOTE = 'gpqa-license: sample body stripped on export';
