import { z } from 'zod';
import type { Scorer, ScorerInput, ScorerResult } from './types';
import { correct, incorrect, noAnswer, parseScorerOptions } from './types';
import {
  extractAnswerLine,
  extractBoxed,
  extractHash4,
  extractLastNumber,
  stripThinking,
  type NumericExtractRule,
} from './extract';
import { targetsOf } from './shared';

const OptionsSchema = z.object({
  tolerance: z.number().default(1e-6),
  relative: z.boolean().default(false),
  extract: z
    .array(z.enum(['boxed', 'answer_line', 'hash4', 'last_number']))
    .default(['boxed', 'answer_line', 'hash4', 'last_number']),
});

export function parseNumeric(raw: string): number | null {
  let s = raw.trim().replace(/,/g, '');
  let multiplier = 1;
  if (s.endsWith('%')) {
    multiplier = 0.01;
    s = s.slice(0, -1).trim();
  }
  const frac = /^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/.exec(s);
  if (frac) {
    const denom = Number(frac[2]);
    if (denom === 0) return null;
    return (Number(frac[1]) / denom) * multiplier;
  }
  const wrapped = /^[₩$€¥£]?\s*(-?\d+(?:\.\d+)?)\s*[원달러유로파운드]?$/.exec(s);
  if (wrapped) return Number(wrapped[1]) * multiplier;
  const n = Number(s);
  return Number.isFinite(n) ? n * multiplier : null;
}

export const numericScorer: Scorer = {
  type: 'numeric',
  optionsSchema: OptionsSchema,
  async score(input: ScorerInput, options: unknown): Promise<ScorerResult> {
    const opts = parseScorerOptions(OptionsSchema, options);
    const tolerance = opts.tolerance ?? 1e-6;
    const relative = opts.relative ?? false;
    const text = stripThinking(input.outputText);
    for (const rule of (opts.extract ?? ['boxed', 'answer_line', 'hash4', 'last_number']) as NumericExtractRule[]) {
      const ext =
        rule === 'boxed'
          ? extractBoxed(text)
          : rule === 'answer_line'
            ? extractAnswerLine(text)
            : rule === 'hash4'
              ? extractHash4(text)
              : extractLastNumber(text);
      if (!ext) continue;
      const direct = parseNumeric(ext.value);
      const fallback = direct === null ? extractLastNumber(ext.value) : null;
      const got = direct ?? (fallback ? parseNumeric(fallback.value) : null);
      if (got === null) continue;
      for (const t of targetsOf(input)) {
        const want = parseNumeric(t);
        if (want === null) continue;
        const tol = relative ? tolerance * Math.max(1, Math.abs(want)) : tolerance;
        if (Math.abs(got - want) <= tol) {
          return correct(1, `numeric ${got} ≈ ${want} via ${rule}`, String(got));
        }
      }
      return incorrect(`expected ${targetsOf(input).join('|')}, got ${got}`, String(got));
    }
    return noAnswer('no number extracted');
  },
};
