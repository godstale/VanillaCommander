import { describe, it, expect } from 'vitest';
import {
  matchesGlob,
  resolveInboxDir,
  shouldProcessFile,
  DEFAULT_WIKI_PROMPT,
} from './settings';

const BASE_SETTINGS = {
  allowedExtensions: ['pdf', 'md', 'txt', 'png'],
  maxFileMb: 20,
  excludeGlobs: [] as string[],
};

describe('wiki settings helpers', () => {
  it('resolves the inbox dir with work-folder fallback', () => {
    expect(resolveInboxDir('C:\\work', '')).toBe('C:\\work\\wiki-inbox');
    expect(resolveInboxDir('/home/u/work', '')).toBe('/home/u/work/wiki-inbox');
    expect(resolveInboxDir('C:\\work', 'D:\\inbox')).toBe('D:\\inbox');
    expect(resolveInboxDir(null, '')).toBe('wiki-inbox');
  });

  it('matches simple globs case-insensitively', () => {
    expect(matchesGlob('C:/dl/~$temp.docx', '~$*')).toBe(true);
    expect(matchesGlob('C:/dl/photo.PNG', '*.png')).toBe(true);
    expect(matchesGlob('C:/dl/a/b/c.pdf', '**/b/*.pdf')).toBe(true);
    expect(matchesGlob('C:/dl/report.pdf', '*.tmp')).toBe(false);
    expect(matchesGlob('C:/dl/report.pdf', '')).toBe(false);
  });

  it('accepts whitelisted files within limits', () => {
    expect(shouldProcessFile('C:/dl/a.pdf', 1024, BASE_SETTINGS)).toEqual({ ok: true });
    expect(shouldProcessFile('C:/dl/a.MD', 1024, BASE_SETTINGS)).toEqual({ ok: true });
  });

  it('rejects extensions, oversize, and excluded globs', () => {
    expect(shouldProcessFile('C:/dl/a.exe', 10, BASE_SETTINGS).ok).toBe(false);
    expect(shouldProcessFile('C:/dl/a.pdf', 21 * 1024 * 1024, BASE_SETTINGS)).toEqual({
      ok: false,
      reason: '크기 제한 초과입니다 (20MB)',
    });
    const verdict = shouldProcessFile('C:/dl/tmp/a.pdf', 10, {
      ...BASE_SETTINGS,
      excludeGlobs: ['**/tmp/**'],
    });
    expect(verdict.ok).toBe(false);
  });

  it('ships a default prompt that asks for a category choice', () => {
    expect(DEFAULT_WIKI_PROMPT).toContain('카테고리');
    expect(DEFAULT_WIKI_PROMPT).toContain('kebab-case');
  });
});
