import { describe, expect, it } from 'vitest';
import { TOOL_RISK_MAP } from '@/lib/tools/risk';
import {
  type BuiltinToolId as AgentBuiltinToolId,
  type LlmProviderKind,
} from '@/lib/types/agent';
import { LLM_PROVIDER_PRESETS } from '@/lib/llm/providers';
import {
  BuiltinToolIdSchema,
  EVAL_CATEGORIES,
  EvalPackManifestSchema,
  EvalProfileSchema,
  EvalSampleSchema,
  LlmProviderKindSchema,
} from './types';
import { BUILTIN_PROFILES } from './constants';

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0',
    id: 'fab-tools-select',
    version: '1.0.0',
    title: { ko: '도구 선택', en: 'Tool selection' },
    description: { ko: '설명', en: 'Description' },
    category: 'A1',
    lang: ['ko'],
    license: { id: 'fortress-fab' },
    kind: 'tool_call',
    source: { type: 'jsonl', file: 'samples.jsonl' },
    tools: 'fortress-default',
    scorers: [{ type: 'tool_call_ast' }],
    metrics: [
      {
        id: 'accuracy',
        description: { ko: '정확도', en: 'Accuracy' },
        source: 'score',
        aggregation: 'mean',
        lowerIsBetter: false,
        scoreType: 'binary',
        range: { min: 0, max: 1 },
        normalization: { kind: 'baseline', baseline: 0 },
      },
    ],
    tiers: { smoke: 15, standard: 60, full: 60 },
    ...overrides,
  };
}

describe('eval types', () => {
  it('parses a valid manifest and sample', () => {
    const manifest = EvalPackManifestSchema.safeParse(validManifest());
    expect(manifest.success).toBe(true);
    const sample = EvalSampleSchema.safeParse({
      id: 's1',
      input: 'hello',
      metadata: { difficulty: 'easy' },
    });
    expect(sample.success).toBe(true);
  });

  it('rejects invalid pack id and enum values', () => {
    expect(
      EvalPackManifestSchema.safeParse(validManifest({ id: 'Bad_ID' })).success,
    ).toBe(false);
    expect(
      EvalPackManifestSchema.safeParse(validManifest({ category: 'ZZ' })).success,
    ).toBe(false);
    expect(
      EvalSampleSchema.safeParse({ id: 's1', input: 123 }).success,
    ).toBe(false);
  });

  it('validates all builtin profiles', () => {
    expect(BUILTIN_PROFILES).toHaveLength(5);
    for (const p of BUILTIN_PROFILES) {
      expect(EvalProfileSchema.safeParse(p).success).toBe(true);
    }
  });

  it('keeps provider and tool unions in sync with agent runtime', () => {
    const presetKinds = new Set<string>(Object.keys(LLM_PROVIDER_PRESETS));
    const schemaKinds = new Set<string>(
      (LlmProviderKindSchema.options as readonly string[]).slice(),
    );
    // 스키마가 모든 프리셋 kind를 포함하는지 (superset 허용, 누락 금지)
    for (const kind of presetKinds) {
      expect(schemaKinds.has(kind)).toBe(true);
    }
    // agent.ts 타입과 동일한 값 목록인지 (컴파일 수준 확인용 런타임 검사)
    const agentProviderSample: LlmProviderKind = 'ollama';
    expect(LlmProviderKindSchema.safeParse(agentProviderSample).success).toBe(true);

    const registryIds = new Set<string>(Object.keys(TOOL_RISK_MAP));
    const schemaTools = BuiltinToolIdSchema.options as readonly string[];
    for (const tool of schemaTools) {
      expect(registryIds.has(tool)).toBe(true);
    }
    const agentToolSample: AgentBuiltinToolId = 'read';
    expect(BuiltinToolIdSchema.safeParse(agentToolSample).success).toBe(true);
    expect(EVAL_CATEGORIES).toContain('Q8');
  });
});
