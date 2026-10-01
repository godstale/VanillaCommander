import { registerScorer } from './scorers/index';
import { registerIfevalScorer } from './scorers/ifeval/index';
import { fsStateScorer } from './scorers/fsState';
import { trajectoryScorer } from './scorers/trajectory';
import { llmJudgePairwiseScorer, llmJudgeRubricScorer } from './scorers/llmJudge';
import { humanScorer } from './scorers/human';
import { codeExecScorer } from './scorers/codeExec';
import { registerChoiceLogprobScorer } from './scorers/choiceLogprob';
import { registerAgenticSolver } from './runner/solvers/agentic';
import { registerLogprobTraceSolver } from './runner/solvers/logprobTrace';

let registered = false;

// Registers every scorer/solver that self-registers nowhere else.
// Idempotent — safe to call from the runner constructor and tests.
export function registerEvalExtensions(): void {
  if (registered) return;
  registered = true;
  registerIfevalScorer();
  registerScorer(fsStateScorer);
  registerScorer(trajectoryScorer);
  registerScorer(llmJudgeRubricScorer);
  registerScorer(llmJudgePairwiseScorer);
  registerScorer(humanScorer);
  registerScorer(codeExecScorer);
  registerChoiceLogprobScorer();
  registerAgenticSolver();
  registerLogprobTraceSolver();
}
