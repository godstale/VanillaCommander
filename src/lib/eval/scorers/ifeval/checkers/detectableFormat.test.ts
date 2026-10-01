import { describe, expect, it } from 'vitest';
import {
  constrainedResponse,
  jsonFormat,
  multipleSections,
  numberBulletLists,
  numberHighlightedSections,
  title,
} from './detectableFormat';

describe('detectable_format:number_bullet_lists', () => {
  it('passes exact bullet count', () => {
    expect(
      numberBulletLists('- a\n- b\nnormal', { num_bullets: 2 }).pass,
    ).toBe(true);
  });

  it('fails wrong bullet count', () => {
    expect(numberBulletLists('- a\n- b', { num_bullets: 3 }).pass).toBe(false);
  });
});

describe('detectable_format:constrained_response', () => {
  it('passes allowed default response', () => {
    expect(constrainedResponse('Yes', {}).pass).toBe(true);
  });

  it('fails free-form response', () => {
    expect(constrainedResponse('Maybe tomorrow', {}).pass).toBe(false);
  });

  it('supports custom responses kwarg', () => {
    expect(
      constrainedResponse('apple', { responses: ['apple', 'orange'] }).pass,
    ).toBe(true);
  });
});

describe('detectable_format:number_highlighted_sections', () => {
  it('passes exact highlight count', () => {
    expect(
      numberHighlightedSections('**a** and **b**', { num_highlights: 2 }).pass,
    ).toBe(true);
  });

  it('fails wrong highlight count', () => {
    expect(
      numberHighlightedSections('**a** plain', { num_highlights: 2 }).pass,
    ).toBe(false);
  });
});

describe('detectable_format:multiple_sections', () => {
  it('passes enough sections', () => {
    expect(
      multipleSections('Section 1 x Section 2 y', {
        section_spliter: 'Section',
        num_sections: 2,
      }).pass,
    ).toBe(true);
  });

  it('fails too few sections', () => {
    expect(
      multipleSections('Section 1 only', {
        section_spliter: 'Section',
        num_sections: 2,
      }).pass,
    ).toBe(false);
  });
});

describe('detectable_format:json_format', () => {
  it('passes valid JSON', () => {
    expect(jsonFormat('{"a": 1}', {}).pass).toBe(true);
  });

  it('passes fenced JSON', () => {
    expect(jsonFormat('```json\n{"a": 1}\n```', {}).pass).toBe(true);
  });

  it('fails invalid JSON', () => {
    expect(jsonFormat('{not json}', {}).pass).toBe(false);
  });
});

describe('detectable_format:title', () => {
  it('passes <<title>>', () => {
    expect(title('<<My Title>> body', {}).pass).toBe(true);
  });

  it('fails without title markup', () => {
    expect(title('My Title body', {}).pass).toBe(false);
  });
});
