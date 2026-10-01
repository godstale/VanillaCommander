import type { AgentMessage } from '@/lib/agent/types';
import type { LlmStreamChatFn } from '@/lib/llm/providerRuntime';
import type { ResolvedLlmRuntime } from '@/lib/llm/providers';
import type {
  CandidateSnapshot,
  EvalSample,
  TrialOutcome,
} from '../../types';
import type { LoadedPack } from '../../packs/packLoader';
import type { SandboxSnapshot } from '../../scorers/types';
import type { ResourceSampler } from '../resourceSampler';
import type { RunnerEvent } from '../events';

export interface SolverContext {
  runId: string;
  candidate: CandidateSnapshot;
  runtime: ResolvedLlmRuntime;
  apiKey?: string;
  pack: LoadedPack;
  sample: EvalSample;
  epoch: number;
  rotation?: number;
  streamChat: LlmStreamChatFn;
  signal: AbortSignal;
  timeoutMs: number;
  sampler: ResourceSampler;
  emit: (e: RunnerEvent) => void;
}

export interface TrialTimingResult {
  ttftMs: number | null;
  prefillTps: number | null;
  decodeTps: number | null;
  totalMs: number;
  timingSource: 'server' | 'client';
  cacheHit: boolean | null;
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
}

export interface SolverResult {
  outcome: TrialOutcome;
  outputText: string;
  reasoningText?: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  transcript?: AgentMessage[];
  finalState?: SandboxSnapshot;
  extra?: Record<string, unknown>;
  usage: { input?: number; output?: number; thinking?: number };
  timing: TrialTimingResult;
  turns?: number;
}

export type Solver = (ctx: SolverContext) => Promise<SolverResult>;

const solverRegistry = new Map<string, Solver>();

export function registerSolver(kind: string, solver: Solver): void {
  solverRegistry.set(kind, solver);
}

export function getSolver(kind: string): Solver {
  const solver = solverRegistry.get(kind);
  if (!solver) throw new Error(`Unknown solver kind: ${kind}`);
  return solver;
}
