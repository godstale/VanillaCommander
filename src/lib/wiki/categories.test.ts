import { describe, it, expect } from 'vitest';
import {
  buildClassificationSchema,
  mergeCategories,
  normalizeCategoryPath,
  resolveCategory,
} from './categories';

describe('normalizeCategoryPath', () => {
  it('normalizes separators and strips forbidden characters', () => {
    expect(normalizeCategoryPath(' 문서 \\ 업무/ ')).toBe('문서/업무');
    expect(normalizeCategoryPath('a:b/c*')).toBe('ab/c');
  });

  it('rejects traversal, empty and too deep paths', () => {
    expect(normalizeCategoryPath('../etc')).toBeNull();
    expect(normalizeCategoryPath('a/./b')).toBeNull();
    expect(normalizeCategoryPath('  /  ')).toBeNull();
    expect(normalizeCategoryPath('a/b/c/d')).toBeNull();
    expect(normalizeCategoryPath('x'.repeat(41))).toBeNull();
  });
});

describe('mergeCategories', () => {
  it('dedupes case-insensitively and includes ancestors', () => {
    expect(mergeCategories(['문서/업무', 'Docs/A'], ['docs/a/b', '문서'])).toEqual([
      'Docs',
      'Docs/A',
      'docs/a/b',
      '문서',
      '문서/업무',
    ]);
  });
});

describe('resolveCategory', () => {
  const known = ['문서', '문서/업무', '재무'];

  it('matches existing paths using the stored spelling', () => {
    expect(resolveCategory('문서/업무', known, false)).toEqual({ path: '문서/업무', isNew: false });
  });

  it('creates a new child only under an existing parent when allowed', () => {
    expect(resolveCategory('문서/업무/회의록', known, true)).toEqual({
      path: '문서/업무/회의록',
      isNew: true,
    });
    expect(resolveCategory('문서/학습', known, true)).toEqual({ path: '문서/학습', isNew: true });
    // 부모가 없는 깊은 경로는 새로 만들지 않고 가까운 상위로 접는다.
    expect(resolveCategory('여행/일정/2026', known, true)).toBeNull();
  });

  it('allows a new top-level category when allowed', () => {
    expect(resolveCategory('여행', known, true)).toEqual({ path: '여행', isNew: true });
  });

  it('falls back to the nearest existing ancestor when new categories are off', () => {
    expect(resolveCategory('문서/업무/회의록', known, false)).toEqual({
      path: '문서/업무',
      isNew: false,
    });
    expect(resolveCategory('여행', known, false)).toBeNull();
    expect(resolveCategory('../x', known, true)).toBeNull();
  });
});

describe('buildClassificationSchema', () => {
  it('restricts categoryPath to known paths when new ones are disallowed', () => {
    const schema = buildClassificationSchema(['a', 'a/b'], false) as {
      properties: { categoryPath: { enum?: string[] } };
    };
    expect(schema.properties.categoryPath.enum).toEqual(['a', 'a/b']);
  });

  it('leaves categoryPath free when new categories are allowed', () => {
    const schema = buildClassificationSchema(['a'], true) as {
      properties: { categoryPath: { enum?: string[] } };
    };
    expect(schema.properties.categoryPath.enum).toBeUndefined();
  });
});
