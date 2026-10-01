import { describe, expect, it } from 'vitest';
import {
  capitalWordFrequency,
  englishCapital,
  englishLowercase,
} from './changeCase';

describe('change_case:capital_word_frequency', () => {
  it('passes at-least capital words', () => {
    expect(
      capitalWordFrequency('THIS is a TEST', {
        capital_frequency: 2,
        capital_relation: 'at least',
      }).pass,
    ).toBe(true);
  });

  it('fails less-than when over limit', () => {
    expect(
      capitalWordFrequency('THIS is a TEST', {
        capital_frequency: 2,
        capital_relation: 'less than',
      }).pass,
    ).toBe(false);
  });
});

describe('change_case:english_capital', () => {
  it('passes uppercase', () => {
    expect(englishCapital('HELLO WORLD', {}).pass).toBe(true);
  });

  it('fails mixed case', () => {
    expect(englishCapital('Hello World', {}).pass).toBe(false);
  });
});

describe('change_case:english_lowercase', () => {
  it('passes lowercase', () => {
    expect(englishLowercase('hello world', {}).pass).toBe(true);
  });

  it('fails mixed case', () => {
    expect(englishLowercase('Hello', {}).pass).toBe(false);
  });
});
