import { describe, expect, it } from 'vitest';
import { convertCsvImport } from './csvImport';

describe('convertCsvImport', () => {
  it('maps caller-selected columns and splits choices', () => {
    const text = 'qid,prompt,opts,answer\n1,"What is 2+2?","3|4|5",B\n';
    const { samples, warnings } = convertCsvImport(
      text,
      { id: 'qid', input: 'prompt', choices: 'opts', target: 'answer' },
      { packId: 'csv-pack' },
    );
    expect(warnings).toEqual([]);
    expect(samples).toEqual([
      { id: '1', input: 'What is 2+2?', choices: ['3', '4', '5'], target: 'B' },
    ]);
  });

  it('handles quoted fields with commas, quotes and newlines', () => {
    const text =
      'input,choices,target\n"Say ""hi"", ok?","a, b|c","C"\n"line1\nline2",,\n';
    const { samples } = convertCsvImport(
      text,
      { input: 'input', choices: 'choices', target: 'target' },
      { packId: 'csv-quoted' },
    );
    expect(samples).toHaveLength(2);
    expect(samples[0].input).toBe('Say "hi", ok?');
    expect(samples[0].choices).toEqual(['a, b', 'c']);
    expect(samples[0].target).toBe('C');
    expect(samples[1].input).toBe('line1\nline2');
    expect(samples[1].choices).toBeUndefined();
  });

  it('supports a custom delimiter and metadata columns', () => {
    const text = 'q,opts,meta_a,meta_b\n"pick one","x;y;z",math,hard\n';
    const { samples } = convertCsvImport(
      text,
      { input: 'q', choices: 'opts', metadata: ['meta_a', 'meta_b', 'missing-col'] },
      { packId: 'csv-meta', choicesDelimiter: ';' },
    );
    expect(samples[0].choices).toEqual(['x', 'y', 'z']);
    expect(samples[0].metadata).toEqual({ meta_a: 'math', meta_b: 'hard' });
  });

  it('throws when the required input column is missing', () => {
    expect(() =>
      convertCsvImport('a,b\n1,2\n', { input: 'nope' }, { packId: 'csv-bad' }),
    ).toThrow(/input column 'nope' not found/);
  });

  it('skips empty-input rows with warnings', () => {
    const text = 'input,target\n, A\nreal?,B\n';
    const { samples, warnings } = convertCsvImport(
      text,
      { input: 'input', target: 'target' },
      { packId: 'csv-skip' },
    );
    expect(samples).toHaveLength(1);
    expect(samples[0].id).toBe('row-3');
    expect(warnings.some((w) => w.includes('empty input'))).toBe(true);
  });
});
