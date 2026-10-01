import { getIntegrationSettings, listIntegrations } from '@/lib/db/repositories/integrationsRepo';
import type { appendAudit as appendAuditFn } from '@/lib/db/repositories/integrationsRepo';
import { getProviderPreset } from '@/lib/llm/providers';
import { getStreamChatFn } from '@/lib/llm/providerRuntime';
import { CONSENT_TEXT_VERSION } from '../constants';
import type {
  DataClass,
  ExternalIntegration,
  IntegrationPurpose,
  IntegrationSettings,
} from '../types';
import {
  extractJsonPath,
  formatMessagesAsPrompt,
  runIntegrationCli,
} from './cliRunner';

export interface ExternalRequestMessage {
  role: string;
  content: string;
}

export interface ExternalRequest {
  purpose: IntegrationPurpose;
  dataClasses: DataClass[];
  runId?: string;
  messages: ExternalRequestMessage[];
  responseFormat?: 'text' | 'json';
  maxTokens?: number;
  temperature?: number;
}

export type PermissionResult = { ok: true } | { ok: false; reasonKey: string };

export type ExternalCallResult =
  | { ok: true; text: string }
  | { ok: false; reasonKey: string; error?: string };

/**
 * 5단계 전송 허용 검사. 거부 시 전송 없이 `{ ok:false, reasonKey }`만 반환한다.
 * 1. 마스터 스위치 → 2. 연동 활성화 → 3. 동의 존재+버전 일치 →
 * 4. 목적 허용 → 5. 데이터 등급 subset
 */
export function checkPermission(
  integration: ExternalIntegration,
  settings: IntegrationSettings,
  purpose: IntegrationPurpose,
  dataClasses: DataClass[],
): PermissionResult {
  if (!settings.masterEnabled) {
    return { ok: false, reasonKey: 'eval.integrations.denied.masterOff' };
  }
  if (!integration.enabled) {
    return { ok: false, reasonKey: 'eval.integrations.denied.disabled' };
  }
  const consent = integration.consent;
  if (!consent) {
    return { ok: false, reasonKey: 'eval.integrations.denied.noConsent' };
  }
  if (consent.version !== CONSENT_TEXT_VERSION) {
    return { ok: false, reasonKey: 'eval.integrations.denied.staleConsent' };
  }
  if (!integration.allowedPurposes.includes(purpose) || !consent.purposes.includes(purpose)) {
    return { ok: false, reasonKey: 'eval.integrations.denied.purpose' };
  }
  const allowed = new Set<string>([...integration.allowedDataClasses, ...consent.dataClasses]);
  // 요청 등급은 허용 목록과 동의 범위 모두의 부분집합이어야 한다
  const consentSet = new Set<string>(consent.dataClasses);
  const allowedSet = new Set<string>(integration.allowedDataClasses);
  if (dataClasses.some((d) => !allowed.has(d) || !consentSet.has(d) || !allowedSet.has(d))) {
    return { ok: false, reasonKey: 'eval.integrations.denied.dataClass' };
  }
  return { ok: true };
}

/** 요청 메시지 전체의 UTF-8 바이트 합. 감사 로그(bytesSent)용. */
export function measureRequestBytes(messages: ExternalRequestMessage[]): number {
  const enc = new TextEncoder();
  return messages.reduce((sum, m) => sum + enc.encode(`${m.role}\n${m.content}`).length, 0);
}

type AuditFn = typeof appendAuditFn;
type CliRunFn = typeof runIntegrationCli;
type StreamFn = ReturnType<typeof getStreamChatFn>;

export interface GatewayDeps {
  loadIntegration?: (id: string) => Promise<ExternalIntegration | undefined>;
  loadSettings?: () => Promise<IntegrationSettings>;
  streamFn?: StreamFn;
  cliRun?: CliRunFn;
  audit?: AuditFn;
}

async function defaultLoadIntegration(id: string): Promise<ExternalIntegration | undefined> {
  const all = await listIntegrations();
  return all.find((i) => i.id === id);
}

interface PendingBatch {
  integrationId: string;
  purpose: IntegrationPurpose;
  runId: string;
  dataClasses: Set<string>;
  requestCount: number;
  bytesSent: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const pendingBatches = new Map<string, PendingBatch>();
const BATCH_DEBOUNCE_MS = 1000;

function batchKey(integrationId: string, runId: string): string {
  return `${integrationId}\n${runId}`;
}

async function flushBatch(key: string, audit: AuditFn): Promise<void> {
  const batch = pendingBatches.get(key);
  if (!batch) return;
  pendingBatches.delete(key);
  if (batch.timer) clearTimeout(batch.timer);
  await audit({
    integrationId: batch.integrationId,
    purpose: batch.purpose,
    dataClasses: [...batch.dataClasses] as DataClass[],
    runId: batch.runId,
    requestCount: batch.requestCount,
    bytesSent: batch.bytesSent,
    status: 'ok',
    error: null,
  });
}

/** 테스트·종료 시 대기 중인 배치 감사를 즉시 기록한다. */
export async function flushAuditBatches(audit?: AuditFn): Promise<void> {
  const fn = audit ?? (await import('@/lib/db/repositories/integrationsRepo')).appendAudit;
  for (const key of [...pendingBatches.keys()]) {
    await flushBatch(key, fn);
  }
}

function scheduleBatchFlush(key: string, audit: AuditFn): void {
  const batch = pendingBatches.get(key);
  if (!batch) return;
  if (batch.timer) clearTimeout(batch.timer);
  batch.timer = setTimeout(() => {
    void flushBatch(key, audit);
  }, BATCH_DEBOUNCE_MS);
}

async function recordSuccess(
  integrationId: string,
  req: ExternalRequest,
  bytes: number,
  audit: AuditFn,
): Promise<void> {
  if (req.runId) {
    const key = batchKey(integrationId, req.runId);
    const existing = pendingBatches.get(key);
    if (existing) {
      for (const d of req.dataClasses) existing.dataClasses.add(d);
      existing.requestCount += 1;
      existing.bytesSent += bytes;
    } else {
      pendingBatches.set(key, {
        integrationId,
        purpose: req.purpose,
        runId: req.runId,
        dataClasses: new Set<string>(req.dataClasses),
        requestCount: 1,
        bytesSent: bytes,
        timer: null,
      });
    }
    scheduleBatchFlush(key, audit);
    return;
  }
  await audit({
    integrationId,
    purpose: req.purpose,
    dataClasses: req.dataClasses,
    runId: null,
    requestCount: 1,
    bytesSent: bytes,
    status: 'ok',
    error: null,
  });
}

/**
 * 외부 연동 호출. 권한 검사 → llm-api(getStreamChatFn 수집 텍스트) 또는
 * agent-cli(cliRunner) 실행 → appendAudit 기록. 거부 시 네트워크·프로세스
 * 호출 없이 `{ ok:false, reasonKey }`를 반환한다.
 */
export async function callIntegration(
  integrationId: string,
  req: ExternalRequest,
  signal?: AbortSignal,
  deps?: GatewayDeps,
): Promise<ExternalCallResult> {
  const loadIntegration = deps?.loadIntegration ?? defaultLoadIntegration;
  const loadSettings = deps?.loadSettings ?? getIntegrationSettings;
  const audit: AuditFn =
    deps?.audit ?? (await import('@/lib/db/repositories/integrationsRepo')).appendAudit;

  const integration = await loadIntegration(integrationId);
  if (!integration) {
    return { ok: false, reasonKey: 'eval.integrations.error.notFound' };
  }
  const settings = await loadSettings();
  const permission = checkPermission(integration, settings, req.purpose, req.dataClasses);
  const bytes = measureRequestBytes(req.messages);
  if (!permission.ok) {
    await audit({
      integrationId,
      purpose: req.purpose,
      dataClasses: req.dataClasses,
      runId: req.runId ?? null,
      requestCount: 0,
      bytesSent: 0,
      status: 'error',
      error: permission.reasonKey,
    });
    return permission;
  }

  try {
    if (integration.kind === 'llm-api') {
      const text = await callLlmApi(integration, req, signal, deps?.streamFn);
      await recordSuccess(integrationId, req, bytes, audit);
      return { ok: true, text };
    }
    const text = await callAgentCli(integration, req, deps?.cliRun ?? runIntegrationCli);
    await recordSuccess(integrationId, req, bytes, audit);
    return { ok: true, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await audit({
      integrationId,
      purpose: req.purpose,
      dataClasses: req.dataClasses,
      runId: req.runId ?? null,
      requestCount: 1,
      bytesSent: bytes,
      status: 'error',
      error: message,
    });
    return { ok: false, reasonKey: 'eval.integrations.error.callFailed', error: message };
  }
}

async function callLlmApi(
  integration: ExternalIntegration,
  req: ExternalRequest,
  signal: AbortSignal | undefined,
  injectedStream: StreamFn | undefined,
): Promise<string> {
  const llm = integration.llm;
  if (!llm) throw new Error('llm-api integration has no llm config');
  const preset = getProviderPreset(llm.provider);
  const streamFn =
    injectedStream ?? getStreamChatFn({ openAiCompatible: preset.openAiCompatible });
  let text = '';
  for await (const chunk of streamFn(
    {
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      model: llm.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: req.temperature,
      maxTokens: req.maxTokens,
    },
    signal,
  )) {
    if (chunk.content) text += chunk.content;
  }
  return text;
}

async function callAgentCli(
  integration: ExternalIntegration,
  req: ExternalRequest,
  cliRun: CliRunFn,
): Promise<string> {
  const cli = integration.cli;
  if (!cli) throw new Error('agent-cli integration has no cli config');
  const prompt = formatMessagesAsPrompt(
    req.messages.map((m) => ({ role: m.role, content: m.content })),
  );
  const out = await cliRun({
    executablePath: cli.executablePath,
    args: cli.args,
    stdinText: prompt,
    promptFileText: prompt,
    timeoutMs: cli.timeoutMs,
  });
  if (out.timedOut) throw new Error(`CLI timed out after ${cli.timeoutMs}ms`);
  if (out.exitCode !== 0) {
    throw new Error(`CLI exited with code ${out.exitCode}: ${out.stderr.slice(0, 500)}`);
  }
  if (cli.outputFormat === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(out.stdout);
    } catch {
      throw new Error('CLI output is not valid JSON');
    }
    const extracted = extractJsonPath(parsed, cli.jsonPath ?? '');
    if (extracted === undefined) {
      throw new Error(`jsonPath not found: ${cli.jsonPath ?? ''}`);
    }
    return typeof extracted === 'string' ? extracted : JSON.stringify(extracted);
  }
  return out.stdout;
}
