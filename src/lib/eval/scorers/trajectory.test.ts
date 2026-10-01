import { describe, it, expect } from 'vitest';
import type { EvalPackManifest, EvalSample } from '../types';
import type { ScorerInput } from './types';
import { getScorer, registerScorer } from './index';
import { trajectoryScorer } from './trajectory';

registerScorer(trajectoryScorer);

const pack = { id: 'p' } as unknown as EvalPackManifest;
const ctx = { signal: new AbortController().signal };

function trajInput(
  trajectory: EvalSample['trajectory'],
  toolCalls: ScorerInput['toolCalls'],
): ScorerInput {
  return {
    sample: { id: 's', input: 'q', trajectory } as EvalSample,
    pack,
    outputText: 'out',
    toolCalls,
  };
}

const READ_MAIN = { name: 'read', arguments: { path: 'main.txt' } };
const READ_SRC = { name: 'read', arguments: { file_path: 'src/app.ts' } };
const WRITE_OUT = { name: 'write', arguments: { path: 'out.txt', content: 'x' } };
const SHELL = { name: 'shell', arguments: { command: 'ls' } };

describe('trajectory scorer', () => {
  it('is wired through the scorer registry', () => {
    expect(getScorer('trajectory')).toBe(trajectoryScorer);
  });

  it('checks mustCall with per-condition ratio', async () => {
    const full = await trajectoryScorer.score(
      trajInput({ mustCall: ['read', 'write'] }, [READ_MAIN, WRITE_OUT]),
      {},
      ctx,
    );
    expect(full).toMatchObject({ value: 1, verdict: 'correct' });
    const partial = await trajectoryScorer.score(
      trajInput({ mustCall: ['read', 'write'] }, [READ_MAIN]),
      {},
      ctx,
    );
    expect(partial).toMatchObject({ value: 0.5, verdict: 'incorrect' });
  });

  it('checks mustNotCall', async () => {
    const clean = await trajectoryScorer.score(
      trajInput({ mustNotCall: ['shell'] }, [READ_MAIN]),
      {},
      ctx,
    );
    expect(clean).toMatchObject({ value: 1, verdict: 'correct' });
    const violated = await trajectoryScorer.score(
      trajInput({ mustNotCall: ['shell', 'wiki'] }, [READ_MAIN, SHELL]),
      {},
      ctx,
    );
    expect(violated).toMatchObject({ value: 0.5, verdict: 'incorrect' });
  });

  it('checks maxCalls', async () => {
    const ok = await trajectoryScorer.score(
      trajInput({ maxCalls: 2 }, [READ_MAIN, WRITE_OUT]),
      {},
      ctx,
    );
    expect(ok).toMatchObject({ value: 1, verdict: 'correct' });
    const over = await trajectoryScorer.score(
      trajInput({ maxCalls: 1 }, [READ_MAIN, WRITE_OUT]),
      {},
      ctx,
    );
    expect(over).toMatchObject({ value: 0.5, verdict: 'incorrect' });
  });

  it('checks mustReadPaths including arg aliases and normalization', async () => {
    const ok = await trajectoryScorer.score(
      trajInput({ mustReadPaths: ['./main.txt', 'src/app.ts'] }, [READ_MAIN, READ_SRC]),
      {},
      ctx,
    );
    expect(ok).toMatchObject({ value: 1, verdict: 'correct' });
    const partial = await trajectoryScorer.score(
      trajInput({ mustReadPaths: ['main.txt', 'other.txt'] }, [READ_MAIN]),
      {},
      ctx,
    );
    expect(partial).toMatchObject({ value: 0.5, verdict: 'incorrect' });
  });

  it('does not count write paths as reads', async () => {
    const r = await trajectoryScorer.score(
      trajInput({ mustReadPaths: ['out.txt'] }, [WRITE_OUT]),
      {},
      ctx,
    );
    expect(r).toMatchObject({ value: 0, verdict: 'incorrect' });
  });

  it('averages multiple conditions', async () => {
    const r = await trajectoryScorer.score(
      trajInput({ mustCall: ['read'], mustNotCall: ['shell'], maxCalls: 5 }, [READ_MAIN]),
      {},
      ctx,
    );
    expect(r).toMatchObject({ value: 1, verdict: 'correct' });
    const mixed = await trajectoryScorer.score(
      trajInput({ mustCall: ['read', 'write'], maxCalls: 5 }, [READ_MAIN]),
      {},
      ctx,
    );
    expect(mixed.value).toBeCloseTo(0.75);
    expect(mixed.verdict).toBe('incorrect');
  });

  it('returns error without trajectory or with an empty spec', async () => {
    const missing = await trajectoryScorer.score(trajInput(undefined, []), {}, ctx);
    expect(missing.verdict).toBe('error');
    const empty = await trajectoryScorer.score(trajInput({}, []), {}, ctx);
    expect(empty.verdict).toBe('error');
  });
});
