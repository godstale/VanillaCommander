import { z } from 'zod';
import type { Scorer, ScorerInput, ScorerResult } from './types';
import { correct, incorrect, parseScorerOptions } from './types';
import { applyNormalizations, type NormalizeName } from './normalizeText';
import { stripThinking } from './extract';
import { targetsOf, truncate } from './shared';

const NormalizeSchema = z.array(z.enum(['trim', 'case', 'whitespace', 'punct', 'width']));
const OptionsSchema = z.object({
  normalize: NormalizeSchema.default(['trim', 'whitespace', 'width']),
});

export const exactScorer: Scorer = {
  type: 'exact',
  optionsSchema: OptionsSchema,
  async score(input: ScorerInput, options: unknown): Promise<ScorerResult> {
    const opts = parseScorerOptions(OptionsSchema, options);
    const rules = opts.normalize as NormalizeName[];
    const norm = (s: string) => applyNormalizations(stripThinking(s), rules);
    const got = norm(input.outputText);
    for (const t of targetsOf(input)) {
      if (got === norm(t)) return correct(1, 'exact match', got);
    }
    return incorrect(`expected ${targetsOf(input).join('|') || '(no target)'}, got ${truncate(got)}`, got);
  },
};
