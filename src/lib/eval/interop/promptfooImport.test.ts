import { describe, expect, it } from 'vitest';
import { convertPromptfoo, parseSubsetYaml, PromptfooYamlError } from './promptfooImport';

const MULTI_ASSERT = `prompts:
  - "Summarize {{topic}} in one sentence."
tests:
  - vars:
      topic: cats
    assert:
      - type: equals
        value: Cats are great.
      - type: icontains
        value: cats
      - type: regex
        value: "^Cats"
  - vars:
      topic: dogs
    assert:
      - type: is-json
      - type: llm-rubric
        value: Award full marks for accuracy.
      - type: javascript
        value: output.length > 10
      - type: python
        value: "assert True"
`;

describe('convertPromptfoo', () => {
  it('maps multi-assert tests to scorers with template substitution', () => {
    const { manifest, samples, scorers, warnings } = convertPromptfoo(MULTI_ASSERT, {
      packId: 'pf-pack',
    });
    expect(samples).toHaveLength(2);
    expect(samples[0].input).toBe('Summarize cats in one sentence.');
    expect(samples[0].target).toBe('Cats are great.');
    expect(samples[1].input).toBe('Summarize dogs in one sentence.');
    expect(samples[1].rubric).toBe('Award full marks for accuracy.');
    const types = scorers.map((s) => s.type).sort();
    expect(types).toEqual(['exact', 'includes', 'json_schema', 'llm_judge_rubric', 'regex']);
    expect(manifest.scorers.map((s) => s.type).sort()).toEqual(types);
    expect(samples[0].scorers?.map((s) => s.type).sort()).toEqual(['exact', 'includes', 'regex']);
    expect(warnings.filter((w) => w.includes('unsupported'))).toHaveLength(2);
  });

  it('maps contains-json and contains with case sensitivity', () => {
    const text = `tests:
  - vars:
      q: hi
    assert:
      - type: contains
        value: Hello
      - type: contains-json
        value:
          type: object
`;
    const { scorers } = convertPromptfoo(text, { packId: 'pf-c' });
    const includes = scorers.find((s) => s.type === 'includes');
    expect(includes?.options).toMatchObject({ caseSensitive: true, values: ['Hello'] });
    const json = scorers.find((s) => s.type === 'json_schema');
    expect(json?.options).toMatchObject({ schema: { type: 'object' } });
  });

  it('throws when tests list is missing', () => {
    expect(() => convertPromptfoo('prompts:\n  - hi\n', { packId: 'pf-x' })).toThrow(
      /top-level `tests` list/,
    );
  });

  it('throws a clear error outside the YAML subset', () => {
    expect(() =>
      parseSubsetYaml('tests:\n\t- vars:\n      a: 1\n'),
    ).toThrow(PromptfooYamlError);
    expect(() =>
      parseSubsetYaml('tests:\n  - prompt: |\n      multiline\n'),
    ).toThrow(/block scalars/);
    expect(() =>
      parseSubsetYaml('tests:\n   - vars:\n       a: 1\n'),
    ).toThrow(/multiple of 2/);
    expect(() =>
      parseSubsetYaml('tests:\n  - vars: &anchor\n      a: 1\n'),
    ).toThrow(/anchors/);
    expect(() =>
      parseSubsetYaml('tests:\n  - {vars: x}\n'),
    ).toThrow(/flow maps/);
  });

  it('parses quoted scalars, numbers, booleans and inline lists', () => {
    const doc = parseSubsetYaml(
      'name: "a: b"\ncount: 3\nflag: true\nmissing: null\ntags: [x, "y, z"]\n',
    );
    expect(doc).toEqual({
      name: 'a: b',
      count: 3,
      flag: true,
      missing: null,
      tags: ['x', 'y, z'],
    });
  });
});
