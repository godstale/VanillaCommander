import { describe, expect, it } from 'vitest';
import { extractJsonPath, formatMessagesAsPrompt } from './cliRunner';

describe('extractJsonPath', () => {
  const doc = { a: { b: [{ c: 'hit' }, { c: 'miss' }] }, n: 42 };

  it('extracts nested object paths', () => {
    expect(extractJsonPath(doc, 'a.b.0.c')).toBe('hit');
    expect(extractJsonPath(doc, 'n')).toBe(42);
  });

  it('returns the whole value for an empty path', () => {
    expect(extractJsonPath(doc, '')).toBe(doc);
    expect(extractJsonPath(doc, '  ')).toBe(doc);
  });

  it('returns undefined for missing segments', () => {
    expect(extractJsonPath(doc, 'a.x.c')).toBeUndefined();
    expect(extractJsonPath(doc, 'a.b.9.c')).toBeUndefined();
    expect(extractJsonPath(doc, 'n.deeper')).toBeUndefined();
    expect(extractJsonPath(null, 'a')).toBeUndefined();
  });
});

describe('formatMessagesAsPrompt', () => {
  it('joins role/content pairs', () => {
    expect(
      formatMessagesAsPrompt([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ]),
    ).toBe('system: sys\n\nuser: hi');
  });
});
