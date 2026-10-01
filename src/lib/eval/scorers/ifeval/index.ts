import { z } from 'zod';
import type { EvalSample, Verdict } from '../../types';
import { registerScorer } from '../index';
import { getChecker, type CheckerOutcome } from './registry';
import {
  removeAsterisks,
  stripFirstLine,
  stripLastLine,
} from './textUtils';
import './checkers/changeCase';
import './checkers/combination';
import './checkers/detectableContent';
import './checkers/detectableFormat';
import './checkers/keywords';
import './checkers/language';
import './checkers/length';
import './checkers/punctuation';
import './checkers/startend';
import './koCheckers';

export { listCheckerIds } from './registry';

export const ifevalOptionsSchema = z.object({
  mode: z.enum(['strict', 'loose']).default('strict'),
});

export type IfevalMode = z.infer<typeof ifevalOptionsSchema>['mode'];

export interface IfevalScoreInput {
  sample: EvalSample;
  outputText: string;
  reasoningText?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  transcript?: unknown;
  finalState?: unknown;
  extra?: Record<string, unknown>;
}

export interface IfevalScoreResult {
  value: number;
  verdict: Verdict;
  reason: string;
  extracted?: string;
}

export interface IfevalScoreContext {
  signal?: AbortSignal;
}

export interface IfevalCheckReport {
  id: string;
  pass: boolean;
  detail: string;
}

export function buildLooseVariants(text: string): string[] {
  const bases = [
    text,
    stripFirstLine(text),
    stripLastLine(text),
    stripFirstLine(stripLastLine(text)),
  ];
  return [...bases, ...bases.map(removeAsterisks)];
}

function runInstruction(
  id: string,
  kwargs: Record<string, unknown>,
  outputText: string,
  mode: IfevalMode,
): CheckerOutcome {
  const checker = getChecker(id);
  if (checker === undefined) {
    return { pass: false, detail: `unknown checker id "${id}"` };
  }
  try {
    if (mode === 'strict') {
      return checker(outputText, kwargs);
    }
    let firstDetail = 'no variants';
    for (const variant of buildLooseVariants(outputText)) {
      const outcome = checker(variant, kwargs);
      if (outcome.pass) {
        return { pass: true, detail: `loose pass: ${outcome.detail}` };
      }
      firstDetail = outcome.detail;
    }
    return { pass: false, detail: `loose fail: ${firstDetail}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { pass: false, detail: `checker error: ${message}` };
  }
}

export async function scoreIfevalSample(
  input: IfevalScoreInput,
  options: unknown,
): Promise<IfevalScoreResult> {
  const parsed = ifevalOptionsSchema.safeParse(options ?? {});
  const mode: IfevalMode = parsed.success ? parsed.data.mode : 'strict';
  const instructions = input.sample.ifeval ?? [];
  if (instructions.length === 0) {
    return { value: 0, verdict: 'skipped', reason: 'no ifeval instructions' };
  }
  const checks: IfevalCheckReport[] = instructions.map((instruction) => {
    const outcome = runInstruction(
      instruction.id,
      instruction.kwargs ?? {},
      input.outputText,
      mode,
    );
    return { id: instruction.id, ...outcome };
  });
  const passed = checks.filter((check) => check.pass).length;
  const failed = checks.filter((check) => !check.pass).map((check) => check.id);
  const value = passed / checks.length;
  const verdict: Verdict =
    passed === checks.length
      ? 'correct'
      : passed === 0
        ? 'incorrect'
        : 'partial';
  const promptLevelPass = passed === checks.length;
  const reason =
    failed.length === 0
      ? `${passed}/${checks.length} instructions passed (${mode})`
      : `${passed}/${checks.length} instructions passed (${mode}): failed [${failed.join(', ')}]`;
  return {
    value,
    verdict,
    reason,
    extracted: JSON.stringify({
      promptLevelPass,
      passed,
      total: checks.length,
      mode,
      checks,
    }),
  };
}

export const ifevalScorer = {
  type: 'ifeval' as const,
  optionsSchema: ifevalOptionsSchema,
  score(
    input: IfevalScoreInput,
    options: unknown,
  ): Promise<IfevalScoreResult> {
    return scoreIfevalSample(input, options);
  },
};

export type IfevalScorer = typeof ifevalScorer;

export function registerIfevalScorer(): void {
  registerScorer(ifevalScorer);
}
