import { describe, expect, it, beforeEach } from 'vitest';
import { MemorySqlFallback, setDatabase } from '@/lib/db/client';
import {
  deleteArenaVote,
  insertArenaVote,
  listArenaVotes,
} from '@/lib/db/repositories/evalRepo';
import { fitBradleyTerry } from '@/lib/eval/stats/bradleyTerry';
import type { ArenaVoteRow, CandidateSnapshot } from '@/lib/eval/types';
import {
  buildArenaRequest,
  buildVoteInput,
  countPairs,
  decideLeftIsA,
  isExternalSnapshot,
  promptHash,
  promptPreview,
  randomPlacementBit,
  votesToBtMatches,
} from './arenaUtils';

function makeSnapshot(label: string, baseUrl = 'http://127.0.0.1:11434'): CandidateSnapshot {
  return {
    label,
    sourceAgentId: null,
    provider: 'ollama',
    baseUrl,
    endpointClass: 'local',
    model: 'qwen3:8b',
    systemPrompt: 'You are helpful.',
    temperature: 0.7,
    reasoning: 'default',
    reasoningEffort: 'medium',
    contextSize: 8192,
    reserveTokens: 2048,
    keepRecentTokens: 2048,
    enabledBuiltinTools: [],
    enabledSkills: [],
  };
}

describe('randomized placement', () => {
  it('maps the random bit deterministically to left/right', () => {
    expect(decideLeftIsA(true)).toBe(false);
    expect(decideLeftIsA(false)).toBe(true);
  });

  it('distributes sides roughly evenly over many duels', () => {
    const N = 2000;
    let leftCount = 0;
    for (let i = 0; i < N; i++) {
      if (decideLeftIsA(randomPlacementBit())) leftCount += 1;
    }
    // 30–70% band: negligible flake probability at N=2000 for a fair coin.
    expect(leftCount).toBeGreaterThan(N * 0.3);
    expect(leftCount).toBeLessThan(N * 0.7);
  });
});

describe('promptHash stability', () => {
  it('is stable for the same prompt and distinct otherwise', async () => {
    const a = await promptHash('Explain quantum tunneling briefly.');
    const b = await promptHash('Explain quantum tunneling briefly.');
    const c = await promptHash('Explain quantum tunneling briefly!');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('truncates previews to the first 200 chars', () => {
    const long = 'x'.repeat(500);
    expect(promptPreview(long)).toBe('x'.repeat(200));
    expect(promptPreview('short')).toBe('short');
  });
});

describe('arena request fairness', () => {
  it('sends a plain user prompt with per-candidate sampling params', () => {
    const snapshot = makeSnapshot('A');
    const req = buildArenaRequest(snapshot, 'Hello?');
    expect(req.messages).toEqual([{ role: 'user', content: 'Hello?' }]);
    expect(req.temperature).toBe(0.7);
    expect(req.model).toBe('qwen3:8b');
  });

  it('flags non-local endpoints as external', () => {
    expect(isExternalSnapshot(makeSnapshot('local'))).toBe(false);
    expect(isExternalSnapshot(makeSnapshot('remote', 'https://api.example.com/v1'))).toBe(true);
  });
});

describe('arena vote persistence (memory DB)', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
  });

  it('round-trips a vote through insert/list/delete', async () => {
    const hash = await promptHash('Which is better?');
    const id = await insertArenaVote(
      buildVoteInput({
        prompt: 'Which is better?',
        promptHashValue: hash,
        aSnapshot: makeSnapshot('agent-a · qwen3:8b'),
        bSnapshot: makeSnapshot('agent-b · llama3:8b'),
        winner: 'a',
        workspaceRoot: null,
      }),
    );
    const votes = await listArenaVotes();
    expect(votes).toHaveLength(1);
    expect(votes[0].id).toBe(id);
    expect(votes[0].promptHash).toBe(hash);
    expect(votes[0].winner).toBe('a');
    await deleteArenaVote(id);
    expect(await listArenaVotes()).toHaveLength(0);
  });
});

describe('BT ordering on scripted votes', () => {
  function scriptedVotes(): ArenaVoteRow[] {
    const a = makeSnapshot('A');
    const b = makeSnapshot('B');
    const rows: ArenaVoteRow[] = [];
    const winners = ['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'b'] as const;
    winners.forEach((winner, i) => {
      rows.push({
        id: `vote-${i}`,
        promptHash: `hash-${i}`,
        promptPreview: `prompt ${i}`,
        aSnapshot: a,
        bSnapshot: b,
        aLabel: 'A',
        bLabel: 'B',
        winner,
        workspaceRoot: null,
        createdAt: new Date().toISOString(),
      });
    });
    return rows;
  }

  it('ranks the 9-1 winner higher', () => {
    const votes = scriptedVotes();
    const fit = fitBradleyTerry(votesToBtMatches(votes));
    expect(fit).not.toBeNull();
    expect(fit!.display['A']).toBeGreaterThan(fit!.display['B']);
  });

  it('maps both_bad to a draw and counts pairs', () => {
    const votes = scriptedVotes();
    votes[0].winner = 'both_bad';
    const matches = votesToBtMatches(votes);
    expect(matches[0].winner).toBe('tie');
    expect(countPairs(votes)).toEqual([{ pair: 'A vs B', n: 10 }]);
  });
});
