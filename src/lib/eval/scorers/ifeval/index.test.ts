import { describe, expect, it } from 'vitest';
import type { EvalSample } from '../../types';
import {
  buildLooseVariants,
  ifevalScorer,
  scoreIfevalSample,
} from './index';

function sampleWith(
  ifeval: NonNullable<EvalSample['ifeval']>,
): EvalSample {
  return { id: 's1', input: 'prompt', ifeval };
}

describe('buildLooseVariants', () => {
  it('builds 8 variants', () => {
    expect(buildLooseVariants('a\nb\nc')).toHaveLength(8);
  });
});

describe('ifevalScorer', () => {
  it('scores all-pass as correct with value 1', async () => {
    const result = await scoreIfevalSample(
      {
        sample: sampleWith([
          { id: 'punctuation:no_comma', kwargs: {} },
          { id: 'startend:quotation', kwargs: {} },
        ]),
        outputText: '"hello world"',
      },
      { mode: 'strict' },
    );
    expect(result.value).toBe(1);
    expect(result.verdict).toBe('correct');
    const extracted = JSON.parse(result.extracted ?? '{}') as {
      promptLevelPass: boolean;
    };
    expect(extracted.promptLevelPass).toBe(true);
  });

  it('scores partial pass with ratio value', async () => {
    const result = await scoreIfevalSample(
      {
        sample: sampleWith([
          { id: 'punctuation:no_comma', kwargs: {} },
          { id: 'startend:quotation', kwargs: {} },
        ]),
        outputText: '"hello, world"',
      },
      { mode: 'strict' },
    );
    expect(result.value).toBe(0.5);
    expect(result.verdict).toBe('partial');
    const extracted = JSON.parse(result.extracted ?? '{}') as {
      promptLevelPass: boolean;
    };
    expect(extracted.promptLevelPass).toBe(false);
  });

  it('scores all-fail as incorrect with value 0', async () => {
    const result = await scoreIfevalSample(
      {
        sample: sampleWith([{ id: 'punctuation:no_comma', kwargs: {} }]),
        outputText: 'a, b',
      },
      {},
    );
    expect(result.value).toBe(0);
    expect(result.verdict).toBe('incorrect');
  });

  it('skips samples without ifeval instructions', async () => {
    const result = await scoreIfevalSample(
      { sample: { id: 's1', input: 'prompt' }, outputText: 'text' },
      {},
    );
    expect(result.verdict).toBe('skipped');
  });

  it('fails unknown checker ids', async () => {
    const result = await scoreIfevalSample(
      {
        sample: sampleWith([{ id: 'nope:missing', kwargs: {} }]),
        outputText: 'text',
      },
      {},
    );
    expect(result.value).toBe(0);
    expect(result.verdict).toBe('incorrect');
  });

  it('strict fails but loose passes via line stripping', async () => {
    const sample = sampleWith([
      { id: 'startend:end_checker', kwargs: { end_phrase: 'yes' } },
    ]);
    const outputText = 'answer: yes\nThanks!';
    const strict = await scoreIfevalSample(
      { sample, outputText },
      { mode: 'strict' },
    );
    expect(strict.verdict).toBe('incorrect');
    const loose = await scoreIfevalSample(
      { sample, outputText },
      { mode: 'loose' },
    );
    expect(loose.verdict).toBe('correct');
  });

  it('exposes type ifeval and defaults mode to strict', async () => {
    expect(ifevalScorer.type).toBe('ifeval');
    const parsed = ifevalScorer.optionsSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.mode).toBe('strict');
    }
  });
});
