import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  cleanupAllSandboxes,
  createSandbox,
  createSandboxFromFiles,
  destroySandbox,
  snapshotSandbox,
} from '@/lib/eval/runner/sandbox';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('sandbox runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createSandbox invokes eval_sandbox_create', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('/tmp/sb1');
    const root = await createSandbox('user', 'my-pack', 'fixtures/basic');
    expect(root).toBe('/tmp/sb1');
    expect(invoke).toHaveBeenCalledWith('eval_sandbox_create', {
      scope: 'user',
      packId: 'my-pack',
      fixtureRelDir: 'fixtures/basic',
      workspaceRoot: undefined,
    });
  });

  it('createSandboxFromFiles invokes eval_sandbox_create_from_files', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('/tmp/sb2');
    const root = await createSandboxFromFiles([
      { relPath: 'main.py', content: 'x = 1\n' },
    ]);
    expect(root).toBe('/tmp/sb2');
    expect(invoke).toHaveBeenCalledWith('eval_sandbox_create_from_files', {
      files: [{ rel_path: 'main.py', content: 'x = 1\n' }],
    });
  });

  it('snapshotSandbox hashes text content with sha256', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      {
        path: 'main.py',
        size: 6,
        is_text: true,
        content: 'x = 1\n',
        modified_ms: 123,
      },
      {
        path: 'big.bin',
        size: 999999,
        is_text: false,
        content: null,
        modified_ms: 456,
      },
    ]);
    const snap = await snapshotSandbox('/tmp/sb1', 65536);
    expect(snap.files).toHaveLength(2);
    expect(snap.files[0].path).toBe('main.py');
    expect(snap.files[0].content).toBe('x = 1\n');
    // sha256("x = 1\n") — verify 64 hex chars.
    expect(snap.files[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.files[1].hash).toBe('');
    expect(snap.files[1].content).toBeUndefined();
  });

  it('snapshotSandbox empty content hashes to sha256 of empty string', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { path: 'e.txt', size: 0, is_text: true, content: '', modified_ms: 1 },
    ]);
    const snap = await snapshotSandbox('/tmp/sb', 100);
    expect(snap.files[0].hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('destroySandbox and cleanupAllSandboxes invoke backend', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await destroySandbox('/tmp/sb1');
    expect(invoke).toHaveBeenCalledWith('eval_sandbox_destroy', {
      sandboxRoot: '/tmp/sb1',
    });
    vi.mocked(invoke).mockResolvedValueOnce(2);
    const n = await cleanupAllSandboxes();
    expect(n).toBe(2);
    expect(invoke).toHaveBeenCalledWith('eval_sandbox_cleanup_all');
  });
});
