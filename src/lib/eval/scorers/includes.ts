import { z } from 'zod';
import type { Scorer, ScorerInput, ScorerResult } from './types';
import { correct, incorrect, parseScorerOptions } from './types';
import { stripThinking } from './extract';
import { targetsOf } from './shared';

const OptionsSchema = z.object({
  mode: z.enum(['any', 'all']).default('any'),
  caseSensitive: z.boolean().default(false),
  values: z.array(z.string()).optional(),
});

export const includesScorer: Scorer = {
  type: 'includes',
  optionsSchema: OptionsSchema,
  async score(input: ScorerInput, options: unknown): Promise<ScorerResult> {
    const opts = parseScorerOptions(OptionsSchema, options);
    const values = opts.values ?? targetsOf(input).filter((t) => t !== '');
    const hay = opts.caseSensitive
      ? stripThinking(input.outputText)
      : stripThinking(input.outputText).toLowerCase();
    const hits = values.map((v) => {
      const needle = opts.caseSensitive ? v : v.toLowerCase();
      return needle !== '' && hay.includes(needle);
    });
    const pass = opts.mode === 'all' ? hits.every(Boolean) : hits.some(Boolean);
    const matched = values.filter((_, i) => hits[i]);
    if (pass) return correct(1, `includes: ${matched.join(', ') || '(empty)'}`, matched[0]);
    return incorrect(`missing ${opts.mode === 'all' ? 'all' : 'any'} of: ${values.join(', ')}`);
  },
};
