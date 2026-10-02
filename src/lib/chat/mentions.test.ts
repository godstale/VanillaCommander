import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyMentionPick,
  getMentionQuery,
  resolveMentions,
} from './mentions';
import * as ipc from '@/lib/commander/ipc';

vi.mock('@/lib/commander/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commander/ipc')>();
  return {
    ...actual,
    fcListDir: vi.fn(async (path: string) => {
      if (path === 'C:/work') {
        return [
          { name: 'report.pdf', path: 'C:/work/report.pdf', kind: 'file', size: 1000, modified_ms: 1, hidden: false, readonly: false, symlink: false, warning: false },
          { name: 'notes.txt', path: 'C:/work/notes.txt', kind: 'file', size: 11, modified_ms: 1, hidden: false, readonly: false, symlink: false, warning: false },
          { name: 'docs', path: 'C:/work/docs', kind: 'dir', size: 0, modified_ms: 1, hidden: false, readonly: false, symlink: false, warning: false },
          { name: 'big.log', path: 'C:/work/big.log', kind: 'file', size: 100000, modified_ms: 1, hidden: false, readonly: false, symlink: false, warning: false },
        ];
      }
      if (path === 'C:/work/docs') {
        return [
          { name: 'inner.md', path: 'C:/work/docs/inner.md', kind: 'file', size: 5, modified_ms: 1, hidden: false, readonly: false, symlink: false, warning: false },
        ];
      }
      return [];
    }),
    fcReadTextHead: vi.fn(async (path: string) => {
      if (path === 'C:/work/notes.txt') {
        return { text: 'hello notes', size: 11, truncated: false };
      }
      return { text: '', size: 0, truncated: true };
    }),
  };
});

describe('getMentionQuery', () => {
  it('finds @query before cursor', () => {
    expect(getMentionQuery('hello @rep', 10)).toEqual({ start: 6, query: 'rep' });
    expect(getMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(getMentionQuery('no mention here', 15)).toBeNull();
    expect(getMentionQuery('email a@b here', 10)).toBeNull();
    expect(getMentionQuery('say @a and @', 12)).toEqual({ start: 11, query: '' });
    expect(getMentionQuery('say @a and @b', 13)).toEqual({ start: 11, query: 'b' });
  });
});

describe('applyMentionPick', () => {
  it('replaces the query span and quotes paths with spaces', () => {
    const r1 = applyMentionPick('요약 @rep', 3, 'rep', 'C:/work/report.pdf');
    expect(r1).toEqual({ text: '요약 @C:/work/report.pdf ', cursor: 3 + '@C:/work/report.pdf '.length });
    const r2 = applyMentionPick('@my', 0, 'my', 'C:/my docs/a.txt');
    expect(r2.text).toBe('@"C:/my docs/a.txt" ');
  });
});

describe('resolveMentions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inlines small text files', async () => {
    const { text, refs } = await resolveMentions('요약해줘 @notes.txt', { cwd: 'C:/work' });
    expect(refs).toEqual([{ path: 'C:/work/notes.txt', kind: 'file', size: 11 }]);
    expect(text).toContain('@C:/work/notes.txt (파일 내용)');
    expect(text).toContain('hello notes');
    expect(ipc.fcReadTextHead).toHaveBeenCalled();
  });

  it('lists folders one level deep', async () => {
    const { text, refs } = await resolveMentions('@docs 정리', { cwd: 'C:/work' });
    expect(refs).toEqual([{ path: 'C:/work/docs', kind: 'dir', size: 0 }]);
    expect(text).toContain('@C:/work/docs (폴더');
    expect(text).toContain('inner.md');
  });

  it('keeps binary/large files as path-only references', async () => {
    const pdf = await resolveMentions('@report.pdf 읽어줘', { cwd: 'C:/work' });
    expect(pdf.refs[0]).toMatchObject({ path: 'C:/work/report.pdf', kind: 'file' });
    expect(pdf.text).toContain('read 도구로 읽으세요');
    expect(pdf.text).not.toContain('파일 내용');

    const big = await resolveMentions('@big.log 봐줘', { cwd: 'C:/work' });
    expect(big.text).toContain('read 도구로 읽으세요');
  });

  it('leaves unknown or cwd-less mentions untouched', async () => {
    const { text, refs } = await resolveMentions('@missing.txt 확인', { cwd: 'C:/work' });
    expect(refs).toEqual([]);
    expect(text).toContain('@missing.txt');

    const noCwd = await resolveMentions('@notes.txt 확인', {});
    expect(noCwd.refs).toEqual([]);
    expect(noCwd.text).toContain('@notes.txt');
  });

  it('supports quoted absolute paths', async () => {
    const { refs } = await resolveMentions('@"C:/work/notes.txt" 요약', { cwd: 'D:/other' });
    expect(refs).toEqual([{ path: 'C:/work/notes.txt', kind: 'file', size: 11 }]);
  });
});
