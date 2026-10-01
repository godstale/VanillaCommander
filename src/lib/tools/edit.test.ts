import { describe, it, expect, vi, beforeEach } from 'vitest';
import { editTool, countOccurrences } from '@/lib/tools/edit';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('editTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly counts occurrences of substrings', () => {
    expect(countOccurrences('hello world hello', 'hello')).toBe(2);
    expect(countOccurrences('hello world', 'xyz')).toBe(0);
    expect(countOccurrences('aaa', 'a')).toBe(3);
    expect(countOccurrences('', 'test')).toBe(0);
  });

  it('fails with informative error when oldText has 0 occurrences', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('line 1\nline 2\nline 3');

    const signal = new AbortController().signal;
    await expect(
      editTool.execute(
        'call_1',
        {
          path: '/test/file.txt',
          oldText: 'nonexistent line',
          newText: 'replacement',
        },
        signal,
      ),
    ).rejects.toThrow(/치환 대상\(oldText\)을 파일.*찾을 수 없습니다/);
  });

  it('fails with informative error when oldText has multiple occurrences', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('repeat\nsome text\nrepeat');
    const signal = new AbortController().signal;

    await expect(
      editTool.execute(
        'call_2',
        {
          path: '/test/file.txt',
          oldText: 'repeat',
          newText: 'replacement',
        },
        signal,
      ),
    ).rejects.toThrow(/2건 존재하여 고유하지 않습니다/);
  });

  it('successfully replaces content when exactly one match exists', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('line 1\nTarget Text\nline 3');
    const signal = new AbortController().signal;

    const result = await editTool.execute(
      'call_3',
      {
        path: '/test/file.txt',
        oldText: 'Target Text',
        newText: 'Updated Text',
      },
      signal,
    );

    expect(result.content).toContain('Successfully replaced text');
    expect(invoke).toHaveBeenCalledWith('write_text_file', {
      path: '/test/file.txt',
      contents: 'line 1\nUpdated Text\nline 3',
    });
  });
});
