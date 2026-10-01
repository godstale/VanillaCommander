import { parseCsv } from '../packs/sources/csv';
import type { EvalPackManifest, EvalSample } from '../types';
import {
  buildImportManifest,
  validateImportPack,
  withTierCounts,
  type ImportManifestOptions,
} from './draft';

// Generic CSV import. Column names are selected by the caller; only `input`
// is required. Choices cells are split on a configurable delimiter
// (default '|'); letter targets are kept verbatim.

export interface CsvFieldMap {
  id?: string;
  input: string;
  choices?: string;
  target?: string;
  metadata?: string | string[];
}

export interface CsvImportOptions extends ImportManifestOptions {
  choicesDelimiter?: string;
}

export interface CsvImportResult {
  manifest: EvalPackManifest;
  samples: EvalSample[];
  warnings: string[];
}

export function convertCsvImport(
  text: string,
  fieldMap: CsvFieldMap,
  opts: CsvImportOptions,
): CsvImportResult {
  const warnings: string[] = [];
  const delimiter = opts.choicesDelimiter ?? '|';
  const { rows, diagnostics } = parseCsv(text);
  for (const d of diagnostics) {
    warnings.push(`row ${d.row}: ${d.message}`);
  }
  if (rows.length === 0) {
    warnings.push('empty file: no rows');
    const validated = validateImportPack(buildImportManifest(opts), []);
    return { manifest: validated.manifest, samples: [], warnings };
  }
  const header = rows[0].map((h) => h.trim());
  const col = (name: string): number => header.indexOf(name);
  const inputCol = col(fieldMap.input);
  if (inputCol < 0) {
    throw new Error(
      `input column '${fieldMap.input}' not found in header [${header.join(', ')}]`,
    );
  }
  const idCol = fieldMap.id !== undefined ? col(fieldMap.id) : -1;
  const choicesCol = fieldMap.choices !== undefined ? col(fieldMap.choices) : -1;
  const targetCol = fieldMap.target !== undefined ? col(fieldMap.target) : -1;
  const metaNames = (
    fieldMap.metadata === undefined
      ? []
      : Array.isArray(fieldMap.metadata)
        ? fieldMap.metadata
        : [fieldMap.metadata]
  ).filter((name) => {
    if (col(name) < 0) {
      warnings.push(`metadata column '${name}' not found; ignored`);
      return false;
    }
    return true;
  });

  const raw: EvalSample[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => c.trim() === '')) continue;
    const rowId = `row-${r + 1}`;
    const input = (cells[inputCol] ?? '').trim();
    if (input === '') {
      warnings.push(`${rowId}: skipped (empty input)`);
      continue;
    }
    const id =
      idCol >= 0 && (cells[idCol] ?? '').trim() !== ''
        ? (cells[idCol] as string).trim()
        : rowId;
    const sample: EvalSample = { id, input };
    if (choicesCol >= 0) {
      const parts = (cells[choicesCol] ?? '')
        .split(delimiter)
        .map((p) => p.trim())
        .filter((p) => p !== '');
      if (parts.length > 0) sample.choices = parts;
    }
    if (targetCol >= 0) {
      const target = (cells[targetCol] ?? '').trim();
      if (target !== '') sample.target = target;
    }
    if (metaNames.length > 0) {
      const meta: Record<string, string | number | boolean> = {};
      for (const name of metaNames) {
        const value = (cells[col(name)] ?? '').trim();
        if (value !== '') meta[name] = value;
      }
      if (Object.keys(meta).length > 0) sample.metadata = meta;
    }
    raw.push(sample);
  }
  const validated = validateImportPack(buildImportManifest(opts), raw);
  warnings.push(...validated.errors);
  return {
    manifest: withTierCounts(validated.manifest, validated.samples.length),
    samples: validated.samples,
    warnings,
  };
}
