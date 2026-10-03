import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TOOL_RISK_MAP } from '@/lib/tools/risk';
import { createFsCopyTool } from './fsCopy';
import { createFsMoveTool } from './fsMove';
import { createFsRenameTool } from './fsRename';
import { createFsTrashTool } from './fsTrash';
import { createFsInfoTool } from './fsInfo';
import { createFsSearchTool } from './fsSearch';
import { createExplorerTool } from './explorerTool';
import { createDocReadTool } from './docRead';
import { setExplorerOpener } from './explorerBridge';

const invokeCalls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
let jobSeq = 0;
type EvtHandler = (event: { payload: unknown }) => void;
const evtHandlers: EvtHandler[] = [];

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => {
    invokeCalls.push({ cmd, args });
    if (cmd === 'fc_copy' || cmd === 'fc_move' || cmd === 'fc_stat' || cmd === 'fc_search' || cmd === 'fc_zip' || cmd === 'fc_unzip') {
      jobSeq += 1;
      return Promise.resolve(`job-${jobSeq}`);
    }
    if (cmd === 'fc_mkdir' || cmd === 'fc_rename' || cmd === 'fc_trash') {
      return Promise.resolve({ warning: false });
    }
    return Promise.reject(new Error(`unexpected: ${cmd}`));
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_name: string, handler: EvtHandler) => {
    evtHandlers.push(handler);
    return Promise.resolve(() => {});
  }),
}));

vi.mock('@/lib/parsers/builtin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/parsers/builtin')>();
  const stub = async () => ({ text: 'parsed text', truncated: false, method: 'text' });
  return {
    ...actual,
    parseDocument: vi.fn(stub),
    parseBuiltinDocument: vi.fn(stub),
  };
});

function emitDone(jobId: string, result: unknown = {}) {
  for (const h of [...evtHandlers]) {
    h({ payload: { kind: 'done', job_id: jobId, result } });
  }
}

const SIG = new AbortController().signal;

async function flush() {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function runWithJobs<T>(start: () => Promise<T>, dones: Array<{ jobSuffix: number; result?: unknown }> = []): Promise<T> {
  const pending = start();
  // 백업 잡 + 본 잡 순서대로 완료 처리한다.
  for (let i = 0; i < 6 && evtHandlers.length === 0; i++) {
    await flush();
  }
  for (const d of dones) {
    emitDone(`job-${d.jobSuffix}`, d.result ?? {});
    await flush();
  }
  // 남은 잡이 있으면 기본 완료 처리.
  emitDone('job-1', {});
  emitDone('job-2', {});
  emitDone('job-3', {});
  await flush();
  return pending;
}

describe('commander tools', () => {
  beforeEach(() => {
    invokeCalls.length = 0;
    evtHandlers.length = 0;
    jobSeq = 0;
    vi.clearAllMocks();
    setExplorerOpener(null);
  });

  it('maps risk levels (writes dangerous, reads safe)', () => {
    expect(TOOL_RISK_MAP.fs_copy).toBe('high');
    expect(TOOL_RISK_MAP.fs_move).toBe('high');
    expect(TOOL_RISK_MAP.fs_trash).toBe('high');
    expect(TOOL_RISK_MAP.fs_info).toBe('low');
    expect(TOOL_RISK_MAP.fs_search).toBe('low');
    expect(TOOL_RISK_MAP.explorer).toBe('low');
    expect(TOOL_RISK_MAP.doc_read).toBe('low');
  });

  it('fs_copy absorbs aliases and awaits the job', async () => {
    const tool = createFsCopyTool({ workFolder: undefined });
    // 빈 소스는 스키마 단계에서 거부된다.
    expect(() => tool.parameters.parse({})).toThrow();
    // 별칭(source/destination)이 정규 필드로 흡수된다.
    const parsed = tool.parameters.parse({ source: 'C:/a.txt', destination: 'D:/out' });
    expect(parsed).toMatchObject({ sources: ['C:/a.txt'], destDir: 'D:/out', conflict: 'rename' });

    const ok = await runWithJobs(
      () => tool.execute('c2', parsed, SIG),
      [{ jobSuffix: 1, result: { files: 1, bytes: 10, skipped: 0, renamed: 0, warning: false } }],
    );
    expect(ok.content).toContain('Copied 1 item(s)');
    const copyCall = invokeCalls.find((c) => c.cmd === 'fc_copy');
    expect(copyCall?.args).toMatchObject({ sources: ['C:/a.txt'], destDir: 'D:/out', conflict: 'rename' });
  });

  it('fs_move snapshots sources before acting', async () => {
    const tool = createFsMoveTool({ workFolder: 'C:/work' });
    const res = await runWithJobs(
      () => tool.execute('c1', { sources: ['C:/a.txt'], destDir: 'D:/out', conflict: 'rename' }, SIG),
      [
        { jobSuffix: 1, result: { files: 1 } },
        { jobSuffix: 2, result: { files: 1, bytes: 5, skipped: 0, renamed: 0, warning: false } },
      ],
    );
    expect(res.content).toContain('Moved 1 item(s)');
    const mkdirCall = invokeCalls.find((c) => c.cmd === 'fc_mkdir');
    expect(mkdirCall?.args.path as string).toContain('C:/work');
    expect(mkdirCall?.args.path as string).toContain('backup');
  });

  it('fs_rename/fs_trash call sync commands', async () => {
    const rename = createFsRenameTool({ workFolder: undefined });
    const r1 = await rename.execute('c1', { path: 'C:/a.txt', newName: 'b.txt' }, SIG);
    expect(r1.content).toContain('Renamed to b.txt.');
    expect(r1.content).toContain('backup skipped');

    const trash = createFsTrashTool({ workFolder: undefined });
    const r2 = await trash.execute('c1', { paths: ['C:/a.txt'] }, SIG);
    expect(r2.content).toContain('Moved 1 item(s) to trash.');
  });

  it('fs_info formats stat results', async () => {
    const tool = createFsInfoTool();
    const res = await runWithJobs(
      () => tool.execute('c1', { paths: ['C:/d'] }, SIG),
      [{ jobSuffix: 1, result: { paths: ['C:/d'], file_count: 3, dir_count: 1, total_bytes: 2048 } }],
    );
    expect(res.content).toContain('files=3 dirs=1');
    expect(res.content).toContain('2.0 KB');
  });

  it('fs_search collects matches', async () => {
    const tool = createFsSearchTool();
    const pending = tool.execute('c1', { root: 'C:/d', namePattern: '*.pdf' }, SIG);
    await flush();
    for (const h of [...evtHandlers]) {
      h({ payload: { kind: 'match', job_id: 'job-1', m: { path: 'C:/d/a.pdf', is_dir: false, line_number: null, line_content: null } } });
    }
    emitDone('job-1', {});
    const res = await pending;
    expect(res.content).toContain('1 match(es)');
    expect(res.content).toContain('C:/d/a.pdf');
  });

  it('explorer tool needs a registered UI host', async () => {
    const tool = createExplorerTool();
    await expect(
      tool.execute('c1', { action: 'open', path: 'C:/d' }, SIG),
    ).rejects.toThrow('not available');

    const seen: string[] = [];
    setExplorerOpener((req) => {
      seen.push(`${req.action}:${req.path}`);
    });
    const ok = await tool.execute('c1', { action: 'goto', path: 'C:/d' }, SIG);
    expect(ok.content).toContain('C:/d');
    expect(seen).toEqual(['goto:C:/d']);
  });

  it('doc_read returns parsed text', async () => {
    const tool = createDocReadTool();
    const res = await tool.execute('c1', { path: 'C:/d/a.pdf' }, SIG);
    expect(res.content).toContain('parsed text');
    expect(res.content).toContain('[C:/d/a.pdf]');
  });
});
