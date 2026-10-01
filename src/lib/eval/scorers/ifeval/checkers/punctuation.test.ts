import { describe, expect, it } from 'vitest';
import { noComma } from './punctuation';

describe('punctuation:no_comma', () => {
  it('passes without comma', () => {
    expect(noComma('hello world', {}).pass).toBe(true);
  });

  it('fails with comma', () => {
    expect(noComma('hello, world', {}).pass).toBe(false);
  });
});
