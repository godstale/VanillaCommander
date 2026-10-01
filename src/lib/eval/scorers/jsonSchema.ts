import { z } from 'zod';
import type { Scorer, ScorerInput, ScorerResult } from './types';
import { correct, incorrect, parseScorerOptions } from './types';
import { stripThinking } from './extract';

const OptionsSchema = z.object({
  schema: z.record(z.unknown()),
  extract: z.enum(['fence', 'first_object', 'whole']).default('fence'),
});

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function toZod(node: unknown, path: string, ignored: string[]): z.ZodTypeAny {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    ignored.push(`${path || 'root'}: schema must be an object`);
    return z.unknown();
  }
  const schema = node as Record<string, unknown>;
  const type = schema.type;
  if (type === 'object') {
    const shape: Record<string, z.ZodTypeAny> = {};
    const props = (schema.properties ?? {}) as Record<string, unknown>;
    const requiredRaw = schema.required;
    const requiredList = Array.isArray(requiredRaw)
      ? requiredRaw.filter((k): k is string => typeof k === 'string')
      : null;
    for (const [k, v] of Object.entries(props)) {
      const field = toZod(v, `${path}.${k}`, ignored);
      shape[k] = requiredList ? (requiredList.includes(k) ? field : field.optional()) : field.optional();
    }
    return z.object(shape);
  }
  if (type === 'array') {
    const items = toZod(schema.items ?? {}, `${path}[]`, ignored);
    let arr = z.array(items);
    if (typeof schema.minItems === 'number') arr = arr.min(schema.minItems);
    if (typeof schema.maxItems === 'number') arr = arr.max(schema.maxItems);
    return arr;
  }
  if (type === 'string') {
    let s = z.string();
    if (typeof schema.pattern === 'string') {
      try {
        s = s.regex(new RegExp(schema.pattern));
      } catch {
        ignored.push(`${path}: bad pattern`);
      }
    }
    if (Array.isArray(schema.enum)) {
      const values = schema.enum.filter((v): v is string => typeof v === 'string');
      if (values.length > 0 && values.every((v) => (schema.enum as unknown[]).includes(v))) {
        return z.enum(values as [string, ...string[]]);
      }
    }
    return s;
  }
  if (type === 'integer') return z.number().int();
  if (type === 'number') return z.number();
  if (type === 'boolean') return z.boolean();
  if (Array.isArray(schema.enum)) {
    return z.unknown().refine(
      (v) => (schema.enum as unknown[]).some((e) => JSON.stringify(e) === JSON.stringify(v)),
      { message: `${path}: not in enum` },
    );
  }
  ignored.push(`${path}: unsupported keyword, ignored`);
  return z.unknown();
}

function extractJson(text: string, mode: 'fence' | 'first_object' | 'whole'): { raw: string | null; rule: string } {
  if (mode === 'whole') return { raw: text.trim(), rule: 'whole' };
  if (mode === 'fence') {
    const fence = /```(?:json)?\s*\n([\s\S]*?)```/.exec(text);
    if (fence) return { raw: fence[1].trim(), rule: 'fence' };
  }
  const start = text.indexOf('{');
  const arrStart = text.indexOf('[');
  const from = start === -1 ? arrStart : arrStart === -1 ? start : Math.min(start, arrStart);
  if (from === -1) return { raw: null, rule: 'first_object' };
  // balanced-bracket scan from the first opener
  const open = text[from];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) return { raw: text.slice(from, i + 1), rule: 'first_object' };
    }
  }
  return { raw: null, rule: 'first_object' };
}

export const jsonSchemaScorer: Scorer = {
  type: 'json_schema',
  optionsSchema: OptionsSchema,
  async score(input: ScorerInput, options: unknown): Promise<ScorerResult> {
    const opts = parseScorerOptions(OptionsSchema, options);
    const ignored: string[] = [];
    const zodSchema = toZod(opts.schema, 'schema', ignored);
    const { raw, rule } = extractJson(stripThinking(input.outputText), opts.extract ?? 'fence');
    if (!raw) return incorrect('no JSON object found');
    let value: JsonValue;
    try {
      value = JSON.parse(raw) as JsonValue;
    } catch (err) {
      return incorrect(`invalid JSON: ${err instanceof Error ? err.message : 'parse error'}`);
    }
    const parsed = zodSchema.safeParse(value);
    const note = ignored.length > 0 ? ` (ignored: ${ignored.join('; ')})` : '';
    if (parsed.success) return correct(1, `valid JSON via ${rule}${note}`, raw);
    const first = parsed.error.issues[0];
    return incorrect(`schema violation at ${first?.path.join('.') || 'root'}: ${first?.message}${note}`, raw);
  },
};
