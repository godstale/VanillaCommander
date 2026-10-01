import { z } from 'zod';
import type { AgentMessage } from '@/lib/agent/types';
import type {
  EvalPackManifest,
  EvalSample,
  ScorerType,
  Verdict,
} from '../types';

export interface SandboxSnapshot {
  files: Array<{ path: string; size: number; hash: string; content?: string }>;
}

export interface ScorerInput {
  sample: EvalSample;
  pack: EvalPackManifest;
  outputText: string;
  reasoningText?: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  transcript?: AgentMessage[];
  finalState?: SandboxSnapshot;
  extra?: Record<string, unknown>;
}

export interface ScorerResult {
  value: number;
  verdict: Verdict;
  reason: string;
  extracted?: string;
}

export interface ScorerContext {
  signal: AbortSignal;
}

export interface Scorer {
  type: ScorerType;
  optionsSchema: z.ZodTypeAny;
  requiresAsync?: boolean;
  score(input: ScorerInput, options: unknown, ctx: ScorerContext): Promise<ScorerResult>;
}

export function parseScorerOptions<T>(schema: z.ZodType<T>, options: unknown): T {
  return schema.parse(options ?? {});
}

export function correct(value: number, reason: string, extracted?: string): ScorerResult {
  return { value, verdict: 'correct', reason, extracted };
}

export function incorrect(reason: string, extracted?: string): ScorerResult {
  return { value: 0, verdict: 'incorrect', reason, extracted };
}

export function noAnswer(reason: string): ScorerResult {
  return { value: 0, verdict: 'no_answer', reason };
}
