import type { ScorerType } from '../types';

/**
 * Scorer types that never run inline in the trial loop
 * (`EvalRunner` skips `requiresAsync` scorers). Their scores arrive later —
 * llm_judge_* via the judge pass, code_exec via the code-exec pass, human /
 * choice_logprob via their own (possibly manual) passes — or never.
 *
 * The progress UI uses this set to mark scores as "pending finalization"
 * instead of showing a misleading 0% / "—".
 */
export const DEFERRED_SCORER_TYPES: ReadonlySet<ScorerType> = new Set<ScorerType>([
  'llm_judge_rubric',
  'llm_judge_pairwise',
  'code_exec',
  'human',
  'choice_logprob',
]);

export function isDeferredScorerType(type: string): boolean {
  return (DEFERRED_SCORER_TYPES as ReadonlySet<string>).has(type);
}
