import { describe, expect, it } from 'vitest';
import { responseLanguage } from './language';

describe('language:response_language', () => {
  it('passes English text for en', () => {
    const result = responseLanguage('Hello world, this is a test.', {
      language: 'en',
    });
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('script-ratio heuristic');
  });

  it('fails Korean text for en', () => {
    expect(
      responseLanguage('오늘 날씨가 정말 좋습니다', { language: 'en' }).pass,
    ).toBe(false);
  });

  it('passes Korean text for ko', () => {
    expect(
      responseLanguage('오늘 날씨가 정말 좋습니다', { language: 'ko' }).pass,
    ).toBe(true);
  });

  it('fails English text for ko', () => {
    expect(responseLanguage('Hello world', { language: 'ko' }).pass).toBe(
      false,
    );
  });

  it('fails empty text', () => {
    expect(responseLanguage('1234 !!!', { language: 'en' }).pass).toBe(false);
  });
});
