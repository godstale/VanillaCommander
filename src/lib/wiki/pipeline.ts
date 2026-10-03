// P11-32: 위키 처리 파이프라인. `wiki://file-event` → 필터 → 직렬 1건씩 →
// ① 내용 추출 → ② LLM 1회 분류 호출 → ③ (옵션) 이동 → ④ wiki ingest.
// 에이전트 루프 대신 단일 구조화 호출을 쓴다 (예측 가능·저비용).
import { z } from 'zod';
import { listen } from '@tauri-apps/api/event';
import type { Agent } from '@/lib/types/agent';
import type { WikiSettings } from '@/lib/db/repositories/settingsRepo';
import type { ParserSettings } from '@/lib/db/repositories/settingsRepo';
import type { LlmStreamChatFn } from '@/lib/llm/providerRuntime';
import { getStreamChatFn, resolveAgentLlmRuntime } from '@/lib/llm/providerRuntime';
import { streamChat as streamOllamaChat } from '@/lib/llm/ollamaClient';
import { streamChat as streamOpenAiChat } from '@/lib/llm/openAiCompatibleClient';
import { resolveImageDataUrls } from '@/lib/llm/messageMapper';
import { resolveVisionSupport } from '@/lib/llm/vision';
import { getProviderPreset } from '@/lib/llm/providers';
import { chatQueueManager } from '@/lib/agent/chatQueueManager';
import { parseDocument, ParseError } from '@/lib/parsers/index';
import {
  DEFAULT_WIKI_PROMPT,
  resolveInboxDir,
  shouldProcessFile,
} from './settings';
import {
  createWikiJob,
  updateWikiJob,
  getWikiJobsByStatus,
  type WikiJob,
} from '@/lib/db/repositories/wikiJobsRepo';
import { createWikiTool, slugifyWikiTitle } from '@/lib/tools/wiki';
import { fcListDir, fcMkdir, fcMove, fcReadFileBytes } from '@/lib/commander/ipc';
import type { FcProgressEvent } from '@/lib/commander/types';
import { checkPermission } from '@/lib/integrations/gateway';
import {
  getIntegrationSettings,
  listIntegrations,
} from '@/lib/db/repositories/integrationsRepo';

export interface WikiPipelineContext {
  workspaceRoot: string;
  /** 작업 폴더 (wiki-inbox 기본 위치). 미지정 시 workspaceRoot를 쓴다. */
  workFolder?: string;
  /** 구 Agent 전역 Ollama 주소 (Agent 고유값이 없을 때). */
  ollamaBaseUrl?: string;
  getWikiSettings: () => WikiSettings;
  getParserSettings?: () => ParserSettings;
  getAgents: () => Agent[];
  getDefaultAgent: () => Agent;
  /** 테스트 주입용 분류 호출. 미지정 시 Provider 분기로 만든다. */
  streamChatFn?: LlmStreamChatFn;
}

export interface WikiPipelineStatus {
  active: boolean;
  pending: number;
  lastDoneAt: string | null;
  lastError: string | null;
}

type StatusListener = (status: WikiPipelineStatus) => void;

const CLASSIFICATION_PROMPT_CHARS = 24_000;

const ClassificationSchema = z.object({
  classification: z.enum(['date', 'serial', 'frequency']),
  folderName: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(80),
  summary: z.string().min(1).max(2000),
  tags: z.array(z.string().max(40)).max(10).default([]),
});

export type Classification = z.infer<typeof ClassificationSchema>;

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

function extOfPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function baseNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`;
}

/** 날짜순 폴백 폴더 `YYYY/MM-DD`. */
export function dateFolderName(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}/${m}-${d}`;
}

/** 코드펜스·앞뒤 잡음을 걷고 첫 JSON 객체를 파싱한다. */
export function extractJsonObject(raw: string): unknown {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object found.');
  return JSON.parse(text.slice(start, end + 1));
}

async function collectChat<Req>(
  fn: (req: Req, signal?: AbortSignal) => AsyncIterable<{ content?: string }>,
  req: Req,
  signal?: AbortSignal,
): Promise<string> {
  let out = '';
  for await (const chunk of fn(req, signal)) {
    if (chunk.content) out += chunk.content;
  }
  return out.trim();
}

async function classifyContent(
  agent: Agent,
  runtimeBaseUrl: string | undefined,
  systemPrompt: string,
  userPrompt: string,
  streamChatFn?: LlmStreamChatFn,
): Promise<Classification> {
  const runtime = resolveAgentLlmRuntime(
    {
      llmProvider: agent.llmProvider,
      llmBaseUrl: agent.llmBaseUrl ?? runtimeBaseUrl,
      llmApiKey: agent.llmApiKey,
    },
    runtimeBaseUrl,
  );
  const fn = getStreamChatFn(
    {
      ...runtime,
      externalAgentId: agent.externalAgentId,
    },
    streamChatFn,
  );
  const run = async (prompt: string): Promise<Classification> => {
    const raw = await collectChat(fn, {
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      model: agent.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    });
    return ClassificationSchema.parse(extractJsonObject(raw));
  };
  try {
    return await run(userPrompt);
  } catch {
    // 1회 재시도 후 날짜순 폴백 (P11-32 명세).
    try {
      return await run(`${userPrompt}\n\n반드시 위 JSON 스키마로만 답하라. 설명 문장을 붙이지 마라.`);
    } catch {
      const fileName = userPrompt.match(/^파일: (.+?) \(/m)?.[1] ?? 'unfiled';
      return {
        classification: 'date' as const,
        folderName: dateFolderName(),
        title: fileName,
        slug: `${slugifyWikiTitle(fileName)}-${Date.now().toString(36)}`.slice(0, 80),
        summary: '자동 분류에 실패해 날짜순으로 보관한다.',
        tags: [],
      };
    }
  }
}

/** 이미지 내용을 텍스트로 기술한다 (비전 에이전트 1회 호출). */
async function describeImage(
  agent: Agent,
  runtimeBaseUrl: string | undefined,
  imagePath: string,
): Promise<string> {
  const runtime = resolveAgentLlmRuntime(
    {
      llmProvider: agent.llmProvider,
      llmBaseUrl: agent.llmBaseUrl ?? runtimeBaseUrl,
      llmApiKey: agent.llmApiKey,
    },
    runtimeBaseUrl,
  );
  const prompt =
    '이 이미지에 보이는 내용을 한국어로 자세히 설명하라. 문서면 핵심 내용을 정리하고, 사진이면 장면·객체·텍스트를 적어라.';
  if (agent.llmProvider === 'external-agent') {
    throw new Error('외부 에이전트로는 이미지를 전송할 수 없습니다.');
  }
  if (runtime.openAiCompatible) {
    const urls = await resolveImageDataUrls([imagePath]);
    return collectChat(streamOpenAiChat, {
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      model: agent.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: urls[0] } },
          ],
        },
      ],
      temperature: 0.2,
    });
  }
  return collectChat(streamOllamaChat, {
    baseUrl: runtime.baseUrl,
    model: agent.model,
    messages: [{ role: 'user', content: prompt, images: [imagePath] }],
    temperature: 0.2,
  });
}

async function resolveProcessor(
  settings: WikiSettings,
  agents: Agent[],
  defaultAgent: Agent,
): Promise<{ agent: Agent; externalBlocked: boolean }> {
  const configured = settings.agentId
    ? agents.find((a) => a.id === settings.agentId)
    : undefined;
  const agent = configured ?? defaultAgent;
  const category = getProviderPreset(agent.llmProvider).category;
  if (category === 'local') return { agent, externalBlocked: false };
  // 외부(클라우드/게이트웨이/외부 에이전트)는 wiki-ingest 허용 시에만.
  // 클라우드 직결은 persisted 동의가 없으므로 로컬로 폴백하고,
  // 외부 에이전트는 연동 동의·목적을 확인한다.
  if (agent.llmProvider === 'external-agent' && agent.externalAgentId) {
    try {
      const [integrations, integrationSettings] = await Promise.all([
        listIntegrations(),
        getIntegrationSettings(),
      ]);
      const integration = integrations.find((i) => i.id === agent.externalAgentId);
      if (
        integration &&
        checkPermission(integration, integrationSettings, 'wiki-ingest', ['personal']).ok
      ) {
        return { agent, externalBlocked: false };
      }
    } catch {
      // 조회 실패는 미허용으로 취급한다.
    }
  }
  if (defaultAgent.llmProvider !== agent.llmProvider) {
    const fallbackCategory = getProviderPreset(defaultAgent.llmProvider).category;
    if (fallbackCategory === 'local') return { agent: defaultAgent, externalBlocked: false };
  }
  return { agent, externalBlocked: true };
}

async function resolveVisionAgent(
  processor: Agent,
  agents: Agent[],
): Promise<Agent | null> {
  if ((await resolveVisionSupport(processor)) === 'yes') return processor;
  const explicit = agents.filter((a) => a.id !== processor.id && a.vision === 'yes');
  for (const candidate of explicit) {
    if ((await resolveVisionSupport(candidate)) === 'yes') return candidate;
  }
  const auto = agents.filter((a) => a.id !== processor.id && (a.vision ?? 'auto') === 'auto');
  for (const candidate of auto) {
    if ((await resolveVisionSupport(candidate)) === 'yes') return candidate;
  }
  return null;
}

async function awaitMoveJob(jobId: string, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let unlisten: (() => void) | null = null;
    const timer = setTimeout(() => {
      unlisten?.();
      reject(new Error('파일 이동이 시간 초과되었습니다.'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      unlisten?.();
    };
    listen<FcProgressEvent>('fc://progress', (event) => {
      const payload = event.payload;
      if (payload.job_id !== jobId) return;
      if (payload.kind === 'done') {
        cleanup();
        resolve();
      } else if (payload.kind === 'error') {
        cleanup();
        reject(new Error(payload.message));
      } else if (payload.kind === 'cancelled') {
        cleanup();
        reject(new Error('파일 이동이 취소되었습니다.'));
      }
    })
      .then((stop) => {
        unlisten = stop;
      })
      .catch((err) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

async function ensureDir(path: string): Promise<void> {
  try {
    await fcListDir(path);
  } catch {
    await fcMkdir(path);
  }
}

// -- 실행 상태 (모듈 싱글톤) --

let ctx: WikiPipelineContext | null = null;
let started = false;
let stopListening: (() => void) | null = null;
let processing = false;
let pumpTimer: ReturnType<typeof setTimeout> | null = null;
let lastDoneAt: string | null = null;
let lastError: string | null = null;
const recentPaths = new Map<string, number>();
const listeners = new Set<StatusListener>();

function emitStatus(): void {
  const snapshot: WikiPipelineStatus = {
    active: processing,
    pending: 0,
    lastDoneAt,
    lastError,
  };
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (err) {
      console.error('Wiki pipeline listener error:', err);
    }
  }
}

export function subscribeWikiPipeline(listener: StatusListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function configureWikiPipeline(next: WikiPipelineContext): void {
  ctx = next;
}

async function processJob(job: WikiJob): Promise<void> {
  if (!ctx) return;
  const settings = ctx.getWikiSettings();
  const agents = ctx.getAgents();
  const defaultAgent = ctx.getDefaultAgent();
  const fail = async (reason: string, status: WikiJob['status'] = 'failed') => {
    await updateWikiJob(job.id, { status, reason }, ctx?.workspaceRoot);
  };

  const { agent, externalBlocked } = await resolveProcessor(settings, agents, defaultAgent);
  if (externalBlocked) {
    await fail('외부 전송에 동의하지 않아 백그라운드 처리를 건너뜁니다 (위키 설정에서 로컬 에이전트를 지정하세요).', 'skipped');
    return;
  }
  await updateWikiJob(job.id, { status: 'processing', agentId: agent.id }, ctx.workspaceRoot);

  // ① 내용 추출.
  const ext = extOfPath(job.sourcePath);
  let content: string;
  try {
    if (IMAGE_EXTS.has(ext)) {
      const visionAgent = await resolveVisionAgent(agent, agents);
      if (!visionAgent) {
        await fail('이미지용 비전 에이전트가 없어 대기합니다.', 'waiting-vision');
        return;
      }
      content = await describeImage(visionAgent, ctx.ollamaBaseUrl, job.sourcePath);
    } else {
      const parsed = await parseDocument(job.sourcePath, {
        parsers: ctx.getParserSettings?.(),
        cwd: ctx.workspaceRoot,
      });
      content = parsed.text;
    }
  } catch (err) {
    if (err instanceof ParseError && err.reason === 'scanned-pdf') {
      const visionAgent = await resolveVisionAgent(agent, agents);
      if (!visionAgent) {
        await fail('스캔 PDF용 비전 에이전트가 없어 대기합니다.', 'waiting-vision');
        return;
      }
      try {
        content = await describeImage(visionAgent, ctx.ollamaBaseUrl, job.sourcePath);
      } catch (visionErr) {
        await fail(visionErr instanceof Error ? visionErr.message : String(visionErr));
        return;
      }
    } else {
      await fail(err instanceof Error ? err.message : String(err));
      return;
    }
  }

  // ② LLM 1회 분류 호출.
  const rule = settings.classification ?? 'auto';
  const prompt = [
    settings.prompt.trim() || DEFAULT_WIKI_PROMPT,
    '---',
    `파일: ${baseNameOf(job.sourcePath)} (확장자 .${ext})`,
    rule === 'auto'
      ? '위 세 규칙 중 내용에 맞는 하나를 골라라.'
      : `반드시 '${rule}' 방식으로 분류하라.`,
    '내용:',
    content.slice(0, CLASSIFICATION_PROMPT_CHARS),
    '---',
    '반드시 JSON만 출력하라: {"classification": "date|serial|frequency", "folderName": "...", "title": "...", "slug": "kebab-case", "summary": "...", "tags": ["..."]}',
  ].join('\n');
  const classification = await classifyContent(agent, ctx.ollamaBaseUrl, '위키 분류 도우미', prompt, ctx.streamChatFn);
  const forcedRule = rule === 'auto' ? classification.classification : rule;
  const folderName =
    forcedRule === 'date' && rule !== 'auto' ? dateFolderName() : classification.folderName;
  const slug = /^[a-z0-9-]+$/.test(classification.slug)
    ? classification.slug
    : slugifyWikiTitle(classification.slug || classification.title);

  // ③ (옵션) 이동 + 원본 경로 기록.
  // inbox는 작업 폴더 기준, 그래도 상대 경로면 워크스페이스를 앞에 둔다.
  const inboxBase = resolveInboxDir(ctx.workFolder ?? ctx.workspaceRoot, settings.inboxDir);
  const inbox = /^[a-zA-Z]:[\\/]|^\\\\|^\//.test(inboxBase)
    ? inboxBase
    : joinPath(ctx.workspaceRoot, inboxBase);
  // inbox가 상대 경로면 워크스페이스 기준으로 둔다 (위키는 작업 폴더 산하).
  let movedPath = job.sourcePath;
  if (settings.moveAfterIngest) {
    const destDir = joinPath(inbox, folderName);
    try {
      await ensureDir(destDir);
      const jobId = await fcMove([job.sourcePath], destDir, 'rename');
      await awaitMoveJob(jobId);
      movedPath = joinPath(destDir, baseNameOf(job.sourcePath));
    } catch (err) {
      await fail(`이동 실패: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }

  // ④ wiki ingest (출처: 이동 후 경로).
  try {
    const tool = createWikiTool({ workspaceRoot: ctx.workspaceRoot });
    const body = [
      classification.summary,
      '',
      `출처: ${movedPath}`,
      `원본: ${job.sourcePath}`,
      '',
      '---',
      '',
      content.slice(0, 8000),
    ].join('\n');
    await tool.execute(
      crypto.randomUUID(),
      { action: 'ingest', title: classification.title, slug, content: body },
      new AbortController().signal,
    );
  } catch (err) {
    await fail(`위키 저장 실패: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  await updateWikiJob(
    job.id,
    { status: 'done', reason: null, title: classification.title, slug, folder: folderName },
    ctx.workspaceRoot,
  );
  lastDoneAt = new Date().toISOString();
  lastError = null;
}

/** 대기열을 1건 처리한다. 재처리·테스트 진입점. */
export async function pumpWikiQueue(): Promise<void> {
  if (!ctx || processing) return;
  // 채팅 실행 중이면 대기한다 (chatQueueManager와 조정).
  if (chatQueueManager.getBusySessionId() !== null) {
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      void pumpWikiQueue();
    }, 10_000);
    return;
  }
  let next: WikiJob[];
  try {
    next = await getWikiJobsByStatus('queued', ctx.workspaceRoot);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    emitStatus();
    return;
  }
  const job = next[0];
  if (!job) {
    emitStatus();
    return;
  }
  processing = true;
  emitStatus();
  try {
    await processJob(job);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    try {
      await updateWikiJob(job.id, { status: 'failed', reason: lastError }, ctx?.workspaceRoot);
    } catch {
      // ignore
    }
    emitStatus();
  } finally {
    processing = false;
  }
  emitStatus();
  void pumpWikiQueue();
}

/** 감시 이벤트 1건을 받아 대기열에 넣는다. */
export async function handleWikiFileEvent(path: string): Promise<void> {
  if (!ctx) return;
  const now = Date.now();
  const last = recentPaths.get(path);
  if (last && now - last < 30_000) return;
  recentPaths.set(path, now);

  let size: number;
  try {
    size = (await fcReadFileBytes(path, 1)).size;
  } catch {
    return;
  }
  const job = await createWikiJob({ sourcePath: path }, ctx.workspaceRoot);
  const verdict = shouldProcessFile(path, size, ctx.getWikiSettings());
  if (!verdict.ok) {
    await updateWikiJob(job.id, { status: 'skipped', reason: verdict.reason }, ctx.workspaceRoot);
    return;
  }
  void pumpWikiQueue();
}

/** 파이프라인 시작 (멱등). 감시 이벤트를 구독하고 밀린 대기열을 처리한다. */
export async function startWikiPipeline(): Promise<void> {
  if (started) {
    void pumpWikiQueue();
    return;
  }
  started = true;
  try {
    stopListening = await listen<{ path: string; kind: string }>('wiki://file-event', (event) => {
      void handleWikiFileEvent(event.payload.path);
    });
  } catch (err) {
    started = false;
    throw err;
  }
  void pumpWikiQueue();
}

/** 파이프라인 중지 (테스트·종료용). */
export function stopWikiPipeline(): void {
  started = false;
  if (pumpTimer) {
    clearTimeout(pumpTimer);
    pumpTimer = null;
  }
  stopListening?.();
  stopListening = null;
  recentPaths.clear();
}
