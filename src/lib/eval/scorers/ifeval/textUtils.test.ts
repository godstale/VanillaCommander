import { describe, expect, it } from 'vitest';
import {
  countCapitalWords,
  countSentences,
  countWords,
  isAllLowerEnglish,
  isAllUpperEnglish,
  scriptRatio,
  splitParagraphs,
  splitSentences,
} from './textUtils';

describe('countWords', () => {
  it('counts English words by whitespace', () => {
    expect(countWords('hello world')).toBe(2);
    expect(countWords('  hello   world  ')).toBe(2);
    expect(countWords('')).toBe(0);
  });

  it('counts Korean 어절 by whitespace', () => {
    expect(countWords('오늘 날씨가 좋다')).toBe(3);
    expect(countWords('밥을 먹었다')).toBe(2);
  });
});

describe('splitSentences', () => {
  it('splits English sentences', () => {
    expect(splitSentences('Hello world. How are you? Fine!')).toHaveLength(3);
  });

  it('splits Korean sentences with 다./요. endings', () => {
    expect(splitSentences('오늘 날씨가 좋다. 내일도 좋겠어요.')).toHaveLength(2);
    expect(countSentences('밥을 먹었다! 맛있었다?')).toBe(2);
  });

  it('ignores empty fragments', () => {
    expect(splitSentences('   ')).toHaveLength(0);
  });
});

describe('scriptRatio', () => {
  it('detects Hangul dominance', () => {
    expect(scriptRatio('오늘 날씨가 좋다', 'hangul')).toBeGreaterThanOrEqual(
      0.6,
    );
    expect(scriptRatio('오늘 날씨가 좋다', 'latin')).toBeLessThan(0.6);
  });

  it('detects Latin dominance', () => {
    expect(scriptRatio('Hello world', 'latin')).toBeGreaterThanOrEqual(0.6);
  });

  it('returns 0 for text without letters', () => {
    expect(scriptRatio('123 !!!', 'latin')).toBe(0);
  });
});

describe('case utils', () => {
  it('detects all-upper English', () => {
    expect(isAllUpperEnglish('HELLO WORLD')).toBe(true);
    expect(isAllUpperEnglish('Hello World')).toBe(false);
    expect(isAllUpperEnglish('')).toBe(false);
  });

  it('detects all-lower English', () => {
    expect(isAllLowerEnglish('hello world')).toBe(true);
    expect(isAllLowerEnglish('Hello')).toBe(false);
  });

  it('counts capital words', () => {
    expect(countCapitalWords('THIS is a TEST')).toBe(2);
    expect(countCapitalWords('nothing here')).toBe(0);
  });
});

describe('splitParagraphs', () => {
  it('splits on blank lines and strips fenced code', () => {
    const text = 'para one\n\n```\ncode\n```\n\npara two';
    expect(splitParagraphs(text)).toEqual(['para one', 'para two']);
  });
});
