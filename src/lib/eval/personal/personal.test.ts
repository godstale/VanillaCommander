import { describe, expect, it } from 'vitest';
import {
  buildFixtureWhitelist,
  createPersonalManifest,
  draftSampleId,
  maskSecrets,
  messageToSample,
  samplesToJsonl,
} from './caseBuilder';
import { EvalSampleSchema } from '../types';

describe('messageToSample', () => {
  const messages = [
    { role: 'user' as const, content: 'What is 2+2?' },
    { role: 'assistant' as const, content: '4' },
  ];

  it('derives input/answer from history in reference mode', () => {
    const s = messageToSample({ id: 's1', messages, mode: 'reference' });
    expect(s.input).toEqual(messages);
    expect(s.reference).toBe('4');
    expect(s.scorers?.map((x) => x.type)).toContain('exact');
    expect(s.tags).toContain('personal');
    expect(EvalSampleSchema.safeParse(s).success).toBe(true);
  });

  it('maps keywords to an includes scorer in rules mode', () => {
    const s = messageToSample({ id: 's2', messages, mode: 'rules', keywords: ['4', 'four'] });
    expect(s.target).toEqual(['4', 'four']);
    expect(s.scorers?.[0].type).toBe('includes');
    expect(EvalSampleSchema.safeParse(s).success).toBe(true);
  });

  it('maps rubric text to an llm_judge_rubric scorer', () => {
    const s = messageToSample({ id: 's3', messages, mode: 'rubric', rubric: 'Be concise.' });
    expect(s.rubric).toBe('Be concise.');
    expect(s.scorers?.[0].type).toBe('llm_judge_rubric');
    expect(EvalSampleSchema.safeParse(s).success).toBe(true);
  });

  it('adds json_schema / viz_block scorers for structured formats', () => {
    const j = messageToSample({ id: 'j', messages, mode: 'reference', format: 'json' });
    expect(j.scorers?.map((x) => x.type)).toContain('json_schema');
    const v = messageToSample({ id: 'v', messages, mode: 'reference', format: 'viz' });
    expect(v.scorers?.map((x) => x.type)).toContain('viz_block');
  });

  it('rejects empty input and missing mode params', () => {
    expect(() => messageToSample({ id: 'x', messages: [], mode: 'reference' })).toThrow();
    expect(() => messageToSample({ id: 'x', messages, mode: 'rules' })).toThrow();
    expect(() => messageToSample({ id: 'x', messages, mode: 'rubric', rubric: '  ' })).toThrow();
  });

  it('accepts explicit input/answer overrides', () => {
    const s = messageToSample({ id: 'o', messages: [], input: 'Q?', answer: 'A.', mode: 'reference' });
    expect(s.input).toBe('Q?');
    expect(s.reference).toBe('A.');
  });
});

describe('maskSecrets', () => {
  it('redacts sk- keys, bearer tokens, github tokens, AWS keys', () => {
    const text = 'key sk-abc123XYZ456 here, Bearer mytoken123456, ghp_abcdefgh12345678, AKIAIOSFODNN7EXAMPLE';
    const { text: out, redacted } = maskSecrets(text);
    expect(redacted).toBe(true);
    expect(out).not.toContain('sk-abc123XYZ456');
    expect(out).not.toContain('ghp_abcdefgh12345678');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts .env-style KEY=VALUE lines with secret names', () => {
    const { text: out, redacted } = maskSecrets('HOST=example.com\nOPENAI_API_KEY=sk-xyz123456789\nPORT=3000');
    expect(redacted).toBe(true);
    expect(out).toContain('HOST=example.com');
    expect(out).toContain('PORT=3000');
    expect(out).not.toContain('sk-xyz123456789');
  });

  it('leaves clean text untouched', () => {
    const { text: out, redacted } = maskSecrets('Hello, what is 2+2?');
    expect(redacted).toBe(false);
    expect(out).toBe('Hello, what is 2+2?');
  });
});

describe('buildFixtureWhitelist', () => {
  it('drops secret filenames, ignored dirs, and >1MB files', () => {
    const { kept, dropped } = buildFixtureWhitelist([
      { path: 'src/app.ts', size: 100 },
      { path: '.env', size: 10 },
      { path: 'config/credentials.json', size: 10 },
      { path: 'certs/server.pem', size: 10 },
      { path: 'node_modules/foo/index.js', size: 10 },
      { path: '.git/config', size: 10 },
      { path: 'assets/big.bin', size: 2 * 1024 * 1024 },
      { path: 'notes/todo.md' },
    ]);
    expect(kept.map((k) => k.path)).toEqual(['src/app.ts', 'notes/todo.md']);
    expect(dropped.map((d) => d.reason)).toContain('secret-filename');
    expect(dropped.map((d) => d.reason)).toContain('ignored-pattern');
    expect(dropped.map((d) => d.reason)).toContain('over-1mb');
  });
});

describe('createPersonalManifest', () => {
  it('applies personal defaults (Q9, personal license, untrusted)', () => {
    const m = createPersonalManifest({ id: 'my-cases', titleKo: '내 케이스', titleEn: 'My cases' });
    expect(m.category).toBe('Q9');
    expect(m.license).toEqual({ id: 'personal' });
    expect(m.trusted).toBe(false);
    expect(m.source).toEqual({ type: 'jsonl', file: 'samples.jsonl' });
  });

  it('tags fixture data class when requested', () => {
    const m = createPersonalManifest({ id: 'f', titleKo: 't', titleEn: 't', withFixtures: true });
    expect((m as unknown as { 'x-fortress': { dataClass: string[] } })['x-fortress'].dataClass)
      .toEqual(['personal', 'fixture-files']);
  });
});

describe('samplesToJsonl / draftSampleId', () => {
  it('round-trips through the sample schema', () => {
    const s = messageToSample({
      id: draftSampleId('What is 2+2?', 0),
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      mode: 'reference',
    });
    const lines = samplesToJsonl([s]).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(EvalSampleSchema.safeParse(JSON.parse(lines[0])).success).toBe(true);
  });

  it('emits empty string for no samples', () => {
    expect(samplesToJsonl([])).toBe('');
  });
});
