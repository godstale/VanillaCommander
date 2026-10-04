// P11-32: 위키 처리 파이프라인. `wiki://file-event` → 필터 → 직렬 1건씩 →
// ① 내용 추출 → ② LLM 1회 분류 호출 → ③ (옵션) 이동 → ④ wiki ingest.
// 에이전트 루프 대신 단일 구조화 호출을 쓴다 (예측 가능·저비용).
import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
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
import { llmQueue, LlmQueueCancelledError, type LlmLease } from '@/lib/agent/llmQueue';
import { parseDocument, ParseError } from '@/lib/parsers/index';
import {
  DEFAULT_WIKI_PROMPT,
  resolveInboxDir,
  shouldProcessFile,
} from './settings';
import {
  buildClassificationSchema,
  mergeCategories,
  resolveCategory,
} from './categories';
import {
  createWikiJob,
  updateWikiJob,
  getWikiJobsByStatus,
  findWikiJobByPath,
  findDoneWikiJobByHash,
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

// 분류는 문서 앞부분만으로 충분하다. 입력을 줄여 지연과 토큰을 아낀다.
const CLASSIFICATION_PROMPT_CHARS = 6_000;
const QUEUE_ABORT_MESSAGE = 'LLM 큐에서 삭제되었거나 시간 제한을 넘겨 중단되었습니다.';
// 보관 폴더에서 기존 카테고리로 읽어 들이는 최대 깊이.
const CATEGORY_SCAN_DEPTH = 3;

const ClassificationSchema = z.object({
  categoryPath: z.string().max(200).default(''),
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

/** Windows verbatim 접두(`\\?\`)를 벗겨 감시 이벤트·스캔 경로를 같은 형태로 맞춘다. */
export function normalizeWatchPath(path: string): string {
  return path.replace(/^\\\\\?\\/, '');
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
  jsonSchema?: Record<string, unknown>,
  signal?: AbortSignal,
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
  const run = async (
    prompt: string,
    schema?: Record<string, unknown>,
  ): Promise<Classification> => {
    const raw = await collectChat(fn, {
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      model: agent.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      ...(schema ? { jsonSchema: schema } : {}),
    }, signal);
    return ClassificationSchema.parse(extractJsonObject(raw));
  };
  try {
    return await run(userPrompt, jsonSchema);
  } catch {
    // 큐에서 삭제·만료된 트랜잭션은 폴백 분류 없이 중단한다.
    if (signal?.aborted) throw new Error(QUEUE_ABORT_MESSAGE);
    // 구조화 출력을 지원하지 않는 서버일 수 있어 재시도는 스키마 없이 프롬프트로만 강제한다.
    // 그래도 실패하면 날짜순 폴백 (P11-32 명세).
    try {
      return await run(`${userPrompt}\n\n반드시 위 JSON 형식으로만 답하라. 설명 문장을 붙이지 마라.`);
    } catch {
      if (signal?.aborted) throw new Error(QUEUE_ABORT_MESSAGE);
      const fileName = userPrompt.match(/^파일: (.+?) \(/m)?.[1] ?? 'unfiled';
      return {
        categoryPath: '',
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
  signal?: AbortSignal,
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
    }, signal);
  }
  return collectChat(streamOllamaChat, {
    baseUrl: runtime.baseUrl,
    model: agent.model,
    messages: [{ role: 'user', content: prompt, images: [imagePath] }],
    temperature: 0.2,
  }, signal);
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

/** 파일명 비교용 정규화 (한글 NFC/NFD 차이 흡수, 대소문자 무시). */
function sameName(a: string, b: string): boolean {
  return a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fcReadFileBytes(path, 1);
    return true;
  } catch {
    return false;
  }
}

async function destHasBase(destDir: string, base: string): Promise<boolean> {
  try {
    const entries = await fcListDir(destDir);
    return entries.some((e) => sameName(e.name, base));
  } catch {
    return false;
  }
}

/** 원본이 사라지고 대상 폴더에 같은 이름이 있으면 이동이 끝난 것으로 본다. */
async function moveLanded(source: string, destDir: string): Promise<boolean> {
  return !(await pathExists(source)) && (await destHasBase(destDir, baseNameOf(source)));
}

/**
 * fc_move 실행 + 완료 대기. 리스너를 invoke보다 먼저 붙여 빠른 done 유실을 막고,
 * 이벤트를 놓쳐도 파일 시스템 상태(원본 소멸 + 대상 존재)를 폴링해 완료를 판정한다.
 */
async function fcMoveAndWait(sources: string[], destDir: string, timeoutMs = 120_000): Promise<void> {
  const terminalByJob = new Map<string, FcProgressEvent>();
  let jobId: string | null = null;
  let settle: ((e: FcProgressEvent) => void) | null = null;
  const unlisten = await listen<FcProgressEvent>('fc://progress', (event) => {
    const payload = event.payload;
    if (payload.kind !== 'done' && payload.kind !== 'error' && payload.kind !== 'cancelled') {
      return;
    }
    terminalByJob.set(payload.job_id, payload);
    if (jobId !== null && payload.job_id === jobId && settle) {
      settle(payload);
    }
  });
  let poller: ReturnType<typeof setInterval> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    jobId = await fcMove(sources, destDir, 'rename');
    const early = terminalByJob.get(jobId);
    const terminal: FcProgressEvent = early ?? await new Promise<FcProgressEvent>((resolve, reject) => {
      let checking = false;
      const finish = () => {
        settle = null;
        if (timer) clearTimeout(timer);
        if (poller) clearInterval(poller);
      };
      timer = setTimeout(() => {
        finish();
        reject(new Error('파일 이동이 시간 초과되었습니다.'));
      }, timeoutMs);
      settle = (e) => {
        finish();
        resolve(e);
      };
      poller = setInterval(() => {
        if (checking) return;
        checking = true;
        void (async () => {
          try {
            const landed = await Promise.all(sources.map((src) => moveLanded(src, destDir)));
            if (landed.every(Boolean) && settle) {
              settle({ kind: 'done', job_id: jobId ?? '', result: null });
            }
          } finally {
            checking = false;
          }
        })();
      }, 1_000);
    });
    if (terminal.kind === 'done') return;
    if (terminal.kind === 'cancelled') throw new Error('파일 이동이 취소되었습니다.');
    throw new Error(terminal.kind === 'error' ? terminal.message : '파일 이동에 실패했습니다.');
  } finally {
    if (poller) clearInterval(poller);
    if (timer) clearTimeout(timer);
    unlisten();
  }
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
let lastDoneAt: string | null = null;
let lastError: string | null = null;
let pendingCount = 0;
const recentPaths = new Map<string, number>();
const enqueuing = new Set<string>();
let reconciling = false;
const listeners = new Set<StatusListener>();

function emitStatus(): void {
  const snapshot: WikiPipelineStatus = {
    active: processing,
    pending: pendingCount,
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

/** 보관 폴더의 기존 하위 폴더를 카테고리 후보로 읽는다 (날짜 폴백용 연도 폴더는 제외). */
async function listExistingCategories(inbox: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > CATEGORY_SCAN_DEPTH) return;
    let entries: Awaited<ReturnType<typeof fcListDir>>;
    try {
      entries = await fcListDir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.kind !== 'dir') continue;
      if (depth === 1 && /^\d{4}$/.test(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      found.push(rel);
      await walk(entry.path, rel, depth + 1);
    }
  };
  await walk(inbox, '', 1);
  return found;
}

async function processJob(job: WikiJob): Promise<void> {
  if (!ctx) return;
  const settings = ctx.getWikiSettings();
  const agents = ctx.getAgents();
  const defaultAgent = ctx.getDefaultAgent();

  const { agent, externalBlocked } = await resolveProcessor(settings, agents, defaultAgent);
  if (externalBlocked) {
    await updateWikiJob(
      job.id,
      {
        status: 'skipped',
        reason: '외부 전송에 동의하지 않아 백그라운드 처리를 건너뜁니다 (위키 설정에서 로컬 에이전트를 지정하세요).',
      },
      ctx.workspaceRoot,
    );
    return;
  }

  // 로컬 LLM은 채팅과 동시에 돌리면 충돌하므로 파일 1건 처리 전체를 하나의 트랜잭션으로 큐에 올린다.
  let lease: LlmLease | null = null;
  if (getProviderPreset(agent.llmProvider).category === 'local') {
    try {
      lease = await llmQueue.acquire('wiki', baseNameOf(job.sourcePath));
    } catch (err) {
      if (err instanceof LlmQueueCancelledError) {
        await updateWikiJob(
          job.id,
          { status: 'skipped', reason: 'LLM 큐에서 삭제되어 처리하지 않았습니다.' },
          ctx.workspaceRoot,
        );
        return;
      }
      throw err;
    }
  }
  try {
    await runWikiJob(job, agent, lease?.signal);
  } finally {
    lease?.release();
  }
}

async function runWikiJob(job: WikiJob, agent: Agent, signal?: AbortSignal): Promise<void> {
  if (!ctx) return;
  const settings = ctx.getWikiSettings();
  const agents = ctx.getAgents();
  const fail = async (reason: string, status: WikiJob['status'] = 'failed') => {
    await updateWikiJob(job.id, { status, reason }, ctx?.workspaceRoot);
  };
  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error(QUEUE_ABORT_MESSAGE);
  };
  await updateWikiJob(job.id, { status: 'processing', agentId: agent.id }, ctx.workspaceRoot);

  // 같은 내용이 이미 등록돼 있으면 LLM 호출 없이 건너뛴다 (복사본·재다운로드).
  let contentHash: string | null = null;
  try {
    contentHash = await invoke<string>('wiki_file_hash', { path: job.sourcePath });
  } catch {
    // 해시 실패는 중복 검사만 건너뛴다 (파일 읽기 실패는 이후 추출 단계에서 보고).
  }
  if (contentHash) {
    const dup = await findDoneWikiJobByHash(contentHash, ctx.workspaceRoot);
    if (dup && dup.id !== job.id) {
      await updateWikiJob(
        job.id,
        {
          status: 'skipped',
          reason: `이미 등록된 내용입니다: ${dup.title ?? baseNameOf(dup.sourcePath)}`,
          contentHash,
        },
        ctx.workspaceRoot,
      );
      return;
    }
    await updateWikiJob(job.id, { contentHash }, ctx.workspaceRoot);
  }

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
      content = await describeImage(visionAgent, ctx.ollamaBaseUrl, job.sourcePath, signal);
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
        content = await describeImage(visionAgent, ctx.ollamaBaseUrl, job.sourcePath, signal);
      } catch (visionErr) {
        await fail(visionErr instanceof Error ? visionErr.message : String(visionErr));
        return;
      }
    } else {
      await fail(err instanceof Error ? err.message : String(err));
      return;
    }
  }

  throwIfAborted();

  // ② LLM 1회 분류 호출. 보관 폴더 아래 카테고리 체계(설정 + 기존 폴더)에서 경로를 고른다.
  // inbox는 작업 폴더 기준, 그래도 상대 경로면 워크스페이스를 앞에 둔다.
  const inboxBase = resolveInboxDir(ctx.workFolder ?? ctx.workspaceRoot, settings.inboxDir);
  const inbox = /^[a-zA-Z]:[\\/]|^\\\\|^\//.test(inboxBase)
    ? inboxBase
    : joinPath(ctx.workspaceRoot, inboxBase);
  const knownCategories = mergeCategories(
    settings.categories,
    await listExistingCategories(inbox),
  );
  const categoryLines =
    knownCategories.length > 0
      ? knownCategories.map((c) => `- ${c}`).join('\n')
      : '(없음)';
  const prompt = [
    settings.prompt.trim() || DEFAULT_WIKI_PROMPT,
    '---',
    '카테고리 목록 (categoryPath는 반드시 여기서 고른다):',
    categoryLines,
    settings.allowNewCategories
      ? '맞는 카테고리가 없으면 기존 카테고리 아래에 새 하위 카테고리를 제안해도 된다 (깊이 최대 3).'
      : '목록에 없는 카테고리를 만들지 마라. 애매하면 가장 가까운 것을 고른다.',
    '---',
    `파일: ${baseNameOf(job.sourcePath)} (확장자 .${ext})`,
    '내용:',
    content.slice(0, CLASSIFICATION_PROMPT_CHARS),
    '---',
    '반드시 JSON만 출력하라: {"categoryPath": "A/B", "title": "...", "slug": "kebab-case", "summary": "...", "tags": ["..."]}',
  ].join('\n');
  const classification = await classifyContent(
    agent,
    ctx.ollamaBaseUrl,
    '위키 분류 도우미',
    prompt,
    ctx.streamChatFn,
    buildClassificationSchema(knownCategories, settings.allowNewCategories),
    signal,
  );
  throwIfAborted();
  // 목록 밖·잘못된 경로는 가까운 상위로 접고, 그것도 없으면 날짜 폴더에 보관한다.
  const category = resolveCategory(
    classification.categoryPath,
    knownCategories,
    settings.allowNewCategories,
  );
  const folderName = category?.path ?? dateFolderName();
  const slug = /^[a-z0-9-]+$/.test(classification.slug)
    ? classification.slug
    : slugifyWikiTitle(classification.slug || classification.title);

  // ③ wiki ingest. 등록이 성공한 파일만 이동하므로 실패 건은 감시 폴더에 그대로 남는다.
  const destDir = joinPath(inbox, folderName);
  const plannedPath = settings.moveAfterIngest
    ? joinPath(destDir, baseNameOf(job.sourcePath))
    : job.sourcePath;
  const ingest = async (sourceRef: string): Promise<void> => {
    const tool = createWikiTool({ workspaceRoot: ctx?.workspaceRoot });
    const body = [
      classification.summary,
      '',
      `출처: ${sourceRef}`,
      `원본: ${job.sourcePath}`,
      '',
      '---',
      '',
      content.slice(0, 8000),
    ].join('\n');
    await tool.execute(
      crypto.randomUUID(),
      {
        action: 'ingest',
        title: classification.title,
        slug,
        content: body,
        tags: classification.tags,
        category: category?.path ?? '',
      },
      new AbortController().signal,
    );
  };
  try {
    await ingest(plannedPath);
  } catch (err) {
    await fail(`위키 저장 실패: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // ④ (옵션) 등록 성공 후 이동. 이동만 실패하면 등록은 유지하고 출처를 원본 경로로 되돌린다.
  let moveWarning: string | null = null;
  if (settings.moveAfterIngest) {
    try {
      await ensureDir(destDir);
      await fcMoveAndWait([job.sourcePath], destDir);
    } catch (err) {
      // done 이벤트를 놓쳐 타임아웃으로 보고됐는데 실제로는 이동된 경우 자가 치유한다.
      if (!(await moveLanded(job.sourcePath, destDir))) {
        moveWarning = `등록 완료, 이동 실패: ${err instanceof Error ? err.message : String(err)}`;
        try {
          await ingest(job.sourcePath);
        } catch {
          // 출처 표기만 틀어질 뿐이라 무시한다.
        }
      }
    }
  }

  await updateWikiJob(
    job.id,
    { status: 'done', reason: moveWarning, title: classification.title, slug, folder: folderName },
    ctx.workspaceRoot,
  );
  lastDoneAt = new Date().toISOString();
  lastError = null;
}

/** 대기열을 1건 처리한다. 재처리·테스트 진입점. */
export async function pumpWikiQueue(): Promise<void> {
  if (!ctx || processing) return;
  // 채팅과의 충돌은 processJob 안에서 LLM 트랜잭션 큐(llmQueue)가 조정한다.
  let next: WikiJob[];
  try {
    next = await getWikiJobsByStatus('queued', ctx.workspaceRoot);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    emitStatus();
    return;
  }
  const job = next[0];
  pendingCount = Math.max(0, next.length - 1);
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

/** 파일 1건을 대기열에 넣는다. 이미 작업이 있는 경로는 건너뛴다(재처리는 탭의 수동 버튼). */
async function enqueueWikiPath(rawPath: string, size: number, retry = false): Promise<boolean> {
  if (!ctx) return false;
  const path = normalizeWatchPath(rawPath);
  const key = path.toLowerCase();
  // 같은 경로를 동시에 등록하지 않도록 (이벤트·주기 스캔 경합) 메모리에서 먼저 막는다.
  if (enqueuing.has(key)) return false;
  enqueuing.add(key);
  try {
    const existing =
      (await findWikiJobByPath(path, ctx.workspaceRoot)) ||
      (await findWikiJobByPath(`\\\\?\\${path}`, ctx.workspaceRoot));
    if (existing) {
      // 수동 처리: 감시 폴더에 파일이 다시 들어왔는데 이전 시도가 실패·건너뜀이면 재시도한다.
      // (주기 스캔은 재시도하지 않는다 — 계속 실패하는 파일이 무한 반복되지 않도록.)
      if (retry && (existing.status === 'failed' || existing.status === 'skipped')) {
        if (!shouldProcessFile(path, size, ctx.getWikiSettings()).ok) return false;
        await updateWikiJob(existing.id, { status: 'queued', reason: null }, ctx.workspaceRoot);
        return true;
      }
      return false;
    }
    const job = await createWikiJob({ sourcePath: path }, ctx.workspaceRoot);
    const verdict = shouldProcessFile(path, size, ctx.getWikiSettings());
    if (!verdict.ok) {
      await updateWikiJob(job.id, { status: 'skipped', reason: verdict.reason }, ctx.workspaceRoot);
      return false;
    }
    return true;
  } finally {
    enqueuing.delete(key);
  }
}

/** 감시 이벤트 1건을 받아 대기열에 넣는다. */
export async function handleWikiFileEvent(rawPath: string): Promise<void> {
  if (!ctx) return;
  const path = normalizeWatchPath(rawPath);
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
  if (await enqueueWikiPath(path, size)) void pumpWikiQueue();
}

interface WikiScanEntry {
  path: string;
  size: number;
  modified_ms: number;
}

function isInside(path: string, dir: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(path).startsWith(`${norm(dir)}/`);
}

/**
 * 감시 폴더를 훑어 이벤트로 놓친 파일(앱 종료 중 유입 등)을 대기열에 넣는다.
 * 보관 폴더(inbox) 안의 파일은 이미 정리된 것이라 제외한다.
 */
export async function reconcileWikiFolders(options: { retry?: boolean } = {}): Promise<number> {
  if (!ctx || reconciling) return 0;
  const settings = ctx.getWikiSettings();
  if (!settings.watchEnabled || settings.watchFolders.length === 0) return 0;
  reconciling = true;
  try {
    return await reconcileFoldersOnce(settings, options.retry === true);
  } finally {
    reconciling = false;
  }
}

async function reconcileFoldersOnce(settings: WikiSettings, retry: boolean): Promise<number> {
  if (!ctx) return 0;
  let entries: WikiScanEntry[];
  try {
    entries = await invoke<WikiScanEntry[]>('wiki_scan_folders', {
      folders: settings.watchFolders.map((f) => ({ path: f.path, recursive: f.recursive })),
      recursive: false,
    });
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    emitStatus();
    return 0;
  }
  const inboxBase = resolveInboxDir(ctx.workFolder ?? ctx.workspaceRoot, settings.inboxDir);
  let queued = 0;
  for (const entry of entries) {
    if (isInside(entry.path, inboxBase)) continue;
    try {
      if (await enqueueWikiPath(entry.path, entry.size, retry)) queued++;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (queued > 0) void pumpWikiQueue();
  return queued;
}

/** 파이프라인 시작 (멱등). 감시 이벤트를 구독하고 밀린 대기열을 처리한다. */
export async function startWikiPipeline(): Promise<void> {
  if (started) {
    void pumpWikiQueue();
    return;
  }
  started = true;
  // 앱이 처리 중에 종료되면 'processing'으로 남는다. 직렬 처리라 기동 시점의 잔여분은 모두 정체 건이다.
  try {
    if (ctx) {
      for (const stale of await getWikiJobsByStatus('processing', ctx.workspaceRoot)) {
        await updateWikiJob(stale.id, { status: 'queued' }, ctx.workspaceRoot);
      }
    }
  } catch (err) {
    console.error('Failed to requeue stale wiki jobs:', err);
  }
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
  stopListening?.();
  stopListening = null;
  recentPaths.clear();
}
