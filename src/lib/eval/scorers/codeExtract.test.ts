import { describe, expect, it } from 'vitest';
import { extractCode } from './codeExtract';

describe('extractCode', () => {
  it('picks the last fenced block with a matching tag', () => {
    const response = [
      'first try:',
      '```js',
      'function add(a, b) { return a - b; }',
      '```',
      'fixed:',
      '```javascript',
      'function add(a, b) { return a + b; }',
      '```',
    ].join('\n');
    const r = extractCode(response, 'js', 'add');
    expect(r.code).toContain('return a + b;');
    expect(r.reason).toContain('last fenced');
  });

  it('falls back to the first fence when no tag matches', () => {
    const response = ['```python', 'def add(a, b): return a + b', '```', '```ruby', 'oops', '```'].join('\n');
    const r = extractCode(response, 'js');
    expect(r.code).toContain('def add');
    expect(r.reason).toContain('first fenced block');
  });

  it('falls back to the whole text when there is no fence', () => {
    const response = 'function add(a, b) {\n  return a + b;\n}';
    const r = extractCode(response, 'js', 'add');
    expect(r.code).toBe(response);
    expect(r.reason).toContain('whole response');
  });

  it('returns null when the entry point is not defined (js)', () => {
    const response = '```js\nfunction subtract(a, b) { return a - b; }\n```';
    const r = extractCode(response, 'js', 'add');
    expect(r.code).toBeNull();
    expect(r.reason).toContain("'add'");
  });

  it('returns null when the entry point is not defined (python)', () => {
    const response = '```python\ndef subtract(a, b):\n    return a - b\n```';
    const r = extractCode(response, 'python', 'add');
    expect(r.code).toBeNull();
    expect(r.reason).toContain("'add'");
  });

  it('accepts python entry points defined via def', () => {
    const response = '```python\ndef add(a, b):\n    return a + b\n```';
    const r = extractCode(response, 'python', 'add');
    expect(r.code).toContain('def add');
  });

  it('returns null for an empty response', () => {
    const r = extractCode('   \n  ', 'js', 'add');
    expect(r.code).toBeNull();
  });
});
