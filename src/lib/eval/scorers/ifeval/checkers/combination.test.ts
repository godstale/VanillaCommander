import { describe, expect, it } from 'vitest';
import { repeatPrompt, twoResponses } from './combination';

describe('combination:two_responses', () => {
  it('passes two parts', () => {
    expect(twoResponses('first ****** second', {}).pass).toBe(true);
  });

  it('fails single part', () => {
    expect(twoResponses('only one', {}).pass).toBe(false);
  });

  it('fails three parts', () => {
    expect(twoResponses('a ****** b ****** c', {}).pass).toBe(false);
  });
});

describe('combination:repeat_prompt', () => {
  it('passes when repeating prompt first', () => {
    expect(
      repeatPrompt('Write a poem. Here it is...', {
        prompt_to_repeat: 'Write a poem.',
      }).pass,
    ).toBe(true);
  });

  it('fails when prompt is not first', () => {
    expect(
      repeatPrompt('Here it is: Write a poem.', {
        prompt_to_repeat: 'Write a poem.',
      }).pass,
    ).toBe(false);
  });
});
