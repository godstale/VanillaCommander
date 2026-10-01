import { describe, expect, it } from 'vitest';
import { getScorer } from './index';
import { llmJudgePairwiseScorer, llmJudgeRubricScorer } from './llmJudge';
import type { ScorerInput } from './types';

const ctx = { signal: new AbortController().signal };

function input(): ScorerInput {
  return {
    sample: { id: 's', input: 'q' },
    pack: { id: 'p' },
    outputText: 'out',
    toolCalls: [],
  } as unknown as ScorerInput;
}

describe('llm judge scorers', () => {
  it('registers both judge scorer types', () => {
    expect(getScorer('llm_judge_rubric')).toBe(llmJudgeRubricScorer);
    expect(getScorer('llm_judge_pairwise')).toBe(llmJudgePairwiseScorer);
  });

  it('marks them async-only so the runner skips them inline', () => {
    expect(llmJudgeRubricScorer.requiresAsync).toBe(true);
    expect(llmJudgePairwiseScorer.requiresAsync).toBe(true);
  });

  it('throws a use-judge-pass error when scored directly', async () => {
    await expect(llmJudgeRubricScorer.score(input(), {}, ctx)).rejects.toThrow('use judge pass');
    await expect(llmJudgePairwiseScorer.score(input(), {}, ctx)).rejects.toThrow('use judge pass');
  });
});
