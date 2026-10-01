import { z } from 'zod';
import type { Scorer, ScorerInput, ScorerResult } from './types';
import { correct, incorrect, parseScorerOptions } from './types';
import { stripThinking } from './extract';
import { applyNormalizations } from './normalizeText';
import { targetsOf, truncate } from './shared';

const OptionsSchema = z.object({
  pattern: z.string(),
  flags: z.string().optional(),
  group: z.number().int().optional(),
  compareTo: z.enum(['target', 'none']).default('target'),
});

export const regexScorer: Scorer = {
  type: 'regex',
  optionsSchema: OptionsSchema,
  async score(input: ScorerInput, options: unknown): Promise<ScorerResult> {
    const opts = parseScorerOptions(OptionsSchema, options);
    let re: RegExp;
    try {
      re = new RegExp(opts.pattern, opts.flags);
    } catch (err) {
      return { value: 0, verdict: 'error', reason: `bad regex: ${err instanceof Error ? err.message : 'invalid'}` };
    }
    const m = re.exec(stripThinking(input.outputText));
    if (!m) return incorrect(`no match for /${opts.pattern}/`);
    const captured = opts.group !== undefined ? (m[opts.group] ?? '') : m[0];
    if (opts.compareTo === 'none') return correct(1, 'regex match', captured);
    const norm = (s: string) => applyNormalizations(s, ['trim', 'case', 'whitespace']);
    for (const t of targetsOf(input)) {
      if (norm(captured) === norm(t)) return correct(1, 'regex group match', captured);
    }
    return incorrect(`regex matched '${truncate(captured)}' but not target`, captured);
  },
};
