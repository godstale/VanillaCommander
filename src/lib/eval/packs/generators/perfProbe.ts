import { z } from 'zod';
import type { EvalSample } from '../../types';
import { registerGenerator } from './index';

const GENERATOR_NAME = 'perf-probe-v1';

const DEFAULT_CONTEXT_TOKENS = 8192;
const DEFAULT_SEED = 20260925;

const TierSchema = z.enum(['smoke', 'standard', 'full']);
type Tier = z.infer<typeof TierSchema>;

const ParamsSchema = z.object({
  tier: TierSchema.default('full'),
  contextTokens: z.number().int().positive().default(DEFAULT_CONTEXT_TOKENS),
  seed: z.number().int().default(DEFAULT_SEED),
});

// Fixed continue-writing instruction shared by every scenario; scenarios
// differ only in their declared token load (perf.*), not in prompt text.
const CONTINUE_INSTRUCTION = [
  'Continue writing: extend the passage below in the same style for a general audience.',
  '다음 글을 같은 문체로 자연스럽게 이어서 작성하세요.',
  '',
  'The old ferry crossed the gray strait every morning, carrying letters, bread, and sleepy passengers.',
  '오래된 나룻배는 매일 아침 회색 해협을 건너 편지와 빵과 졸린 승객들을 실어 날랐다.',
].join('\n');

interface Scenario {
  id: string;
  name: string;
  inputTokens: number | null;
  inputRatio: number | null;
  outputTokens: number;
  depthRatio?: number;
}

const SCENARIOS: Scenario[] = [
  { id: 'S1', name: 'chat', inputTokens: 64, inputRatio: null, outputTokens: 128 },
  { id: 'S2', name: 'mid', inputTokens: 512, inputRatio: null, outputTokens: 512 },
  { id: 'S3', name: 'summary', inputTokens: 1024, inputRatio: null, outputTokens: 256 },
  { id: 'S4', name: 'long-in', inputTokens: 2048, inputRatio: null, outputTokens: 512 },
  { id: 'S5', name: 'docqa', inputTokens: 4096, inputRatio: null, outputTokens: 256 },
  { id: 'S6', name: 'long-out', inputTokens: 4096, inputRatio: null, outputTokens: 1024 },
  { id: 'S7', name: 'depth50', inputTokens: null, inputRatio: 0.5, outputTokens: 128, depthRatio: 0.5 },
  { id: 'S8', name: 'depth90', inputTokens: null, inputRatio: 0.9, outputTokens: 128, depthRatio: 0.9 },
];

const SMOKE_IDS = ['S1', 'S3', 'S5'];
const STANDARD_IDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];

export function scenarioIdsForTier(tier: Tier): string[] {
  if (tier === 'smoke') return [...SMOKE_IDS];
  if (tier === 'standard') return [...STANDARD_IDS];
  return SCENARIOS.map((s) => s.id);
}

async function generate(rawParams: Record<string, unknown>): Promise<EvalSample[]> {
  const params = ParamsSchema.parse(rawParams ?? {});
  const wanted = new Set(scenarioIdsForTier(params.tier));
  return SCENARIOS.filter((s) => wanted.has(s.id)).map((s) => {
    const inputTokens =
      s.inputTokens ?? Math.round(params.contextTokens * (s.inputRatio ?? 0));
    return {
      id: s.id,
      input: CONTINUE_INSTRUCTION,
      perf: {
        inputTokens,
        outputTokens: s.outputTokens,
        ...(s.depthRatio !== undefined ? { depthRatio: s.depthRatio } : {}),
      },
      tags: ['perf-probe', s.name],
      metadata: {
        generator: GENERATOR_NAME,
        scenario: s.name,
        tier: params.tier,
      },
    };
  });
}

export function registerPerfProbeGenerator(): void {
  registerGenerator(GENERATOR_NAME, generate);
}

registerPerfProbeGenerator();
