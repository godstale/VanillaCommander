import type { BuiltinToolId } from '@/lib/types/agent';
import type { EvalCategoryId, EvalDimension, EvalProfile } from './types';

export const CATEGORY_META: Record<
  EvalCategoryId,
  { dimension: EvalDimension; labelKey: string; countsTowardComposite: boolean }
> = {
  Q1: { dimension: 'Q', labelKey: 'eval.common.cat.Q1', countsTowardComposite: true },
  Q2: { dimension: 'Q', labelKey: 'eval.common.cat.Q2', countsTowardComposite: true },
  Q3: { dimension: 'Q', labelKey: 'eval.common.cat.Q3', countsTowardComposite: true },
  Q4: { dimension: 'Q', labelKey: 'eval.common.cat.Q4', countsTowardComposite: true },
  Q5: { dimension: 'Q', labelKey: 'eval.common.cat.Q5', countsTowardComposite: true },
  Q6: { dimension: 'Q', labelKey: 'eval.common.cat.Q6', countsTowardComposite: true },
  Q7: { dimension: 'Q', labelKey: 'eval.common.cat.Q7', countsTowardComposite: true },
  Q8: { dimension: 'Q', labelKey: 'eval.common.cat.Q8', countsTowardComposite: false },
  Q9: { dimension: 'Q', labelKey: 'eval.common.cat.Q9', countsTowardComposite: true },
  A1: { dimension: 'A', labelKey: 'eval.common.cat.A1', countsTowardComposite: true },
  A2: { dimension: 'A', labelKey: 'eval.common.cat.A2', countsTowardComposite: true },
  A3: { dimension: 'A', labelKey: 'eval.common.cat.A3', countsTowardComposite: true },
  A4: { dimension: 'A', labelKey: 'eval.common.cat.A4', countsTowardComposite: true },
  A5: { dimension: 'A', labelKey: 'eval.common.cat.A5', countsTowardComposite: true },
  A6: { dimension: 'A', labelKey: 'eval.common.cat.A6', countsTowardComposite: true },
  P1: { dimension: 'P', labelKey: 'eval.common.cat.P1', countsTowardComposite: true },
  P2: { dimension: 'P', labelKey: 'eval.common.cat.P2', countsTowardComposite: true },
  R1: { dimension: 'R', labelKey: 'eval.common.cat.R1', countsTowardComposite: true },
  S1: { dimension: 'S', labelKey: 'eval.common.cat.S1', countsTowardComposite: true },
};

export interface AnchorSpec {
  curve: 'log' | 'linear';
  dir: 'up' | 'down';
  zero: number;
  full: number;
}

export const ANCHORS_VERSION_V1 = 'anchors-v1';

export const ANCHORS_V1: Record<string, AnchorSpec> = {
  decode_tps: { curve: 'log', dir: 'up', zero: 3, full: 60 },
  prefill_tps: { curve: 'log', dir: 'up', zero: 50, full: 3000 },
  ttft_p50_ms: { curve: 'log', dir: 'down', zero: 15000, full: 500 },
  load_ms: { curve: 'log', dir: 'down', zero: 60000, full: 3000 },
  depth_retention: { curve: 'linear', dir: 'up', zero: 0.3, full: 0.9 },
  vram_headroom: { curve: 'linear', dir: 'up', zero: 0, full: 0.15 },
  gpu_offload: { curve: 'linear', dir: 'up', zero: 0.5, full: 1.0 },
};

export const CONSTRAINT_METRICS = [
  'vram_headroom',
  'failure_rate',
  'format_error_rate',
  'decode_tps',
  'ttft_p50_ms',
  'effective_context_tokens',
] as const;
export type ConstraintMetricKey = (typeof CONSTRAINT_METRICS)[number] | EvalCategoryId;

function profile(
  id: string,
  koName: string,
  enName: string,
  koDesc: string,
  enDesc: string,
  dimensionWeights: EvalProfile['dimensionWeights'],
  categoryWeights: Record<string, number>,
  constraints: EvalProfile['constraints'],
): EvalProfile {
  return {
    id,
    name: { ko: koName, en: enName },
    builtIn: true,
    description: { ko: koDesc, en: enDesc },
    dimensionWeights,
    categoryWeights,
    anchorsVersion: ANCHORS_VERSION_V1,
    anchorOverrides: {},
    constraints,
    arena: { enabled: false, minVotes: 30 },
  };
}

const i18n = (ko: string, en: string) => ({ ko, en });

export const BUILTIN_PROFILES: EvalProfile[] = [
  profile(
    'balanced',
    '균형',
    'Balanced',
    '품질·에이전트·성능·자원·신뢰성을 균형 있게 봅니다.',
    'Balanced view across quality, agent, performance, resource, and reliability.',
    { Q: 30, A: 25, P: 20, R: 10, S: 15 },
    { Q9: 2 },
    [
      { metric: 'vram_headroom', op: '>=', value: 0.05, label: i18n('VRAM 여유 ≥ 5%', 'VRAM headroom ≥ 5%') },
      { metric: 'failure_rate', op: '<=', value: 0.1, label: i18n('실패율 ≤ 10%', 'Failure rate ≤ 10%') },
    ],
  ),
  profile(
    'coding-agent',
    '코딩 에이전트',
    'Coding agent',
    '도구 사용과 코드 작성 능력을 중시합니다.',
    'Emphasizes tool use and code generation.',
    { Q: 25, A: 40, P: 15, R: 5, S: 15 },
    { Q5: 3, A1: 2, A3: 3, Q9: 2 },
    [
      { metric: 'A1', op: '>=', value: 70, label: i18n('도구 선택(A1) ≥ 70', 'Tool selection (A1) ≥ 70') },
      { metric: 'format_error_rate', op: '<=', value: 0.1, label: i18n('형식 오류율 ≤ 10%', 'Format error rate ≤ 10%') },
    ],
  ),
  profile(
    'ko-writing',
    '한국어 문서 작성',
    'Korean writing',
    '한국어 지식·지시 따르기·작문을 중시합니다.',
    'Emphasizes Korean knowledge, instruction following, and writing.',
    { Q: 45, A: 10, P: 20, R: 10, S: 15 },
    { Q1: 1.5, Q3: 2, Q4: 3, Q9: 3, Q2: 0.5, Q5: 0 },
    [
      { metric: 'decode_tps', op: '>=', value: 10, label: i18n('생성 속도 ≥ 10 tok/s', 'Decode ≥ 10 tok/s') },
    ],
  ),
  profile(
    'fast-response',
    '빠른 응답',
    'Fast response',
    '응답 속도를 중시합니다.',
    'Emphasizes response speed.',
    { Q: 25, A: 15, P: 40, R: 10, S: 10 },
    { P1: 2 },
    [
      { metric: 'ttft_p50_ms', op: '<=', value: 2000, label: i18n('첫 토큰 ≤ 2초', 'TTFT p50 ≤ 2s') },
    ],
  ),
  profile(
    'long-docs',
    '긴 문서 분석',
    'Long documents',
    '긴 컨텍스트 이해와 압축 후 기억을 중시합니다.',
    'Emphasizes long-context understanding and recall after compaction.',
    { Q: 30, A: 15, P: 20, R: 20, S: 15 },
    { Q6: 4, A6: 2 },
    [
      { metric: 'effective_context_tokens', op: '>=', value: 32768, label: i18n('실효 컨텍스트 ≥ 32k', 'Effective context ≥ 32k') },
    ],
  ),
];

export const DEFAULT_RUN_OPTIONS = {
  deterministicMode: false,
  reliabilityEpochs: 3,
  timeoutMultiplier: 1,
  perfRepeats: 3,
  unloadBetweenCandidates: true,
} as const;

export const EVAL_TOOLS_ALLOWED: BuiltinToolId[] = ['read', 'ls', 'grep', 'find', 'write', 'edit'];

export const CONSENT_TEXT_VERSION = 'consent-v1';
export const JUDGE_PROMPT_VERSION = 'judge-v1';
