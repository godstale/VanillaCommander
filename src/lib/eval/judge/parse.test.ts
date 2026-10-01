import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  PairwiseVerdictSchema,
  RubricVerdictSchema,
  extractFirstJsonObject,
  parseJudgeOutputWithRetry,
  stripCodeFences,
} from './parse';
import { buildPairwisePrompt, buildRubricPrompt, JUDGE_PROMPT_VERSION } from './prompts';

describe('stripCodeFences', () => {
  it('unwraps json fences', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('leaves plain text alone', () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe('extractFirstJsonObject', () => {
  it('skips prose and picks the first balanced object', () => {
    const raw = 'Sure! Here is my verdict: {"winner":"A","reason":"better {nested} yes"} trailing {oops';
    expect(extractFirstJsonObject(raw)).toBe('{"winner":"A","reason":"better {nested} yes"}');
  });
  it('returns null when unbalanced', () => {
    expect(extractFirstJsonObject('no braces here')).toBeNull();
    expect(extractFirstJsonObject('{"open": true')).toBeNull();
  });
  it('respects braces inside strings', () => {
    expect(extractFirstJsonObject('{"a": "{ not a brace }"}')).toBe('{"a": "{ not a brace }"}');
  });
});

describe('parseJudgeOutputWithRetry', () => {
  it('parses a fenced rubric verdict directly', async () => {
    const raw = '```json\n{"criteria":[{"name":"acc","score":4,"reason":"ok"}],"overall":4}\n```';
    const res = await parseJudgeOutputWithRetry(raw, RubricVerdictSchema, async () => {
      throw new Error('reask should not run');
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.overall).toBe(4);
  });

  it('recovers via one JSON-only re-ask', async () => {
    const calls: string[] = [];
    const res = await parseJudgeOutputWithRetry('I think A wins, definitely!', PairwiseVerdictSchema, async () => {
      calls.push('reask');
      return '{"winner":"A","reason":"clearer"}';
    });
    expect(calls).toHaveLength(1);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.winner).toBe('A');
  });

  it('fails after the retry also misses', async () => {
    const res = await parseJudgeOutputWithRetry('garbage one', PairwiseVerdictSchema, async () => 'garbage two');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('no-json-object');
  });

  it('rejects schema mismatches', async () => {
    const res = await parseJudgeOutputWithRetry(
      '{"winner":"C","reason":"x"}',
      PairwiseVerdictSchema,
      async () => '{"winner":"C","reason":"x"}',
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('schema-mismatch');
  });

  it('surfaces re-ask transport errors', async () => {
    const res = await parseJudgeOutputWithRetry('junk', z.object({}), async () => {
      throw new Error('network down');
    });
    expect(res.ok).toBe(false);
  });
});

describe('prompts', () => {
  it('re-exports the canonical prompt version', () => {
    expect(JUDGE_PROMPT_VERSION).toBe('judge-v1');
  });

  it('rubric prompt carries scale, rubric, and length instruction', () => {
    const prompt = buildRubricPrompt({
      question: 'q?',
      reference: 'ref',
      rubric: 'Be accurate.',
      scale: '1-5',
    });
    expect(prompt).toContain('Be accurate.');
    expect(prompt).toContain('1-5');
    expect(prompt).toContain('do not reward length');
    expect(prompt).toContain('overall');
    expect(prompt).toContain('Reference answer:\nref');
  });

  it('rubric prompt omits the reference section when absent', () => {
    const prompt = buildRubricPrompt({ question: 'q?', rubric: 'r', scale: '1-10' });
    expect(prompt).not.toContain('Reference answer');
    expect(prompt).toContain('1-10');
  });

  it('pairwise prompt carries both answers and the tie option', () => {
    const prompt = buildPairwisePrompt({ question: 'q?', answerA: 'aaa', answerB: 'bbb' });
    expect(prompt).toContain('Answer A:\naaa');
    expect(prompt).toContain('Answer B:\nbbb');
    expect(prompt).toContain('"tie"');
    expect(prompt).toContain('do not reward length');
  });
});
