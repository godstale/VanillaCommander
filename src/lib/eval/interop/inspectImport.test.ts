import { describe, expect, it } from 'vitest';
import { convertInspectJsonl } from './inspectImport';

describe('convertInspectJsonl', () => {
  it('maps Inspect-style fields directly', () => {
    const text = [
      JSON.stringify({
        id: 's1',
        input: 'What is 2+2?',
        choices: ['3', '4', '5'],
        target: 'B',
        metadata: { subject: 'math', difficulty: 1, verified: true },
      }),
    ].join('\n');
    const { manifest, samples, warnings } = convertInspectJsonl(text, { packId: 'imp-test' });
    expect(warnings).toEqual([]);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      id: 's1',
      input: 'What is 2+2?',
      choices: ['3', '4', '5'],
      target: 'B',
      metadata: { subject: 'math', difficulty: 1, verified: true },
    });
    expect(manifest.id).toBe('imp-test');
    expect(manifest.trusted).toBe(false);
    expect(manifest.category).toBe('Q9');
  });

  it('maps OpenAI-evals messages[]/ideal', () => {
    const text = JSON.stringify({
      messages: [
        { role: 'system', content: 'Answer briefly.' },
        { role: 'user', content: 'Capital of France?' },
      ],
      ideal: 'Paris',
    });
    const { samples, warnings } = convertInspectJsonl(text, { packId: 'imp-evals' });
    expect(warnings).toEqual([]);
    expect(samples).toHaveLength(1);
    expect(samples[0].input).toEqual([
      { role: 'system', content: 'Answer briefly.' },
      { role: 'user', content: 'Capital of France?' },
    ]);
    expect(samples[0].target).toBe('Paris');
    expect(samples[0].id).toBe('line-1');
  });

  it('skips bad rows with warnings and keeps good ones', () => {
    const text = [
      '{"id": "ok", "input": "q?"}',
      'not json at all',
      '{"id": "no-input", "target": "x"}',
      '["array", "not", "object"]',
      JSON.stringify({ id: 'badmsg', messages: [{ role: 'user' }] }),
      JSON.stringify({ id: 'meta', input: 'q', metadata: { ok: 'yes', nested: { a: 1 } }, choices: [1, 'b'] }),
    ].join('\n');
    const { samples, warnings } = convertInspectJsonl(text, { packId: 'imp-warn' });
    expect(samples.map((s) => s.id)).toEqual(['ok', 'meta']);
    const meta = samples.find((s) => s.id === 'meta');
    expect(meta?.metadata).toEqual({ ok: 'yes' });
    expect(meta?.choices).toEqual(['1', 'b']);
    expect(warnings.length).toBeGreaterThanOrEqual(5);
    expect(warnings.some((w) => w.includes('line 2'))).toBe(true);
  });

  it('keeps array targets and numeric targets', () => {
    const text = [
      JSON.stringify({ id: 'a', input: 'q', target: ['x', 'y'] }),
      JSON.stringify({ id: 'b', input: 'q', target: 42 }),
    ].join('\n');
    const { samples } = convertInspectJsonl(text, { packId: 'imp-t' });
    expect(samples[0].target).toEqual(['x', 'y']);
    expect(samples[1].target).toBe(42);
  });
});
