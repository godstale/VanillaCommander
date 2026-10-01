import { describe, expect, it } from 'vitest';
import {
  forbiddenWords,
  keywordsExistence,
  keywordsFrequency,
  letterFrequency,
} from './keywords';

describe('keywords:existence', () => {
  it('passes when all keywords present', () => {
    expect(
      keywordsExistence('The quick brown fox', { keywords: ['quick', 'fox'] })
        .pass,
    ).toBe(true);
  });

  it('fails when a keyword is missing', () => {
    const result = keywordsExistence('The quick fox', {
      keywords: ['quick', 'turtle'],
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('turtle');
  });

  it('fails on invalid kwargs', () => {
    expect(keywordsExistence('text', {}).pass).toBe(false);
  });
});

describe('keywords:frequency', () => {
  it('passes at-least frequency', () => {
    expect(
      keywordsFrequency('apple apple apple', {
        keyword: 'apple',
        frequency: 2,
        relation: 'at least',
      }).pass,
    ).toBe(true);
  });

  it('fails less-than frequency when overused', () => {
    expect(
      keywordsFrequency('apple apple apple', {
        keyword: 'apple',
        frequency: 2,
        relation: 'less than',
      }).pass,
    ).toBe(false);
  });
});

describe('keywords:forbidden_words', () => {
  it('passes when no forbidden word appears', () => {
    expect(forbiddenWords('a calm essay', { forbidden_words: ['war'] }).pass).toBe(
      true,
    );
  });

  it('fails when a forbidden word appears', () => {
    expect(
      forbiddenWords('a story of war', { forbidden_words: ['war'] }).pass,
    ).toBe(false);
  });
});

describe('keywords:letter_frequency', () => {
  it('passes at-least letter count', () => {
    expect(
      letterFrequency('hello', {
        letter: 'l',
        let_frequency: 2,
        let_relation: 'at least',
      }).pass,
    ).toBe(true);
  });

  it('fails when letter count is below threshold', () => {
    expect(
      letterFrequency('hello', {
        letter: 'z',
        let_frequency: 1,
        let_relation: 'at least',
      }).pass,
    ).toBe(false);
  });
});
