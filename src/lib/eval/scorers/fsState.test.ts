import { describe, it, expect } from 'vitest';
import type { EvalPackManifest, EvalSample } from '../types';
import type { ScorerInput } from './types';
import { getScorer, registerScorer } from './index';
import { fsStateScorer, matchFsGlob } from './fsState';
import { trajectoryScorer } from './trajectory';

registerScorer(fsStateScorer);
registerScorer(trajectoryScorer);

const pack = { id: 'p' } as unknown as EvalPackManifest;
const ctx = { signal: new AbortController().signal };

function fsInput(
  expectState: EvalSample['expectState'],
  files: Array<{ path: string; hash: string; content?: string }>,
  extra?: unknown,
): ScorerInput {
  return {
    sample: { id: 's', input: 'q', expectState } as EvalSample,
    pack,
    outputText: 'out',
    toolCalls: [],
    finalState: { files: files.map((f) => ({ ...f, size: f.content?.length ?? 0 })) },
    extra: extra as Record<string, unknown> | undefined,
  };
}

const INIT = {
  initialState: {
    files: [
      { path: 'main.txt', hash: 'h1', content: 'hello\n' },
      { path: 'keep/a.txt', hash: 'h2', content: 'same\n' },
    ],
  },
};

describe('fs glob', () => {
  it('matches * within a segment only', () => {
    expect(matchFsGlob('*.txt', 'a.txt')).toBe(true);
    expect(matchFsGlob('*.txt', 'sub/a.txt')).toBe(false);
    expect(matchFsGlob('?.txt', 'a.txt')).toBe(true);
    expect(matchFsGlob('?.txt', 'ab.txt')).toBe(false);
  });
  it('matches ** across segments', () => {
    expect(matchFsGlob('**/*.log', 'a.log')).toBe(true);
    expect(matchFsGlob('**/*.log', 'sub/dir/a.log')).toBe(true);
    expect(matchFsGlob('**/*.log', 'a.txt')).toBe(false);
    expect(matchFsGlob('src/**', 'src/a/b/c.txt')).toBe(true);
  });
});

describe('fs_state scorer', () => {
  it('is wired through the scorer registry', async () => {
    const scorer = getScorer('fs_state');
    expect(scorer).toBe(fsStateScorer);
    const r = await scorer.score(
      fsInput([{ path: 'main.txt', exists: true }], [{ path: 'main.txt', hash: 'h1' }]),
      {},
      ctx,
    );
    expect(r).toMatchObject({ value: 1, verdict: 'correct' });
  });

  it('checks exists expectations', async () => {
    const ok = await fsStateScorer.score(
      fsInput([{ path: 'new.txt', exists: true }], [{ path: 'new.txt', hash: 'h' }]),
      {},
      ctx,
    );
    expect(ok.verdict).toBe('correct');
    const bad = await fsStateScorer.score(
      fsInput([{ path: 'gone.txt', exists: true }], [{ path: 'other.txt', hash: 'h' }]),
      {},
      ctx,
    );
    expect(bad).toMatchObject({ value: 0, verdict: 'incorrect' });
  });

  it('checks content contains/notContains/regex/equals', async () => {
    const files = [{ path: 'main.txt', hash: 'h1', content: 'Hello World\n' }];
    const ok = await fsStateScorer.score(
      fsInput(
        [{
          path: 'main.txt',
          contains: ['Hello'],
          notContains: ['bye'],
          regex: 'Wor.d',
          equals: 'Hello World\n',
        }],
        files,
      ),
      {},
      ctx,
    );
    expect(ok.verdict).toBe('correct');
    const fail = await fsStateScorer.score(
      fsInput([{ path: 'main.txt', contains: ['missing'] }], files),
      {},
      ctx,
    );
    expect(fail.verdict).toBe('incorrect');
  });

  it('supports case-insensitive matching', async () => {
    const files = [{ path: 'a.txt', hash: 'h', content: 'Hello\n' }];
    const r = await fsStateScorer.score(
      fsInput([{ path: 'a.txt', contains: ['hello'], caseSensitive: false }], files),
      {},
      ctx,
    );
    expect(r.verdict).toBe('correct');
  });

  it('detects unchanged globs against initialState', async () => {
    const same = await fsStateScorer.score(
      fsInput(
        [{ glob: 'keep/**', unchanged: true }],
        [{ path: 'keep/a.txt', hash: 'h2', content: 'same\n' }],
        INIT,
      ),
      {},
      ctx,
    );
    expect(same.verdict).toBe('correct');
    const changed = await fsStateScorer.score(
      fsInput(
        [{ glob: 'keep/**', unchanged: true }],
        [{ path: 'keep/a.txt', hash: 'hX', content: 'other\n' }],
        INIT,
      ),
      {},
      ctx,
    );
    expect(changed.verdict).toBe('incorrect');
    const added = await fsStateScorer.score(
      fsInput(
        [{ glob: 'keep/**', unchanged: true }],
        [
          { path: 'keep/a.txt', hash: 'h2', content: 'same\n' },
          { path: 'keep/b.txt', hash: 'h3', content: 'new\n' },
        ],
        INIT,
      ),
      {},
      ctx,
    );
    expect(added.verdict).toBe('incorrect');
    const noInitial = await fsStateScorer.score(
      fsInput(
        [{ glob: 'keep/**', unchanged: true }],
        [{ path: 'keep/a.txt', hash: 'h2' }],
        undefined,
      ),
      {},
      ctx,
    );
    expect(noInitial.verdict).toBe('incorrect');
  });

  it('enforces maxFiles globs', async () => {
    const ok = await fsStateScorer.score(
      fsInput(
        [{ glob: '**/*.log', maxFiles: 1 }],
        [{ path: 'a.log', hash: 'h' }],
      ),
      {},
      ctx,
    );
    expect(ok.verdict).toBe('correct');
    const over = await fsStateScorer.score(
      fsInput(
        [{ glob: '**/*.log', maxFiles: 1 }],
        [
          { path: 'a.log', hash: 'h1' },
          { path: 'sub/b.log', hash: 'h2' },
        ],
      ),
      {},
      ctx,
    );
    expect(over).toMatchObject({ value: 0, verdict: 'incorrect' });
  });

  it('scores passed/total with partial credit', async () => {
    const r = await fsStateScorer.score(
      fsInput(
        [
          { path: 'a.txt', exists: true },
          { path: 'b.txt', exists: true },
          { path: 'c.txt', exists: true },
          { path: 'd.txt', exists: true },
        ],
        [
          { path: 'a.txt', hash: 'h1' },
          { path: 'b.txt', hash: 'h2' },
          { path: 'c.txt', hash: 'h3' },
        ],
      ),
      {},
      ctx,
    );
    expect(r).toMatchObject({ value: 0.75, verdict: 'incorrect' });
  });

  it('returns error without expectState or finalState', async () => {
    const noExp = await fsStateScorer.score(
      fsInput(undefined, [{ path: 'a.txt', hash: 'h' }]),
      {},
      ctx,
    );
    expect(noExp.verdict).toBe('error');
    const noFinal = await fsStateScorer.score(
      {
        sample: { id: 's', input: 'q', expectState: [{ path: 'a.txt', exists: true }] } as EvalSample,
        pack,
        outputText: 'out',
        toolCalls: [],
        finalState: undefined,
      },
      {},
      ctx,
    );
    expect(noFinal.verdict).toBe('error');
  });
});
