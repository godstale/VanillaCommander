import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvalPackManifest, EvalSample } from '../types';
import type { ScorerInput } from './types';
import { getScorer } from './index';
import {
  analyzeChoicePosition,
  buildChoiceProbeMessages,
  choiceLogprobScorer,
  registerChoiceLogprobScorer,
  requestChoiceProbe,
} from './choiceLogprob';
import type { LogprobTrace } from '../logprobs/client';

const pack = { id: 'p' } as unknown as EvalPackManifest;
const ctx = { signal: new AbortController().signal };

function input(
  sample: Partial<EvalSample> & { id: string },
  extra?: Record<string, unknown>,
): ScorerInput {
  return {
    sample: { input: 'q', ...sample } as EvalSample,
    pack,
    outputText: '',
    toolCalls: [],
    extra,
  };
}

function variantTrace(top: Array<{ token: string; logprob: number }>): LogprobTrace {
  return {
    tokens: ['', ' ', 'B'],
    topLogprobs: [
      [{ token: '', logprob: 0 }],
      [{ token: ' ', logprob: 0 }],
      top,
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('analyzeChoicePosition', () => {
  it('sums variants and renormalizes at the first non-blank position', () => {
    // P(A) ~ 0.4+0.2+0.05=0.65, P(B) ~ 0.3, total 0.95.
    const a = analyzeChoicePosition(
      variantTrace([
        { token: ' A', logprob: Math.log(0.4) },
        { token: 'B', logprob: Math.log(0.3) },
        { token: '(A', logprob: Math.log(0.2) },
        { token: 'A', logprob: Math.log(0.05) },
      ]),
      'AB',
    );
    expect(a?.position).toBe(2);
    expect(a?.argmax).toBe('A');
    const pa = a?.probabilities.find((p) => p.letter === 'A')?.prob ?? NaN;
    const pb = a?.probabilities.find((p) => p.letter === 'B')?.prob ?? NaN;
    expect(pa).toBeCloseTo(0.65 / 0.95, 10);
    expect(pb).toBeCloseTo(0.3 / 0.95, 10);
    expect(pa + pb).toBeCloseTo(1, 10);
  });
  it('returns null when no variant is present', () => {
    expect(
      analyzeChoicePosition(variantTrace([{ token: 'The', logprob: 0 }]), 'AB'),
    ).toBeNull();
    expect(
      analyzeChoicePosition({ tokens: ['  '], topLogprobs: [[{ token: ' ', logprob: 0 }]] }, 'AB'),
    ).toBeNull();
  });
});

describe('choiceLogprobScorer', () => {
  const top = [
    { token: ' A', logprob: Math.log(0.4) },
    { token: 'B', logprob: Math.log(0.3) },
    { token: '(A', logprob: Math.log(0.2) },
    { token: 'A', logprob: Math.log(0.05) },
  ];
  const sample = { id: 's', target: 'A', choices: ['a1', 'a2'] };

  it('value = P(correct), correct iff argmax == target', async () => {
    const good = await choiceLogprobScorer.score(
      input(sample, { logprobTrace: variantTrace(top) }), { mode: 'prob' }, ctx,
    );
    expect(good.verdict).toBe('correct');
    expect(good.value).toBeCloseTo(0.65 / 0.95, 6);
    expect(good.extracted).toBe('A');

    const bad = await choiceLogprobScorer.score(
      input({ ...sample, target: 'B' }, { logprobTrace: variantTrace(top) }), {}, ctx,
    );
    expect(bad.verdict).toBe('incorrect');
    expect(bad.value).toBeCloseTo(0.3 / 0.95, 6);
    expect(bad.extracted).toBe('A');
  });
  it('no variant present yields no_answer', async () => {
    const r = await choiceLogprobScorer.score(
      input(sample, { logprobTrace: variantTrace([{ token: 'The', logprob: 0 }]) }), {}, ctx,
    );
    expect(r.verdict).toBe('no_answer');
    expect(r.value).toBe(0);
  });
  it('unsupported flag maps to skipped (N/A)', async () => {
    const r = await choiceLogprobScorer.score(
      input(sample, { logprobUnsupported: true }), {}, ctx,
    );
    expect(r).toMatchObject({ value: 0, verdict: 'skipped' });
  });
  it('missing trace without probe info is an error', async () => {
    const r = await choiceLogprobScorer.score(input(sample, {}), {}, ctx);
    expect(r.verdict).toBe('error');
  });
  it('rejects unknown mode', async () => {
    await expect(
      choiceLogprobScorer.score(input(sample, {}), { mode: 'foo' }, ctx),
    ).rejects.toThrow();
  });
  it('registers under choice_logprob with requiresAsync', () => {
    registerChoiceLogprobScorer();
    expect(getScorer('choice_logprob')).toBe(choiceLogprobScorer);
    expect(choiceLogprobScorer.requiresAsync).toBe(true);
  });
});

describe('choice probe', () => {
  it('appends the answer-letter instruction to the last message', () => {
    const out = buildChoiceProbeMessages([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Q?' },
    ]);
    expect(out[0].content).toBe('sys');
    expect(out[1].content).toContain('Q?');
    expect(out[1].content).toContain('answer letter');
  });
  it('probes with num_predict 3 and maps missing fields to unsupported', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ message: { content: 'A' } }),
      text: async () => '{}',
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    await expect(
      requestChoiceProbe({ model: 'm', messages: [{ role: 'user', content: 'Q?' }] }),
    ).rejects.toThrow('logprobs unsupported');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect((body['options'] as Record<string, unknown>)['num_predict']).toBe(3);
    expect(body['logprobs']).toBe(true);
  });
});
