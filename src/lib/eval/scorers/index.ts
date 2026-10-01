import type { Scorer, ScorerResult } from './types';
import type { ScorerSpec, Verdict } from '../types';
import { choiceScorer } from './choice';
import { exactScorer } from './exact';
import { includesScorer } from './includes';
import { jsonSchemaScorer } from './jsonSchema';
import { noToolCallScorer } from './noToolCall';
import { numericScorer } from './numeric';
import { regexScorer } from './regex';
import { toolCallAstScorer } from './toolCallAst';
import { vizBlockScorer } from './vizBlock';

const registry = new Map<string, Scorer>();

export function registerScorer(scorer: Scorer): void {
  registry.set(scorer.type, scorer);
}

export function getScorer(type: string): Scorer {
  const scorer = registry.get(type);
  if (!scorer) throw new Error(`Unknown scorer type: ${type}`);
  return scorer;
}

export function listScorers(): string[] {
  return [...registry.keys()];
}

registerScorer(exactScorer);
registerScorer(includesScorer);
registerScorer(regexScorer);
registerScorer(choiceScorer);
registerScorer(numericScorer);
registerScorer(jsonSchemaScorer);
registerScorer(toolCallAstScorer);
registerScorer(noToolCallScorer);
registerScorer(vizBlockScorer);

export function scorerKeyOf(spec: ScorerSpec): string {
  return spec.key ?? spec.type;
}

export function combineSampleScore(
  results: Array<{ spec: ScorerSpec; result: ScorerResult }>,
): { value: number; verdict: Verdict } {
  if (results.length === 0) return { value: 0, verdict: 'error' };
  for (const { spec, result } of results) {
    const effective: Verdict =
      spec.threshold !== undefined
        ? result.value >= spec.threshold
          ? 'correct'
          : result.value <= 0
            ? result.verdict
            : 'partial'
        : result.verdict;
    if (spec.gate && effective !== 'correct') {
      return { value: 0, verdict: result.verdict };
    }
  }
  let weightSum = 0;
  let weighted = 0;
  let allCorrect = true;
  let allZero = true;
  let anyNoAnswer = false;
  for (const { spec, result } of results) {
    const w = spec.weight;
    weightSum += w;
    weighted += result.value * w;
    const effective: Verdict =
      spec.threshold !== undefined && result.value >= spec.threshold ? 'correct' : result.verdict;
    if (effective !== 'correct') allCorrect = false;
    if (result.value !== 0) allZero = false;
    if (result.verdict === 'no_answer') anyNoAnswer = true;
  }
  const value = weightSum > 0 ? weighted / weightSum : 0;
  if (allCorrect) return { value, verdict: 'correct' };
  if (allZero) return { value, verdict: anyNoAnswer ? 'no_answer' : 'incorrect' };
  return { value, verdict: 'partial' };
}

export function combineCircular(rotations: ScorerResult[]): ScorerResult {
  if (rotations.length === 0) {
    return { value: 0, verdict: 'error', reason: 'no rotations' };
  }
  const allCorrect = rotations.every((r) => r.verdict === 'correct');
  if (allCorrect) return { value: 1, verdict: 'correct', reason: `circular ${rotations.length}/${rotations.length}` };
  const mean = rotations.reduce((a, r) => a + r.value, 0) / rotations.length;
  return { value: 0, verdict: 'incorrect', reason: `circular ${rotations.filter((r) => r.verdict === 'correct').length}/${rotations.length}, mean ${mean.toFixed(2)}` };
}
