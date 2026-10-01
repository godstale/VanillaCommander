import { describe, expect, it } from 'vitest';
import { koCharCount, koSpeechStyle } from './koCheckers';

describe('ko:number_characters', () => {
  it('passes at-least character count', () => {
    expect(
      koCharCount('오늘 날씨가 좋다', {
        num_characters: 5,
        relation: 'at least',
      }).pass,
    ).toBe(true);
  });

  it('fails less-than when over limit', () => {
    expect(
      koCharCount('오늘 날씨가 좋다', {
        num_characters: 5,
        relation: 'less than',
      }).pass,
    ).toBe(false);
  });
});

describe('ko:speech_style', () => {
  it('passes polite text for 존댓말', () => {
    const text = '오늘 날씨가 좋습니다. 내일도 좋겠어요. 함께 가세요.';
    expect(koSpeechStyle(text, { style: '존댓말' }).pass).toBe(true);
  });

  it('fails casual text for 존댓말', () => {
    const text = '오늘 날씨가 좋다. 내일도 좋겠다. 같이 가자.';
    expect(koSpeechStyle(text, { style: 'polite' }).pass).toBe(false);
  });

  it('passes casual text for 반말', () => {
    const text = '오늘 날씨가 좋다. 내일도 좋겠다. 같이 가자.';
    expect(koSpeechStyle(text, { style: '반말' }).pass).toBe(true);
  });

  it('fails polite text for 반말', () => {
    const text = '오늘 날씨가 좋습니다. 내일도 좋겠어요.';
    expect(koSpeechStyle(text, { style: 'casual' }).pass).toBe(false);
  });

  it('fails invalid style', () => {
    expect(koSpeechStyle('안녕하세요.', { style: 'formal' }).pass).toBe(false);
  });
});
