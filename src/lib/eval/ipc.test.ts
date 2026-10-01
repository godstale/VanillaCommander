import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  evalListPacks,
  evalReadPackFile,
  evalWritePackFiles,
  evalDeletePack,
  evalSandboxCreate,
  evalSandboxCreateFromFiles,
  evalSandboxSnapshot,
  evalSandboxDestroy,
  evalSandboxCleanupAll,
  evalDetectRuntimes,
  evalRunPython,
  evalDownloadFile,
  evalExportWrite,
  evalReadImportFile,
} from '@/lib/eval/ipc';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('eval ipc wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('evalListPacks forwards scope and workspaceRoot', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await evalListPacks('user', 'C:/ws');
    expect(invoke).toHaveBeenCalledWith('eval_list_packs', {
      scope: 'user',
      workspaceRoot: 'C:/ws',
    });
  });

  it('evalReadPackFile forwards snake_case backend args as camelCase', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('{}');
    await evalReadPackFile('builtin', 'kmmlu-lite', 'manifest.json');
    expect(invoke).toHaveBeenCalledWith('eval_read_pack_file', {
      scope: 'builtin',
      packId: 'kmmlu-lite',
      relPath: 'manifest.json',
      workspaceRoot: undefined,
    });
  });

  it('evalWritePackFiles maps relPath to rel_path', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await evalWritePackFiles('user', 'my-pack', [
      { relPath: 'samples.jsonl', content: '{}\n' },
    ]);
    expect(invoke).toHaveBeenCalledWith('eval_write_pack_files', {
      scope: 'user',
      packId: 'my-pack',
      files: [{ rel_path: 'samples.jsonl', content: '{}\n' }],
      workspaceRoot: undefined,
    });
  });

  it('evalDeletePack forwards packId', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await evalDeletePack('project', 'my-pack', 'C:/ws');
    expect(invoke).toHaveBeenCalledWith('eval_delete_pack', {
      scope: 'project',
      packId: 'my-pack',
      workspaceRoot: 'C:/ws',
    });
  });

  it('evalSandboxCreate forwards fixture args', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('/tmp/sb');
    const root = await evalSandboxCreate('user', 'my-pack', 'fixtures/basic');
    expect(root).toBe('/tmp/sb');
    expect(invoke).toHaveBeenCalledWith('eval_sandbox_create', {
      scope: 'user',
      packId: 'my-pack',
      fixtureRelDir: 'fixtures/basic',
      workspaceRoot: undefined,
    });
  });

  it('evalSandboxCreateFromFiles maps file entries', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('/tmp/sb2');
    await evalSandboxCreateFromFiles([{ relPath: 'main.py', content: 'x=1' }]);
    expect(invoke).toHaveBeenCalledWith('eval_sandbox_create_from_files', {
      files: [{ rel_path: 'main.py', content: 'x=1' }],
    });
  });

  it('evalSandboxSnapshot forwards sandboxRoot and maxTextBytes', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await evalSandboxSnapshot('/tmp/sb', 65536);
    expect(invoke).toHaveBeenCalledWith('eval_sandbox_snapshot', {
      sandboxRoot: '/tmp/sb',
      maxTextBytes: 65536,
    });
  });

  it('evalSandboxDestroy forwards sandboxRoot', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await evalSandboxDestroy('/tmp/sb');
    expect(invoke).toHaveBeenCalledWith('eval_sandbox_destroy', {
      sandboxRoot: '/tmp/sb',
    });
  });

  it('evalSandboxCleanupAll takes no args', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(3);
    const n = await evalSandboxCleanupAll();
    expect(n).toBe(3);
    expect(invoke).toHaveBeenCalledWith('eval_sandbox_cleanup_all');
  });

  it('evalDetectRuntimes takes no args', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ python: null, node: null });
    await evalDetectRuntimes();
    expect(invoke).toHaveBeenCalledWith('eval_detect_runtimes');
  });

  it('evalRunPython forwards code and timeoutMs', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      exit_code: 0,
      stdout: 'hi',
      stderr: '',
      timed_out: false,
      duration_ms: 12,
    });
    const res = await evalRunPython('print("hi")', 5000);
    expect(res.stdout).toBe('hi');
    expect(invoke).toHaveBeenCalledWith('eval_run_python', {
      code: 'print("hi")',
      timeoutMs: 5000,
    });
  });

  it('evalDownloadFile forwards dest args', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(1234);
    const n = await evalDownloadFile(
      'https://huggingface.co/ds/f.json',
      'user',
      'my-pack',
      'data/f.json',
    );
    expect(n).toBe(1234);
    expect(invoke).toHaveBeenCalledWith('eval_download_file', {
      url: 'https://huggingface.co/ds/f.json',
      destScope: 'user',
      packId: 'my-pack',
      relPath: 'data/f.json',
    });
  });

  it('evalExportWrite and evalReadImportFile forward path', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await evalExportWrite('C:/out/report.json', '{}');
    expect(invoke).toHaveBeenCalledWith('eval_export_write', {
      path: 'C:/out/report.json',
      content: '{}',
    });
    vi.mocked(invoke).mockResolvedValueOnce('data');
    await evalReadImportFile('C:/in/pack.zip');
    expect(invoke).toHaveBeenCalledWith('eval_read_import_file', {
      path: 'C:/in/pack.zip',
    });
  });
});
