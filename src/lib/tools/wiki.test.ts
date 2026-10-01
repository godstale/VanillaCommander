import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWikiTool, slugifyWikiTitle, wikiTool } from '@/lib/tools/wiki';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('slugifyWikiTitle', () => {
  it('converts titles to kebab-case slugs', () => {
    expect(slugifyWikiTitle('Ollama Setup Guide')).toBe('ollama-setup-guide');
  });

  it('falls back to a note- id for empty titles', () => {
    expect(slugifyWikiTitle('!!!')).toMatch(/^note-/);
  });
});

describe('wikiTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes wiki metadata for the registry', () => {
    expect(wikiTool.name).toBe('wiki');
    expect(wikiTool.risk).toBe('low');
  });

  it('requires an open project folder', async () => {
    const tool = createWikiTool({});
    await expect(
      tool.execute('call_1', { action: 'list' }, new AbortController().signal),
    ).rejects.toThrow(/project folder/);
  });

  it('ingests a page and updates index + log', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(undefined) // write source
      .mockResolvedValueOnce(null) // read index (missing)
      .mockResolvedValueOnce(undefined) // write index
      .mockResolvedValueOnce(null) // read log (missing)
      .mockResolvedValueOnce(undefined); // write log

    const tool = createWikiTool({ workspaceRoot: 'C:/proj' });
    const result = await tool.execute(
      'call_2',
      { action: 'ingest', title: 'Ollama Setup', content: 'Install Ollama.' },
      new AbortController().signal,
    );

    expect(invoke).toHaveBeenNthCalledWith(1, 'write_text_file', {
      path: 'wiki/sources/ollama-setup.md',
      contents: expect.stringContaining("title: 'Ollama Setup'"),
      workspaceRoot: 'C:/proj',
    });
    expect(result.content).toContain('ollama-setup');
    expect((result.details as Record<string, unknown>).slug).toBe('ollama-setup');
  });

  it('rejects ingest without title', async () => {
    const tool = createWikiTool({ workspaceRoot: 'C:/proj' });
    await expect(
      tool.execute(
        'call_3',
        { action: 'ingest', content: 'body only' },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/title/);
  });

  it('queries with an escaped literal pattern', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { file_path: 'C:/proj/wiki/sources/ollama-setup.md', line_number: 7, line_content: 'Install Ollama (v1.0).' },
    ]);

    const tool = createWikiTool({ workspaceRoot: 'C:/proj' });
    const result = await tool.execute(
      'call_4',
      { action: 'query', query: 'Ollama (v1.0)' },
      new AbortController().signal,
    );

    expect(invoke).toHaveBeenCalledWith('grep_files', {
      pattern: expect.stringContaining('\\('),
      path: 'wiki',
      glob: '*.md',
      maxResults: 20,
      workspaceRoot: 'C:/proj',
    });
    expect(result.content).toContain('ollama-setup');
  });

  it('reports an empty wiki on list when the folder is missing', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Not a directory'));

    const tool = createWikiTool({ workspaceRoot: 'C:/proj' });
    const result = await tool.execute(
      'call_5',
      { action: 'list' },
      new AbortController().signal,
    );

    expect(result.content).toContain('Wiki is empty');
  });

  it('deletes a page by slug', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(undefined) // delete file
      .mockResolvedValueOnce('# Wiki Index\n- [T](sources/ollama-setup.md) — 2026-01-01\n') // read index
      .mockResolvedValueOnce(undefined) // write index
      .mockResolvedValueOnce(null) // read log
      .mockResolvedValueOnce(undefined); // write log

    const tool = createWikiTool({ workspaceRoot: 'C:/proj' });
    const result = await tool.execute(
      'call_6',
      { action: 'delete', slug: 'ollama-setup' },
      new AbortController().signal,
    );

    expect(invoke).toHaveBeenCalledWith('delete_path', {
      path: 'wiki/sources/ollama-setup.md',
      workspaceRoot: 'C:/proj',
    });
    expect(result.content).toContain('Deleted');
  });
});
