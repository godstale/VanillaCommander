import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeTool, createWriteTool } from '@/lib/tools/write';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('writeTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls write_text_file with path, contents, and undefined workspaceRoot by default', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    const signal = new AbortController().signal;
    const result = await writeTool.execute(
      'call_1',
      {
        path: './test.ino',
        content: 'void setup() {}',
      },
      signal,
    );

    expect(invoke).toHaveBeenCalledWith('write_text_file', {
      path: './test.ino',
      contents: 'void setup() {}',
      workspaceRoot: undefined,
    });
    expect(result.content).toContain('Successfully wrote');
  });

  it('createWriteTool passes workspaceRoot to write_text_file', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    const signal = new AbortController().signal;
    const tool = createWriteTool({ workspaceRoot: 'C:/Workspace/Project' });
    const result = await tool.execute(
      'call_2',
      {
        path: './ThreeLEDToggle.ino',
        content: 'void loop() {}',
      },
      signal,
    );

    expect(invoke).toHaveBeenCalledWith('write_text_file', {
      path: './ThreeLEDToggle.ino',
      contents: 'void loop() {}',
      workspaceRoot: 'C:/Workspace/Project',
    });
    expect((result.details as Record<string, unknown>).workspaceRoot).toBe('C:/Workspace/Project');
  });
});
