import { z } from 'zod';
import { registerScorer } from './index';
import type { Scorer } from './types';

const AsyncOnlyOptionsSchema = z.object({}).catchall(z.unknown());

function asyncOnlyScorer(type: Scorer['type']): Scorer {
  return {
    type,
    optionsSchema: AsyncOnlyOptionsSchema,
    requiresAsync: true,
    async score() {
      throw new Error(
        `scorer '${type}' is async-only: use judge pass (runJudgePass); it is skipped inline by the runner`,
      );
    },
  };
}

export const llmJudgeRubricScorer: Scorer = asyncOnlyScorer('llm_judge_rubric');
export const llmJudgePairwiseScorer: Scorer = asyncOnlyScorer('llm_judge_pairwise');

registerScorer(llmJudgeRubricScorer);
registerScorer(llmJudgePairwiseScorer);
