import { z } from 'zod';
import { upsertScores } from '@/lib/db/repositories/evalRepo';
import { registerScorer } from './index';
import type { Scorer } from './types';
import type { Verdict } from '../types';

/**
 * Persist a human rating. Human scores outrank judge/auto scores for the
 * same (trialId, scorerKey) via pickEffectiveScore in scoring/metrics.
 */
export async function saveHumanScore(
  trialId: string,
  scorerKey: string,
  value: number,
  verdict: Verdict,
  note?: string,
): Promise<void> {
  await upsertScores([
    {
      id: crypto.randomUUID(),
      trialId,
      scorerKey,
      scorerType: 'human',
      value,
      verdict,
      reason: note ?? null,
      extracted: null,
      judgeRaw: null,
      source: 'human',
      createdAt: new Date().toISOString(),
    },
  ]);
}

export const humanScorer: Scorer = {
  type: 'human',
  optionsSchema: z.object({}).catchall(z.unknown()),
  requiresAsync: true,
  async score() {
    throw new Error(
      "scorer 'human' is async-only: use judge pass (saveHumanScore); it is skipped inline by the runner",
    );
  },
};

registerScorer(humanScorer);
