import { z } from 'zod';
import type { Scorer, ScorerInput, ScorerResult } from './types';
import { correct, incorrect, parseScorerOptions } from './types';
import { stripThinking } from './extract';

const OptionsSchema = z.object({
  requireText: z.boolean().default(true),
});

export const noToolCallScorer: Scorer = {
  type: 'no_tool_call',
  optionsSchema: OptionsSchema,
  async score(input: ScorerInput, options: unknown): Promise<ScorerResult> {
    const opts = parseScorerOptions(OptionsSchema, options);
    if (input.toolCalls.length > 0) {
      return incorrect(`called ${input.toolCalls.map((c) => c.name).join(', ')}`);
    }
    if (opts.requireText && stripThinking(input.outputText).trim() === '') {
      return incorrect('empty response text');
    }
    return correct(1, 'no tool calls');
  },
};
