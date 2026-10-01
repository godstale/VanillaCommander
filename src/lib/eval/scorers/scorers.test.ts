import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { EvalPackManifest, EvalSample, ScorerSpec } from '../types';
import type { ScorerInput } from './types';
import { combineCircular, combineSampleScore, getScorer } from './index';
import { exactScorer } from './exact';
import { includesScorer } from './includes';
import { regexScorer } from './regex';
import { choiceScorer } from './choice';
import { numericScorer, parseNumeric } from './numeric';
import { jsonSchemaScorer } from './jsonSchema';
import { toolCallAstScorer } from './toolCallAst';
import { noToolCallScorer } from './noToolCall';
import { vizBlockScorer } from './vizBlock';

vi.mock('mermaid', () => ({
  default: {
    parse: vi.fn(async (code: string) => {
      if (code.includes('INVALID')) throw new Error('Parse error on line 1: bad syntax');
      return true;
    }),
  },
}));

const pack = { id: 'p' } as unknown as EvalPackManifest;
const ctx = { signal: new AbortController().signal };

function input(sample: Partial<EvalSample> & { id: string }, outputText: string, toolCalls: ScorerInput['toolCalls'] = []): ScorerInput {
  return {
    sample: { input: 'q', ...sample } as EvalSample,
    pack,
    outputText,
    toolCalls,
  };
}

describe('exact', () => {
  it('matches with default normalization', async () => {
    const r = await exactScorer.score(input({ id: 's', target: 'Seoul' }, '  Seoul '), {}, ctx);
    expect(r.verdict).toBe('correct');
  });
  it('matches fullwidth and extra whitespace', async () => {
    const r = await exactScorer.score(input({ id: 's', target: 'ABC' }, 'ＡＢＣ'), {}, ctx);
    expect(r.verdict).toBe('correct');
  });
  it('rejects mismatch', async () => {
    const r = await exactScorer.score(input({ id: 's', target: 'Seoul' }, 'Busan'), {}, ctx);
    expect(r.verdict).toBe('incorrect');
  });
  it('matches any of multiple targets', async () => {
    const r = await exactScorer.score(input({ id: 's', target: ['a', 'b'] }, 'b'), {}, ctx);
    expect(r.verdict).toBe('correct');
  });
  it('case normalization is opt-in', async () => {
    const bad = await exactScorer.score(input({ id: 's', target: 'abc' }, 'ABC'), {}, ctx);
    expect(bad.verdict).toBe('incorrect');
    const good = await exactScorer.score(input({ id: 's', target: 'abc' }, 'ABC'), { normalize: ['trim', 'case'] }, ctx);
    expect(good.verdict).toBe('correct');
  });
});

describe('includes', () => {
  const opts = {};
  it('finds substring case-insensitively', async () => {
    const r = await includesScorer.score(input({ id: 's', target: 'Fortress' }, 'I like fortress app'), opts, ctx);
    expect(r.verdict).toBe('correct');
  });
  it('all mode requires every value', async () => {
    const r = await includesScorer.score(
      input({ id: 's' }, 'has one'),
      { mode: 'all', values: ['one', 'two'] }, ctx,
    );
    expect(r.verdict).toBe('incorrect');
  });
  it('any mode passes on one hit', async () => {
    const r = await includesScorer.score(
      input({ id: 's' }, 'has two'),
      { mode: 'any', values: ['one', 'two'] }, ctx,
    );
    expect(r.verdict).toBe('correct');
  });
  it('caseSensitive distinguishes', async () => {
    const r = await includesScorer.score(
      input({ id: 's' }, 'Fortress'),
      { caseSensitive: true, values: ['fortress'] }, ctx,
    );
    expect(r.verdict).toBe('incorrect');
  });
  it('korean keywords', async () => {
    const r = await includesScorer.score(
      input({ id: 's' }, '요약: 확정 일자 포함'),
      { values: ['확정', '일자'] }, ctx,
    );
    expect(r.verdict).toBe('correct');
  });
});

describe('regex', () => {
  it('matches and compares capture group to target', async () => {
    const r = await regexScorer.score(
      input({ id: 's', target: 'C' }, 'my pick is (C) done'),
      { pattern: '\\(([A-D])\\)', group: 1 }, ctx,
    );
    expect(r).toMatchObject({ verdict: 'correct', extracted: 'C' });
  });
  it('reports no match', async () => {
    const r = await regexScorer.score(input({ id: 's', target: '1' }, 'nothing'), { pattern: '\\d+' }, ctx);
    expect(r.verdict).toBe('incorrect');
  });
  it('compareTo none passes on match', async () => {
    const r = await regexScorer.score(input({ id: 's' }, 'SUMMARY.md created'), { pattern: 'SUMMARY\\.md', compareTo: 'none' }, ctx);
    expect(r.verdict).toBe('correct');
  });
  it('bad pattern is an error', async () => {
    const r = await regexScorer.score(input({ id: 's' }, 'x'), { pattern: '([' }, ctx);
    expect(r.verdict).toBe('error');
  });
  it('group mismatch is incorrect', async () => {
    const r = await regexScorer.score(
      input({ id: 's', target: 'B' }, 'answer (C)'),
      { pattern: '\\(([A-D])\\)', group: 1 }, ctx,
    );
    expect(r.verdict).toBe('incorrect');
  });
});

describe('choice', () => {
  it('extracts 정답: C', async () => {
    const r = await choiceScorer.score(
      input({ id: 's', target: 'C', choices: ['a', 'b', 'c', 'd'] }, '풀이...\n정답: C'), {}, ctx,
    );
    expect(r).toMatchObject({ verdict: 'correct', extracted: 'C' });
  });
  it('extracts (B) and ANSWER: D', async () => {
    const r1 = await choiceScorer.score(input({ id: 's', target: 'B' }, 'I choose (B)'), {}, ctx);
    expect(r1.verdict).toBe('correct');
    const r2 = await choiceScorer.score(input({ id: 's', target: 'D' }, 'blah\nANSWER: D'), {}, ctx);
    expect(r2.verdict).toBe('correct');
  });
  it('handles korean circled ③', async () => {
    const r = await choiceScorer.score(input({ id: 's', target: 'C' }, '정답: ③'), {}, ctx);
    expect(r.verdict).toBe('correct');
  });
  it('wrong letter is incorrect', async () => {
    const r = await choiceScorer.score(input({ id: 's', target: 'C' }, '정답: B'), {}, ctx);
    expect(r.verdict).toBe('incorrect');
  });
  it('no letter is no_answer', async () => {
    const r = await choiceScorer.score(input({ id: 's', target: 'C' }, '모르겠습니다'), {}, ctx);
    expect(r.verdict).toBe('no_answer');
  });
});

describe('numeric', () => {
  it('parses boxed and hash4', async () => {
    const r = await numericScorer.score(input({ id: 's', target: 42 }, 'result \\boxed{42}'), {}, ctx);
    expect(r.verdict).toBe('correct');
    const r2 = await numericScorer.score(input({ id: 's', target: 7 }, 'blah\n#### 7'), {}, ctx);
    expect(r2.verdict).toBe('correct');
  });
  it('handles 1,234.5 and fractions', async () => {
    expect(parseNumeric('1,234.5')).toBe(1234.5);
    expect(parseNumeric('3/4')).toBe(0.75);
    const r = await numericScorer.score(input({ id: 's', target: 0.75 }, '답: 3/4'), {}, ctx);
    expect(r.verdict).toBe('correct');
  });
  it('handles percents and tolerance', async () => {
    const r = await numericScorer.score(input({ id: 's', target: 0.5 }, '50%'), {}, ctx);
    expect(r.verdict).toBe('correct');
    const close = await numericScorer.score(input({ id: 's', target: 1 }, '1.0000001'), {}, ctx);
    expect(close.verdict).toBe('correct');
  });
  it('wrong number is incorrect', async () => {
    const r = await numericScorer.score(input({ id: 's', target: 5 }, '정답: 6'), {}, ctx);
    expect(r.verdict).toBe('incorrect');
  });
  it('no number is no_answer', async () => {
    const r = await numericScorer.score(input({ id: 's', target: 5 }, '모름'), {}, ctx);
    expect(r.verdict).toBe('no_answer');
  });
});

describe('json_schema', () => {
  const schema = {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' }, age: { type: 'number' } },
  };
  it('validates fenced JSON', async () => {
    const r = await jsonSchemaScorer.score(
      input({ id: 's' }, 'here:\n```json\n{"name": "a", "age": 3}\n```'), { schema }, ctx,
    );
    expect(r.verdict).toBe('correct');
  });
  it('rejects missing required', async () => {
    const r = await jsonSchemaScorer.score(input({ id: 's' }, '{"age": 3}'), { schema }, ctx);
    expect(r.verdict).toBe('incorrect');
  });
  it('rejects bad pattern type', async () => {
    const r = await jsonSchemaScorer.score(
      input({ id: 's' }, '{"name": "a1"}'),
      { schema: { type: 'object', properties: { name: { type: 'string', pattern: '^[a-z]+$' } } } }, ctx,
    );
    expect(r.verdict).toBe('incorrect');
  });
  it('finds first object without fence', async () => {
    const r = await jsonSchemaScorer.score(
      input({ id: 's' }, 'prefix {"name": "x"} suffix'), { schema, extract: 'first_object' }, ctx,
    );
    expect(r.verdict).toBe('correct');
  });
  it('reports no JSON', async () => {
    const r = await jsonSchemaScorer.score(input({ id: 's' }, 'plain text'), { schema }, ctx);
    expect(r.verdict).toBe('incorrect');
  });
});

describe('tool_call_ast', () => {
  const sample = {
    id: 's',
    expectedToolCalls: [
      { name: 'read', args: { path: ['src/a.ts', './src/a.ts'] } },
    ],
  };
  it('matches path variants', async () => {
    const r = await toolCallAstScorer.score(
      input(sample, '', [{ name: 'read', arguments: { path: './src/a.ts' } }]), {}, ctx,
    );
    expect(r.verdict).toBe('correct');
  });
  it('matches parallel calls regardless of order', async () => {
    const multi = {
      id: 's',
      expectedToolCalls: [
        { name: 'read', args: { path: ['a'] } },
        { name: 'read', args: { path: ['b'] } },
      ],
    };
    const r = await toolCallAstScorer.score(
      input(multi, '', [
        { name: 'read', arguments: { path: 'b' } },
        { name: 'read', arguments: { path: 'a' } },
      ]), {}, ctx,
    );
    expect(r.verdict).toBe('correct');
  });
  it('rejects hallucinated args', async () => {
    const r = await toolCallAstScorer.score(
      input(sample, '', [{ name: 'read', arguments: { path: 'src/a.ts', extra: 1 } }]), {}, ctx,
    );
    expect(r.verdict).toBe('incorrect');
  });
  it('rejects wrong count unless allowed', async () => {
    const calls = [
      { name: 'read', arguments: { path: 'src/a.ts' } },
      { name: 'ls', arguments: { path: '.' } },
    ];
    const strict = await toolCallAstScorer.score(input(sample, '', calls), {}, ctx);
    expect(strict.verdict).toBe('incorrect');
    const loose = await toolCallAstScorer.score(
      input(
        { id: 's', expectedToolCalls: [{ name: 'read', args: { path: ['src/a.ts'] }, optionalArgs: [] }] },
        '', calls,
      ),
      { allowExtraCalls: true }, ctx,
    );
    expect(loose.verdict).toBe('correct');
  });
  it('compares numbers and regex-ish patterns loosely', async () => {
    const s = {
      id: 's',
      expectedToolCalls: [
        { name: 'grep', args: { pattern: ['TODO', 'TODO:', '\\bTODO\\b'], path: ['.'] } },
      ],
    };
    const r = await toolCallAstScorer.score(
      input(s, '', [{ name: 'grep', arguments: { pattern: 'todo', path: '.' } }]), {}, ctx,
    );
    expect(r.verdict).toBe('correct');
  });
});

describe('no_tool_call', () => {
  it('passes with text and no calls', async () => {
    const r = await noToolCallScorer.score(input({ id: 's' }, 'hello'), {}, ctx);
    expect(r.verdict).toBe('correct');
  });
  it('fails when tools called', async () => {
    const r = await noToolCallScorer.score(
      input({ id: 's' }, 'x', [{ name: 'read', arguments: {} }]), {}, ctx,
    );
    expect(r.verdict).toBe('incorrect');
  });
  it('fails on empty text by default', async () => {
    const r = await noToolCallScorer.score(input({ id: 's' }, '  '), {}, ctx);
    expect(r.verdict).toBe('incorrect');
  });
  it('allows empty text when requireText=false', async () => {
    const r = await noToolCallScorer.score(input({ id: 's' }, ''), { requireText: false }, ctx);
    expect(r.verdict).toBe('correct');
  });
  it('korean refusal passes', async () => {
    const r = await noToolCallScorer.score(input({ id: 's' }, '지원하지 않는 기능입니다'), {}, ctx);
    expect(r.verdict).toBe('correct');
  });
});

describe('viz_block', () => {
  beforeEach(() => vi.clearAllMocks());
  it('validates mermaid blocks', async () => {
    const r = await vizBlockScorer.score(
      input({ id: 's' }, '```mermaid\nflowchart TD\n A-->B\n```'), { kind: 'mermaid' }, ctx,
    );
    expect(r.verdict).toBe('correct');
  });
  it('rejects broken mermaid with first-line error', async () => {
    const r = await vizBlockScorer.score(
      input({ id: 's' }, '```mermaid\nINVALID SYNTAX\n```'), { kind: 'mermaid' }, ctx,
    );
    expect(r.verdict).toBe('incorrect');
    expect(r.reason).toContain('line 1');
  });
  it('validates recharts DSL', async () => {
    const r = await vizBlockScorer.score(
      input(
        { id: 's' },
        '```recharts\n{"type":"bar","title":"t","xKey":"m","data":[{"m":"a","v":1}],"series":[{"key":"v","label":"V"}]}\n```',
      ),
      { kind: 'recharts' }, ctx,
    );
    expect(r.verdict).toBe('correct');
  });
  it('rejects invalid recharts DSL', async () => {
    const r = await vizBlockScorer.score(
      input({ id: 's' }, '```recharts\n{"type":"nonsense"}\n```'), { kind: 'recharts' }, ctx,
    );
    expect(r.verdict).toBe('incorrect');
  });
  it('enforces minBlocks', async () => {
    const r = await vizBlockScorer.score(input({ id: 's' }, 'no blocks'), {}, ctx);
    expect(r.verdict).toBe('incorrect');
  });
});

describe('combine', () => {
  const spec = (over: Partial<ScorerSpec> = {}): ScorerSpec => ({
    type: 'exact', weight: 1, gate: false, options: {}, ...over,
  });
  it('gate failure zeroes the sample', () => {
    const out = combineSampleScore([
      { spec: spec({ gate: true }), result: { value: 0, verdict: 'incorrect', reason: 'x' } },
      { spec: spec({ weight: 0.3 }), result: { value: 1, verdict: 'correct', reason: 'y' } },
    ]);
    expect(out).toEqual({ value: 0, verdict: 'incorrect' });
  });
  it('computes weighted mean and partial verdict', () => {
    const out = combineSampleScore([
      { spec: spec(), result: { value: 1, verdict: 'correct', reason: 'x' } },
      { spec: spec({ weight: 0.3 }), result: { value: 0, verdict: 'incorrect', reason: 'y' } },
    ]);
    expect(out.value).toBeCloseTo(1 / 1.3);
    expect(out.verdict).toBe('partial');
  });
  it('maps no_answer when all zero with a no_answer', () => {
    const out = combineSampleScore([
      { spec: spec(), result: { value: 0, verdict: 'no_answer', reason: 'x' } },
    ]);
    expect(out.verdict).toBe('no_answer');
  });
  it('applies threshold to continuous scores', () => {
    const out = combineSampleScore([
      { spec: spec({ threshold: 0.5 }), result: { value: 0.8, verdict: 'partial', reason: 'x' } },
    ]);
    expect(out.verdict).toBe('correct');
  });
  it('circular requires all rotations', () => {
    const ok = combineCircular([
      { value: 1, verdict: 'correct', reason: '' },
      { value: 1, verdict: 'correct', reason: '' },
    ]);
    expect(ok.verdict).toBe('correct');
    const bad = combineCircular([
      { value: 1, verdict: 'correct', reason: '' },
      { value: 0, verdict: 'incorrect', reason: '' },
    ]);
    expect(bad.verdict).toBe('incorrect');
  });
});

describe('registry', () => {
  it('resolves registered scorers and rejects unknown', () => {
    expect(getScorer('exact')).toBe(exactScorer);
    expect(getScorer('tool_call_ast')).toBe(toolCallAstScorer);
    expect(() => getScorer('nonexistent')).toThrow();
  });
});
