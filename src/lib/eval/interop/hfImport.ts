import { evalDownloadFile } from '../ipc';
import { tauriPackFs } from '../packs/packFs';
import { parseJsonl } from '../packs/sources/jsonl';
import type { EvalCategoryId, EvalPackManifest, EvalSample } from '../types';
import { convertCsvImport, type CsvFieldMap } from './csvImport';
import { convertInspectJsonl } from './inspectImport';
import {
  buildImportManifest,
  isValidPackId,
  samplesToJsonl,
  validateImportPack,
  withTierCounts,
} from './draft';
import type { ImportPreset } from './importPresets';

// HuggingFace dataset -> user-scope pack writer.
//
// MERGE NOTE (P10-24): preset descriptors live in `./importPresets`
// (IMPORT_PRESETS / ImportPreset). This module reuses them via
// `presetToHfInput()` instead of redefining preset metadata. If P10-24 later
// adds `format` / `fieldMap` hints to ImportPreset, extend that function and
// keep the local HfPresetInput type as the runtime shape.

// Minimal local descriptor for the actual download+convert call. Distinct
// from P10-24's ImportPreset (an origin descriptor without format/fieldMap).
export type HfDatasetFormat = 'jsonl' | 'csv' | 'parquet';

export interface HfFieldMap {
  id?: string;
  input: string;
  choices?: string;
  target?: string;
  metadata?: string | string[];
}

export interface HfImportInput {
  repo: string;
  path?: string;
  revision?: string;
  format: HfDatasetFormat;
  fieldMap: HfFieldMap;
  /** 'index0' | 'index1': numeric answers map to choice letters; 'letter': kept verbatim. */
  mcqAnswer?: 'index0' | 'index1' | 'letter';
  choicesDelimiter?: string;
  packId: string;
  title?: string;
  licenseId?: string;
  category?: EvalCategoryId;
}

export interface HfImportResult {
  packId: string;
  sampleCount: number;
  warnings: string[];
}

/**
 * Lift a P10-24 ImportPreset descriptor into a runnable HfImportInput. The
 * caller supplies format/fieldMap (dataset-specific); returns null when the
 * preset source is not a HuggingFace repo.
 */
export function presetToHfInput(
  preset: ImportPreset,
  args: {
    format: Exclude<HfDatasetFormat, 'parquet'>;
    fieldMap: HfFieldMap;
    packId: string;
    mcqAnswer?: HfImportInput['mcqAnswer'];
  },
): HfImportInput | null {
  if (preset.source.kind !== 'hf') return null;
  return {
    repo: preset.source.repo,
    path: preset.source.path,
    revision: preset.source.revision === 'latest' ? 'main' : preset.source.revision,
    format: args.format,
    fieldMap: args.fieldMap,
    mcqAnswer: args.mcqAnswer,
    packId: args.packId,
    licenseId: preset.license,
    title: preset.id,
  };
}

export function hfFileUrl(repo: string, path: string | undefined, revision: string | undefined): string {
  const rev = revision ?? 'main';
  const file = (path ?? '').replace(/^\//, '');
  return `https://huggingface.co/datasets/${repo}/resolve/${rev}/${file}`;
}

export interface HfImportDeps {
  downloadFile(url: string, destScope: 'user', packId: string, relPath: string): Promise<number>;
  readPack(scope: 'user', packId: string, relPath: string): Promise<string>;
  writePack(
    scope: 'user',
    packId: string,
    files: Array<{ relPath: string; content: string }>,
    workspaceRoot?: string,
  ): Promise<void>;
  removePack(scope: 'user', packId: string, workspaceRoot?: string): Promise<void>;
}

const defaultDeps: HfImportDeps = {
  downloadFile: (url, destScope, packId, relPath) =>
    evalDownloadFile(url, destScope, packId, relPath),
  readPack: (scope, packId, relPath) => tauriPackFs.read(scope, packId, relPath),
  writePack: (scope, packId, files, workspaceRoot) =>
    tauriPackFs.write(scope, packId, files, workspaceRoot),
  removePack: (scope, packId, workspaceRoot) => tauriPackFs.remove(scope, packId, workspaceRoot),
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function letterFor(index: number): string {
  return LETTERS[index] ?? String(index);
}

function toStringChoice(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function pickField(
  rec: Record<string, unknown>,
  names: string[],
): { name: string; value: unknown } | null {
  for (const name of names) {
    if (rec[name] !== undefined) return { name, value: rec[name] };
  }
  return null;
}

/**
 * Generic record mapper shared by the JSONL path and the MCQ path.
 * HF MCQ mapping: question -> input, choices/options -> choices,
 * answer (index/letter) -> target.
 */
export function mapHfRecords(
  records: unknown[],
  fieldMap: HfFieldMap,
  opts: {
    mcqAnswer?: HfImportInput['mcqAnswer'];
    choicesDelimiter?: string;
    warnings: string[];
  },
): EvalSample[] {
  const out: EvalSample[] = [];
  records.forEach((item, i) => {
    const fallbackId = `hf-${i + 1}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      opts.warnings.push(`${fallbackId}: skipped (not an object)`);
      return;
    }
    const rec = item as Record<string, unknown>;
    const rawId = fieldMap.id !== undefined ? rec[fieldMap.id] : undefined;
    const id =
      typeof rawId === 'string' && rawId !== ''
        ? rawId
        : typeof rawId === 'number'
          ? String(rawId)
          : fallbackId;
    const rawInput = rec[fieldMap.input];
    if (typeof rawInput !== 'string' || rawInput.trim() === '') {
      opts.warnings.push(`${id}: skipped (missing input field '${fieldMap.input}')`);
      return;
    }
    const sample: EvalSample = { id, input: rawInput };

    if (fieldMap.choices !== undefined) {
      const rawChoices = rec[fieldMap.choices];
      const delimiter = opts.choicesDelimiter ?? '|';
      if (typeof rawChoices === 'string') {
        const parts = rawChoices
          .split(delimiter)
          .map((p) => p.trim())
          .filter((p) => p !== '');
        if (parts.length > 0) sample.choices = parts;
      } else if (Array.isArray(rawChoices)) {
        const parts = rawChoices
          .map(toStringChoice)
          .filter((v): v is string => v !== null);
        if (parts.length > 0) sample.choices = parts;
      } else if (rawChoices !== undefined) {
        opts.warnings.push(`${id}: choices dropped (unsupported shape)`);
      }
    }

    if (fieldMap.target !== undefined) {
      const rawTarget = rec[fieldMap.target];
      if (typeof rawTarget === 'string' && rawTarget.trim() !== '') {
        sample.target = rawTarget.trim();
      } else if (typeof rawTarget === 'number' && Number.isInteger(rawTarget)) {
        const choiceCount = sample.choices?.length ?? 0;
        const mode = opts.mcqAnswer ?? 'letter';
        if (mode === 'index0' && rawTarget >= 0 && rawTarget < Math.max(choiceCount, 1)) {
          sample.target = letterFor(rawTarget);
        } else if (mode === 'index1' && rawTarget >= 1 && rawTarget <= Math.max(choiceCount, 1)) {
          sample.target = letterFor(rawTarget - 1);
        } else {
          sample.target = rawTarget;
        }
      } else if (Array.isArray(rawTarget) && rawTarget.every((v) => typeof v === 'string')) {
        if (rawTarget.length > 0) sample.target = rawTarget as string[];
      } else if (rawTarget !== undefined && rawTarget !== null) {
        opts.warnings.push(`${id}: target dropped (unsupported shape)`);
      }
    }

    const metaNames =
      fieldMap.metadata === undefined
        ? []
        : Array.isArray(fieldMap.metadata)
          ? fieldMap.metadata
          : [fieldMap.metadata];
    if (metaNames.length > 0) {
      const meta: Record<string, string | number | boolean> = {};
      for (const name of metaNames) {
        const v = rec[name];
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          meta[name] = v;
        }
      }
      if (Object.keys(meta).length > 0) sample.metadata = meta;
    }
    out.push(sample);
  });
  return out;
}

/** MCQ convenience wrapper with question/choices|options/answer field aliases. */
export function convertHfMcqJsonl(
  text: string,
  mcq: { id?: string; question?: string; choices?: string[]; answer?: string },
  opts: {
    packId: string;
    licenseId?: string;
    category?: EvalCategoryId;
    mcqAnswer?: HfImportInput['mcqAnswer'];
    choicesDelimiter?: string;
  },
): { manifest: EvalPackManifest; samples: EvalSample[]; warnings: string[] } {
  const warnings: string[] = [];
  const { lines, diagnostics } = parseJsonl(text);
  for (const d of diagnostics) {
    warnings.push(`line ${d.line}: skipped (${d.message})`);
  }
  const records = lines.map((l) => l.value);
  const questionKey = mcq.question ?? 'question';
  const answerKey = mcq.answer ?? 'answer';
  const choicesKeys = mcq.choices ?? ['choices', 'options'];
  const mapped: EvalSample[] = [];
  records.forEach((item, i) => {
    const fallbackId = `hf-${i + 1}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      warnings.push(`${fallbackId}: skipped (not an object)`);
      return;
    }
    const rec = item as Record<string, unknown>;
    const choicesHit = pickField(rec, choicesKeys);
    const fieldMap: HfFieldMap = {
      id: mcq.id,
      input: questionKey,
      choices: choicesHit?.name,
      target: answerKey,
    };
    mapped.push(
      ...mapHfRecords([rec], fieldMap, {
        mcqAnswer: opts.mcqAnswer ?? 'index0',
        choicesDelimiter: opts.choicesDelimiter,
        warnings,
      }),
    );
  });
  const validated = validateImportPack(buildImportManifest(opts), mapped);
  warnings.push(...validated.errors);
  return {
    manifest: withTierCounts(validated.manifest, validated.samples.length),
    samples: validated.samples,
    warnings,
  };
}

function convertDownloadedText(
  text: string,
  input: HfImportInput,
  warnings: string[],
): { samples: EvalSample[]; extraWarnings: string[] } {
  if (input.format === 'jsonl') {
    // Inspect-style records pass through the generic mapper; fieldMap uses
    // the dataset's own field names (e.g. question/choices/answer).
    const { lines, diagnostics } = parseJsonl(text);
    for (const d of diagnostics) warnings.push(`line ${d.line}: skipped (${d.message})`);
    const samples = mapHfRecords(
      lines.map((l) => l.value),
      input.fieldMap,
      { mcqAnswer: input.mcqAnswer, choicesDelimiter: input.choicesDelimiter, warnings },
    );
    return { samples, extraWarnings: [] };
  }
  const converted = input.format === 'csv'
    ? convertCsvImport(text, input.fieldMap as CsvFieldMap, {
      packId: input.packId,
      licenseId: input.licenseId,
      category: input.category,
      choicesDelimiter: input.choicesDelimiter,
    })
    : convertInspectJsonl(text, {
      packId: input.packId,
      licenseId: input.licenseId,
      category: input.category,
    });
  return { samples: converted.samples, extraWarnings: converted.warnings };
}

export async function importHfDataset(
  input: HfImportInput,
  deps: HfImportDeps = defaultDeps,
  workspaceRoot?: string,
): Promise<HfImportResult> {
  if (input.format === 'parquet') {
    throw new Error(
      'parquet is not supported: download the dataset as JSONL or CSV from HuggingFace and import the file instead',
    );
  }
  if (!isValidPackId(input.packId)) {
    throw new Error(`invalid pack id '${input.packId}' (lowercase letters, digits, dashes)`);
  }
  if (!input.repo || !input.path) {
    throw new Error('HF import needs a repo and a file path (repo/path/revision descriptor)');
  }
  const warnings: string[] = [];
  const stagingId = `${input.packId}--import-tmp`;
  const url = hfFileUrl(input.repo, input.path, input.revision);
  const relPath = 'source.raw';
  try {
    await deps.downloadFile(url, 'user', stagingId, relPath);
    const text = await deps.readPack('user', stagingId, relPath);
    const { samples, extraWarnings } = convertDownloadedText(text, input, warnings);
    warnings.push(...extraWarnings);
    const validated = validateImportPack(
      buildImportManifest({
        packId: input.packId,
        title: input.title ?? input.packId,
        licenseId: input.licenseId,
        sourceUrl: url,
        category: input.category,
      }),
      samples,
    );
    warnings.push(...validated.errors);
    const manifest = withTierCounts(validated.manifest, validated.samples.length);
    await deps.writePack(
      'user',
      input.packId,
      [
        { relPath: 'manifest.json', content: JSON.stringify(manifest, null, 2) },
        { relPath: 'samples.jsonl', content: samplesToJsonl(validated.samples) },
      ],
      workspaceRoot,
    );
    return { packId: input.packId, sampleCount: validated.samples.length, warnings };
  } finally {
    try {
      await deps.removePack('user', stagingId, workspaceRoot);
    } catch {
      warnings.push(`staging pack '${stagingId}' could not be cleaned up; delete it manually`);
    }
  }
}
