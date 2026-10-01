import { z } from 'zod';
import { ChartDslSchema } from '@/lib/types/chartDsl';
import { parseVisualBlocks } from '@/lib/markdown/parseVisualBlocks';
import type { Scorer, ScorerInput, ScorerResult } from './types';
import { correct, incorrect, parseScorerOptions } from './types';
import { stripThinking } from './extract';

const OptionsSchema = z.object({
  kind: z.enum(['mermaid', 'recharts', 'any']).default('any'),
  minBlocks: z.number().int().default(1),
});

interface MermaidModule {
  parse(code: string): Promise<boolean> | boolean;
}

async function validateMermaid(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const mod = (await import('mermaid')) as unknown as MermaidModule & { default?: MermaidModule };
    const api = mod.default ?? mod;
    await api.parse(code);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message.split('\n')[0] ?? 'parse error' };
  }
}

export const vizBlockScorer: Scorer = {
  type: 'viz_block',
  optionsSchema: OptionsSchema,
  async score(input: ScorerInput, options: unknown): Promise<ScorerResult> {
    const opts = parseScorerOptions(OptionsSchema, options);
    const minBlocks = opts.minBlocks ?? 1;
    const blocks = parseVisualBlocks(stripThinking(input.outputText)).filter(
      (b) => opts.kind === 'any' || b.type === opts.kind,
    );
    if (blocks.length < minBlocks) {
      return incorrect(`found ${blocks.length} ${opts.kind} block(s), need ${minBlocks}`);
    }
    for (const block of blocks) {
      if (block.type === 'mermaid') {
        const result = await validateMermaid(block.content);
        if (!result.ok) return incorrect(`mermaid parse error: ${result.error}`);
      } else {
        if (block.parseError) return incorrect(`recharts JSON error: ${block.parseError}`);
        const parsed = ChartDslSchema.safeParse(block.parsedJson);
        if (!parsed.success) {
          return incorrect(`recharts DSL violation: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
        }
      }
    }
    return correct(1, `${blocks.length} valid ${opts.kind} block(s)`);
  },
};
