import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import type { Agent } from '@/lib/types/agent';
import type { WikiSettings } from '@/lib/db/repositories/settingsRepo';
import type { LlmStreamChatFn } from '@/lib/llm/providerRuntime';
import { chatQueueManager } from '@/lib/agent/chatQueueManager';
import {
  configureWikiPipeline,
  reconcileWikiFolders,
  pumpWikiQueue,
  stopWikiPipeline,
  handleWikiFileEvent,
  dateFolderName,
  extractJsonObject,
} from './pipeline';
import { parseDocument } from '@/lib/parsers/index';
import { resolveVisionSupport } from '@/lib/llm/vision';
import { fcMove, fcMkdir, fcListDir, fcReadFileBytes } from '@/lib/commander/ipc';
import { listWikiJobs, getWikiJobsByStatus } from '@/lib/db/repositories/wikiJobsRepo';

vi.mock('@/lib/parsers/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/parsers/index')>();
  return { ...actual, parseDocument: vi.fn() };
});

vi.mock('@/lib/llm/vision', () => ({
  resolveVisionSupport: vi.fn(),
}));

vi.mock('@/lib/commander/ipc', () => ({
  fcReadFileBytes: vi.fn(),
  fcListDir: vi.fn(),
  fcMkdir: vi.fn(),
  fcMove: vi.fn(),
  fcReveal: vi.fn(),
}));

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

type EventHandler = (event: { payload: { path: string; kind: string } }) => void;
let eventHandler: EventHandler | null = null;
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, handler: EventHandler) => {
    eventHandler = handler;
    return () => {
      eventHandler = null;
    };
  }),
}));

vi.mock('@/lib/db/repositories/integrationsRepo', () => ({
  listIntegrations: vi.fn(async () => []),
  getIntegrationSettings: vi.fn(async () => ({ masterEnabled: false })),
}));

const ingestExecute = vi.fn();
vi.mock('@/lib/tools/wiki', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tools/wiki')>();
  return { ...actual, createWikiTool: vi.fn(() => ({ execute: ingestExecute })) };
});

const mockedParse = vi.mocked(parseDocument);
const mockedVision = vi.mocked(resolveVisionSupport);
const mockedMove = vi.mocked(fcMove);

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-local',
    name: 'Local',
    systemPrompt: 'sys',
    model: 'qwen3:8b',
    temperature: 0.2,
    contextSize: 8192,
    reserveTokens: 0,
    keepRecentTokens: 0,
    enabledSkills: [],
    enabledBuiltinTools: [],
    approvalMode: 'dangerous-only',
    llmProvider: 'ollama',
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSettings(overrides: Partial<WikiSettings> = {}): WikiSettings {
  return {
    watchEnabled: true,
    watchFolders: ['C:/dl'],
    recursive: false,
    scanIntervalMin: 10,
    moveAfterIngest: true,
    inboxDir: 'C:/work/wiki-inbox',
    categories: ['문서/업무', '재무/보고서'],
    allowNewCategories: false,
    allowedExtensions: ['pdf', 'md', 'txt', 'png'],
    maxFileMb: 20,
    excludeGlobs: [],
    prompt: '',
    agentId: null,
    ...overrides,
  };
}

function stubClassify(payload: unknown): LlmStreamChatFn {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return (async function* () {
    yield { content: text, done: true };
  }) as unknown as LlmStreamChatFn;
}

const flush = async (n = 5) => {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
};

describe('wiki pipeline helpers', () => {
  it('builds date folders with zero padding', () => {
    expect(dateFolderName(new Date(2026, 0, 5))).toBe('2026/01-05');
  });

  it('extracts JSON from fenced output', () => {
    expect(
      extractJsonObject('설명 문장\n```json\n{"a": 1}\n```\n뒷문장'),
    ).toEqual({ a: 1 });
    expect(() => extractJsonObject('json 없음')).toThrow();
  });
});

describe('wiki pipeline', () => {
  const localAgent = makeAgent();

  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockRejectedValue(new Error('no ipc'));
    ingestExecute.mockResolvedValue({ content: 'ok', details: {} });
    setDatabase(new MemorySqlFallback());
    chatQueueManager.resetAll();
    stopWikiPipeline();
    eventHandler = null;
    mockedVision.mockResolvedValue('yes');
    vi.mocked(fcReadFileBytes).mockResolvedValue({ base64: '', size: 1024, truncated: false });
    vi.mocked(fcListDir).mockRejectedValue(new Error('missing'));
    vi.mocked(fcMkdir).mockResolvedValue({ warning: false });
    mockedMove.mockResolvedValue('job-1');
  });

  afterEach(() => {
    stopWikiPipeline();
    chatQueueManager.resetAll();
  });

  function configure(
    settings: WikiSettings,
    agents: Agent[] = [localAgent],
    streamChatFn?: LlmStreamChatFn,
  ) {
    configureWikiPipeline({
      workspaceRoot: 'C:/work',
      workFolder: 'C:/work',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      getWikiSettings: () => settings,
      getAgents: () => agents,
      getDefaultAgent: () => agents[0] ?? localAgent,
      streamChatFn,
    });
  }

  async function finishMoveWithDone() {
    // listen 목에 등록된 핸들러에게 done을 전달한다.
    await flush(5);
    // @ts-expect-error 테스트용 페이로드 주입
    eventHandler?.({ payload: { kind: 'done', job_id: 'job-1', result: {} } });
    await flush(10);
  }

  it('processes a text file end to end', async () => {
    mockedParse.mockResolvedValueOnce({
      text: 'quarterly report contents '.repeat(50),
      truncated: false,
      method: 'text',
    });
    configure(
      makeSettings(),
      [localAgent],
      stubClassify({
        categoryPath: '재무/보고서',
        title: '분기 보고',
        slug: 'quarterly-report',
        summary: '분기 실적 요약',
        tags: ['report'],
      }),
    );
    await handleWikiFileEvent('C:/dl/report.md');
    // pump 내부의 awaitMoveJob이 job-1 완료를 기다린다 — 직접 완료시킨다.
    await finishMoveWithDone();
    const jobs = await listWikiJobs(10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('done');
    expect(jobs[0].title).toBe('분기 보고');
    expect(jobs[0].folder).toBe('재무/보고서');
    expect(ingestExecute).toHaveBeenCalledOnce();
    const ingestArgs = ingestExecute.mock.calls[0][1] as { title: string; slug: string };
    expect(ingestArgs.title).toBe('분기 보고');
    expect(ingestArgs.slug).toBe('quarterly-report');
    expect(mockedMove).toHaveBeenCalledWith(
      ['C:/dl/report.md'],
      expect.stringContaining('재무/보고서'),
      'rename',
    );
  });

  it('skips files rejected by the filter', async () => {
    configure(makeSettings());
    await handleWikiFileEvent('C:/dl/setup.exe');
    await flush();
    const jobs = await listWikiJobs(10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('skipped');
    expect(mockedParse).not.toHaveBeenCalled();
  });

  it('waits while a chat session is busy', async () => {
    mockedParse.mockResolvedValue({
      text: 'hello world contents here and more text to be safe',
      truncated: false,
      method: 'text',
    });
    configure(
      makeSettings({ moveAfterIngest: false }),
      [localAgent],
      stubClassify({
        categoryPath: '',
        title: 't',
        slug: 't',
        summary: 's',
        tags: [],
      }),
    );
    chatQueueManager.setSessionBusy('chat-1');
    await handleWikiFileEvent('C:/dl/a.md');
    await flush();
    expect((await getWikiJobsByStatus('queued'))).toHaveLength(1);
    expect(mockedParse).not.toHaveBeenCalled();
    chatQueueManager.setSessionIdle('chat-1');
    await pumpWikiQueue();
    await flush();
    const jobs = await listWikiJobs(10);
    expect(jobs[0].status).toBe('done');
  });

  it('parks images without a vision agent', async () => {
    mockedVision.mockResolvedValue('no');
    configure(makeSettings({ moveAfterIngest: false }));
    await handleWikiFileEvent('C:/dl/photo.png');
    await flush();
    const jobs = await listWikiJobs(10);
    expect(jobs[0].status).toBe('waiting-vision');
  });

  it('falls back to the local agent when the external processor lacks consent', async () => {
    const external = makeAgent({
      id: 'agent-ext',
      llmProvider: 'external-agent',
      externalAgentId: 'integ-1',
      isDefault: false,
    });
    mockedParse.mockResolvedValue({
      text: 'some document text that is long enough for classification purposes here',
      truncated: false,
      method: 'text',
    });
    configure(
      makeSettings({ moveAfterIngest: false, agentId: 'agent-ext' }),
      [localAgent, external],
      stubClassify({
        categoryPath: '',
        title: 't',
        slug: 't',
        summary: 's',
        tags: [],
      }),
    );
    await handleWikiFileEvent('C:/dl/a.md');
    await flush(15);
    const jobs = await listWikiJobs(10);
    // 외부 동의가 없으므로 로컬 기본 에이전트로 처리되어 done이다.
    expect(jobs[0].status).toBe('done');
  });

  it('uses date fallback when classification fails twice', async () => {
    mockedParse.mockResolvedValue({
      text: 'readable text that passes the filter and extraction stage',
      truncated: false,
      method: 'text',
    });
    configure(makeSettings({ moveAfterIngest: false }), [localAgent], stubClassify('not json at all'));
    await handleWikiFileEvent('C:/dl/a.md');
    await flush(15);
    const jobs = await listWikiJobs(10);
    expect(jobs[0].status).toBe('done');
    expect(jobs[0].folder).toBe(dateFolderName());
  });

  it('skips a file whose content hash is already registered', async () => {
    mockedParse.mockResolvedValue({ text: 'same content '.repeat(20), truncated: false, method: 'text' });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'wiki_file_hash') return 'hash-1';
      throw new Error('unexpected');
    });
    configure(
      makeSettings({ moveAfterIngest: false }),
      [localAgent],
      stubClassify({
        categoryPath: '',
        title: '첫 문서',
        slug: 'first',
        summary: 's',
        tags: [],
      }),
    );
    await handleWikiFileEvent('C:/dl/a.md');
    await flush(15);
    await handleWikiFileEvent('C:/dl/a-copy.md');
    await flush(15);
    const jobs = await listWikiJobs(10);
    expect(jobs.map((j) => j.status).sort()).toEqual(['done', 'skipped']);
    expect(jobs.find((j) => j.status === 'skipped')?.reason).toContain('첫 문서');
    expect(ingestExecute).toHaveBeenCalledOnce();
  });

  it('reconcile queues new files once and ignores the inbox folder', async () => {
    mockedParse.mockResolvedValue({ text: 'scan content '.repeat(20), truncated: false, method: 'text' });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'wiki_scan_folders') {
        return [
          { path: 'C:/dl/new.md', size: 100, modified_ms: 1 },
          { path: 'C:/work/wiki-inbox/2026/old.md', size: 100, modified_ms: 1 },
          { path: 'C:/dl/tool.exe', size: 100, modified_ms: 1 },
        ];
      }
      throw new Error('no hash');
    });
    configure(
      makeSettings({ moveAfterIngest: false }),
      [localAgent],
      stubClassify({
        categoryPath: '',
        title: 'n',
        slug: 'n',
        summary: 's',
        tags: [],
      }),
    );
    expect(await reconcileWikiFolders()).toBe(1);
    await flush(15);
    expect(await reconcileWikiFolders()).toBe(0);
    const jobs = await listWikiJobs(10);
    expect(jobs).toHaveLength(2);
    expect(jobs.find((j) => j.sourcePath === 'C:/dl/new.md')?.status).toBe('done');
    expect(jobs.find((j) => j.sourcePath === 'C:/dl/tool.exe')?.status).toBe('skipped');
  });

  it('sends categories and a JSON schema, then files under the resolved category', async () => {
    mockedParse.mockResolvedValue({ text: 'monthly sales report '.repeat(20), truncated: false, method: 'text' });
    vi.mocked(fcListDir).mockImplementation(async (path: string) => {
      if (path === 'C:/work/wiki-inbox') {
        return [
          { name: '2026', path: 'C:/work/wiki-inbox/2026', kind: 'dir' },
          { name: '여행', path: 'C:/work/wiki-inbox/여행', kind: 'dir' },
        ] as never;
      }
      return [] as never;
    });
    const requests: Array<{ jsonSchema?: { properties: { categoryPath: { enum?: string[] } } }; messages: Array<{ content: string }> }> = [];
    const fn = (async function* (req: never) {
      requests.push(req);
      yield {
        content: JSON.stringify({
          categoryPath: '재무/보고서/월간',
          title: '월간 매출',
          slug: 'monthly-sales',
          summary: 's',
          tags: [],
        }),
        done: true,
      };
    }) as unknown as LlmStreamChatFn;
    configure(makeSettings({ moveAfterIngest: false }), [localAgent], fn);
    await handleWikiFileEvent('C:/dl/sales.md');
    await flush(15);
    const userPrompt = requests[0].messages[1].content;
    expect(userPrompt).toContain('- 재무/보고서');
    expect(userPrompt).toContain('- 여행');
    expect(userPrompt).not.toContain('- 2026');
    expect(requests[0].jsonSchema?.properties.categoryPath.enum).toContain('여행');
    const jobs = await listWikiJobs(10);
    // 새 카테고리가 꺼져 있어 '재무/보고서/월간'은 가까운 상위로 접힌다.
    expect(jobs[0].folder).toBe('재무/보고서');
  });

  it('creates a new subcategory under an existing parent when allowed', async () => {
    mockedParse.mockResolvedValue({ text: 'meeting notes '.repeat(20), truncated: false, method: 'text' });
    configure(
      makeSettings({ moveAfterIngest: false, allowNewCategories: true }),
      [localAgent],
      stubClassify({
        categoryPath: '문서/업무/회의록',
        title: '회의',
        slug: 'meeting',
        summary: 's',
        tags: [],
      }),
    );
    await handleWikiFileEvent('C:/dl/meeting.md');
    await flush(15);
    const jobs = await listWikiJobs(10);
    expect(jobs[0].folder).toBe('문서/업무/회의록');
  });
});
