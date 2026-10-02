import { z } from 'zod';
import type { LlmProviderKind } from '@/lib/types/agent';

// P11-02: 평가 전용 목적(judge/reference-generation/pack-drafting/candidate)은 제거.
// Vanilla Commander 용도만 남긴다.
export const INTEGRATION_PURPOSES = ['chat-agent', 'wiki-ingest', 'doc-parse'] as const;
export type IntegrationPurpose = (typeof INTEGRATION_PURPOSES)[number];

export const DATA_CLASSES = ['public-bundled', 'personal', 'fixture-files'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

// agent.ts 유니온과 동일한 값 목록. 어긋나면 컴파일 단계에서 깨진다.
const IntegrationLlmProviderSchema = z.enum([
  'ollama',
  'lmstudio',
  'llamacpp',
  'vllm',
  'jan',
  'openai-compatible',
  'openai',
  'anthropic',
  'gemini',
  'xai',
  'deepseek',
  'openrouter',
  'mistral',
  'moonshot',
  'together',
  'opencode',
  'external-agent',
]) satisfies z.ZodType<LlmProviderKind>;

// 동의 개정(채팅·파일 내용 외부 전송) 시 올린다. 버전이 다르면 기존 동의는 무효.
export const CONSENT_TEXT_VERSION = 'consent-v2';

export const ExternalIntegrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['llm-api', 'agent-cli']),
  enabled: z.boolean(),
  llm: z.object({
    provider: IntegrationLlmProviderSchema,
    baseUrl: z.string(),
    model: z.string(),
    apiKey: z.string().optional(),
  }).optional(),
  cli: z.object({
    executablePath: z.string(),
    args: z.array(z.string()),
    promptVia: z.enum(['stdin', 'file']),
    outputFormat: z.enum(['text', 'json']),
    jsonPath: z.string().optional(),
    timeoutMs: z.number().int().default(180000),
  }).optional(),
  allowedPurposes: z.array(z.enum(INTEGRATION_PURPOSES)),
  allowedDataClasses: z.array(z.enum(DATA_CLASSES)),
  consent: z.object({
    version: z.string(),
    grantedAt: z.string(),
    purposes: z.array(z.enum(INTEGRATION_PURPOSES)),
    dataClasses: z.array(z.enum(DATA_CLASSES)),
  }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExternalIntegration = z.infer<typeof ExternalIntegrationSchema>;

export const IntegrationSettingsSchema = z.object({
  masterEnabled: z.boolean().default(false),
  trustedLanHosts: z.array(z.string()).default([]),
  allowLocalCodeExecution: z.boolean().default(false),
});
export type IntegrationSettings = z.infer<typeof IntegrationSettingsSchema>;

export interface IntegrationAuditRow {
  id: string;
  integrationId: string;
  purpose: IntegrationPurpose;
  dataClasses: DataClass[];
  runId: string | null;
  requestCount: number;
  bytesSent: number;
  status: 'ok' | 'error';
  error: string | null;
  createdAt: string;
}
