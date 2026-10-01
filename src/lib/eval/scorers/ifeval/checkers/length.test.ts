import { describe, expect, it } from 'vitest';
import {
  nthParagraphFirstWord,
  numberParagraphs,
  numberSentences,
  numberWords,
} from './length';

describe('length_constraints:number_sentences', () => {
  it('passes at-least sentence count', () => {
    expect(
      numberSentences('One. Two. Three.', {
        num_sentences: 3,
        relation: 'at least',
      }).pass,
    ).toBe(true);
  });

  it('fails when too few sentences', () => {
    expect(
      numberSentences('Only one.', { num_sentences: 3, relation: 'at least' })
        .pass,
    ).toBe(false);
  });

  it('counts Korean sentences', () => {
    expect(
      numberSentences('밥을 먹었다. 맛있었다.', {
        num_sentences: 2,
        relation: 'at least',
      }).pass,
    ).toBe(true);
  });
});

describe('length_constraints:number_paragraphs', () => {
  it('passes exact-ish paragraph counts via relation', () => {
    expect(
      numberParagraphs('a\n\nb\n\nc', {
        num_paragraphs: 3,
        relation: 'at least',
      }).pass,
    ).toBe(true);
  });

  it('fails less-than when over limit', () => {
    expect(
      numberParagraphs('a\n\nb\n\nc', {
        num_paragraphs: 2,
        relation: 'less than',
      }).pass,
    ).toBe(false);
  });
});

describe('length_constraints:number_words', () => {
  it('passes Korean 어절 counts', () => {
    expect(
      numberWords('오늘 날씨가 좋다', { num_words: 3, relation: 'at least' })
        .pass,
    ).toBe(true);
  });

  it('fails when word count exceeds less-than limit', () => {
    expect(
      numberWords('one two three four', {
        num_words: 3,
        relation: 'less than',
      }).pass,
    ).toBe(false);
  });
});

describe('length_constraints:nth_paragraph_first_word', () => {
  it('passes when nth paragraph starts with the word', () => {
    expect(
      nthParagraphFirstWord('Hello there\n\nWorld peace', {
        num_paragraphs: 2,
        nth_paragraph: 2,
        first_word: 'World',
      }).pass,
    ).toBe(true);
  });

  it('fails when the first word differs', () => {
    expect(
      nthParagraphFirstWord('Hello there\n\nWorld peace', {
        num_paragraphs: 2,
        nth_paragraph: 2,
        first_word: 'Hello',
      }).pass,
    ).toBe(false);
  });

  it('fails when there are too few paragraphs', () => {
    expect(
      nthParagraphFirstWord('Only one', {
        num_paragraphs: 2,
        nth_paragraph: 2,
        first_word: 'Only',
      }).pass,
    ).toBe(false);
  });
});
