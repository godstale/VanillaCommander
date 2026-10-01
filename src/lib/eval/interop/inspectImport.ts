import { parseJsonl } from '../packs/sources/jsonl';
import type { EvalMessage, EvalPackManifest, EvalSample } from '../types';
import {
  buildImportManifest,
  validateImportPack,
  withTierCounts,
  type ImportManifestOptions,
} from './draft';

// Inspect JSONL (`input/target/choices/id/metadata`) and OpenAI-Evals-style
// JSONL (`messages[]` -> input, `ideal` -> target) to Fortress samples.

export interface InspectImportResult {
  manifest: EvalPackManifest;
  samples: EvalSample[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  );
}

const MESSAGE_ROLES = ['system', 'user', 'assistant'] as const;

function toMessages(value: unknown): EvalMessage[] | null {
  if (!Array.isArray(value)) return null;
  const out: EvalMessage[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const role = item.role;
    const content = item.content;
    if (
      typeof role !== 'string' ||
      !MESSAGE_ROLES.includes(role as (typeof MESSAGE_ROLES)[number]) ||
      typeof content !== 'string'
    ) {
      return null;
    }
    out.push({ role: role as EvalMessage['role'], content });
  }
  return out.length > 0 ? out : null;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') out.push(item);
    else if (typeof item === 'number' || typeof item === 'boolean') out.push(String(item));
    else return null;
  }
  return out;
}

function toTarget(value: unknown): EvalSample['target'] {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return value.length > 0 ? (value as string[]) : undefined;
  }
  return undefined;
}

/** Convert one parsed JSONL record. Returns null when the row is skipped. */
function convertRecord(
  rec: unknown,
  fallbackId: string,
  warnings: string[],
): EvalSample | null {
  if (!isRecord(rec)) {
    warnings.push(`${fallbackId}: skipped (not a JSON object)`);
    return null;
  }
  const id = typeof rec.id === 'string' && rec.id !== '' ? rec.id : fallbackId;

  // Input: Inspect `input` (string | messages) or OpenAI-evals `messages`.
  let input: EvalSample['input'] | undefined;
  if (typeof rec.input === 'string' && rec.input !== '') {
    input = rec.input;
  } else {
    const msgs = toMessages(rec.input) ?? toMessages(rec.messages);
    if (msgs) input = msgs;
  }
  if (input === undefined) {
    warnings.push(`${id}: skipped (missing input/messages)`);
    return null;
  }

  // Target: Inspect `target` or OpenAI-evals `ideal`.
  const target = toTarget(rec.target) ?? toTarget(rec.ideal);

  // Choices: string arrays only; numbers/booleans are stringified.
  let choices: string[] | undefined;
  if (rec.choices !== undefined) {
    const parsed = toStringArray(rec.choices);
    if (!parsed) {
      warnings.push(`${id}: choices dropped (not a string array)`);
    } else if (parsed.length > 0) {
      choices = parsed;
    }
  }

  // Metadata: primitive values only.
  let metadata: EvalSample['metadata'];
  if (rec.metadata !== undefined) {
    if (!isRecord(rec.metadata)) {
      warnings.push(`${id}: metadata dropped (not an object)`);
    } else {
      const kept: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(rec.metadata)) {
        if (isPrimitive(v)) kept[k] = v;
        else warnings.push(`${id}: metadata['${k}'] dropped (non-primitive)`);
      }
      if (Object.keys(kept).length > 0) metadata = kept;
    }
  }

  const candidate: Record<string, unknown> = { id, input };
  if (choices !== undefined) candidate.choices = choices;
  if (target !== undefined) candidate.target = target;
  if (metadata !== undefined) candidate.metadata = metadata;
  return candidate as EvalSample;
}

export function convertInspectJsonl(
  text: string,
  opts: ImportManifestOptions,
): InspectImportResult {
  const warnings: string[] = [];
  const { lines, diagnostics } = parseJsonl(text);
  for (const d of diagnostics) {
    warnings.push(`line ${d.line}: skipped (${d.message})`);
  }
  const raw: EvalSample[] = [];
  for (const line of lines) {
    const sample = convertRecord(line.value, `line-${line.line}`, warnings);
    if (sample) raw.push(sample);
  }
  const validated = validateImportPack(buildImportManifest(opts), raw);
  warnings.push(...validated.errors);
  return {
    manifest: withTierCounts(validated.manifest, validated.samples.length),
    samples: validated.samples,
    warnings,
  };
}
