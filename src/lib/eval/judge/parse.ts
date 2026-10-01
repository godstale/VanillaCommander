import { z } from 'zod';

export const RubricCriterionSchema = z.object({
  name: z.string(),
  score: z.number(),
  reason: z.string(),
});

export const RubricVerdictSchema = z.object({
  criteria: z.array(RubricCriterionSchema).min(1),
  overall: z.number(),
});
export type RubricVerdict = z.infer<typeof RubricVerdictSchema>;

export const PairwiseVerdictSchema = z.object({
  winner: z.enum(['A', 'B', 'tie']),
  reason: z.string(),
});
export type PairwiseVerdict = z.infer<typeof PairwiseVerdictSchema>;

export type JudgeParseSuccess<T> = { ok: true; value: T; raw: string };
export type JudgeParseFailure = { ok: false; error: string; raw: string };
export type JudgeParseResult<T> = JudgeParseSuccess<T> | JudgeParseFailure;

/** Remove markdown fences so models that wrap JSON in ``` still parse. */
export function stripCodeFences(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1] : raw;
}

/**
 * Extract the first balanced `{...}` object from free text, tolerating
 * leading/trailing prose. Returns null when no balanced object exists.
 */
export function extractFirstJsonObject(raw: string): string | null {
  const text = stripCodeFences(raw);
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryParse<T>(raw: string, schema: z.ZodType<T>): JudgeParseResult<T> {
  const jsonText = extractFirstJsonObject(raw);
  if (jsonText === null) return { ok: false, error: 'no-json-object', raw };
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return { ok: false, error: 'invalid-json', raw };
  }
  const validated = schema.safeParse(parsed);
  if (!validated.success) return { ok: false, error: 'schema-mismatch', raw };
  return { ok: true, value: validated.data, raw };
}

/**
 * Parse a judge response, retrying once with a "JSON only" re-ask when the
 * first attempt fails. A second failure yields `{ ok: false }` and the
 * caller records a verdict of `error`.
 */
export async function parseJudgeOutputWithRetry<T>(
  raw: string,
  schema: z.ZodType<T>,
  reask: () => Promise<string>,
): Promise<JudgeParseResult<T>> {
  const first = tryParse(raw, schema);
  if (first.ok) return first;
  let second: string;
  try {
    second = await reask();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), raw };
  }
  const retry = tryParse(second, schema);
  if (retry.ok) return retry;
  return { ok: false, error: retry.error, raw: second };
}

export const JUDGE_REASK_SUFFIX = '\n\nRespond with JSON only, no other text.';
