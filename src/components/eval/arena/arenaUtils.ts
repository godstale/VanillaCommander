import { resolveThinkValue } from '@/lib/types/agent';
import { classifyEndpoint } from '@/lib/eval/integrations/endpointClass';
import type { LlmChatRequest } from '@/lib/llm/providerRuntime';
import { sha256Hex } from '@/lib/eval/packs/hash';
import type {
  ArenaVoteRow,
  ArenaWinner,
  CandidateSnapshot,
  EvalSample,
} from '@/lib/eval/types';
import type { BradleyTerryMatch } from '@/lib/eval/stats/bradleyTerry';

export { sha256Hex };

export const PROMPT_PREVIEW_LENGTH = 200;

export function promptPreview(prompt: string): string {
  return prompt.slice(0, PROMPT_PREVIEW_LENGTH);
}

export async function promptHash(prompt: string): Promise<string> {
  return sha256Hex(prompt);
}

// ---------------------------------------------------------------------------
// Randomized placement: one random bit per duel decides whether candidate A
// lands on the left. The bit comes from crypto.randomUUID so placement is
// unpredictable to the voter (blind).
// ---------------------------------------------------------------------------

export function randomPlacementBit(): boolean {
  const id = crypto.randomUUID();
  const last = id[id.length - 1] ?? '0';
  return parseInt(last, 16) % 2 === 1;
}

export function decideLeftIsA(randomBit: boolean): boolean {
  return !randomBit;
}

// ---------------------------------------------------------------------------
// Fairness: same system-prompt handling as eval candidates with
// useAgentSystemPrompt=false — plain user prompt only, no agent system prompt,
// so neither side gains an advantage from a custom persona. Sampling params
// (temperature etc.) are each candidate's own, as stored in the snapshot.
// Runs are sequential (no VRAM contention) — enforced by the caller.
// ---------------------------------------------------------------------------

export function buildArenaRequest(
  snapshot: CandidateSnapshot,
  prompt: string,
): LlmChatRequest {
  return {
    baseUrl: snapshot.baseUrl,
    model: snapshot.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: snapshot.temperature,
    think: resolveThinkValue(snapshot.reasoning, snapshot.reasoningEffort) ?? undefined,
    topP: snapshot.topP,
    topK: snapshot.topK,
    repeatPenalty: snapshot.repeatPenalty,
    frequencyPenalty: snapshot.frequencyPenalty,
    presencePenalty: snapshot.presencePenalty,
    seed: snapshot.seed,
    stopSequences: snapshot.stopSequences,
    maxTokens: snapshot.maxOutputTokens,
    options: snapshot.contextSize > 0 ? { num_ctx: snapshot.contextSize } : undefined,
  };
}

export function isExternalSnapshot(snapshot: CandidateSnapshot): boolean {
  return (
    classifyEndpoint(snapshot.baseUrl, { trustedLanHosts: [] }) === 'external'
  );
}

// ---------------------------------------------------------------------------
// Votes -> Bradley-Terry matches. 'tie' and 'both_bad' both count as 0.5 win
// each (draw), matching fitBradleyTerry's documented tie handling.
// ---------------------------------------------------------------------------

export function votesToBtMatches(votes: ArenaVoteRow[]): BradleyTerryMatch[] {
  return votes.map((v) => ({
    a: v.aLabel,
    b: v.bLabel,
    winner: v.winner === 'a' || v.winner === 'b' ? v.winner : 'tie',
  }));
}

export function countPairs(votes: ArenaVoteRow[]): Array<{ pair: string; n: number }> {
  const counts = new Map<string, number>();
  for (const v of votes) {
    const [x, y] = [v.aLabel, v.bLabel].sort();
    const key = `${x} vs ${y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([pair, n]) => ({ pair, n }))
    .sort((p, q) => q.n - p.n || p.pair.localeCompare(q.pair));
}

// ---------------------------------------------------------------------------
// Promote-to-pack: append the voted prompt as a Q9 single-turn sample.
// Used for the tauriPackFs read-modify-write path and for the JSON-download
// fallback (same payload either way).
// ---------------------------------------------------------------------------

export function buildPromoteSample(prompt: string, duelId: string): EvalSample {
  return {
    id: `arena-${duelId.slice(0, 8)}`,
    input: prompt,
    tags: ['arena', 'Q9'],
  };
}

export function buildPromoteDownload(
  vote: Pick<ArenaVoteRow, 'promptHash' | 'aLabel' | 'bLabel' | 'winner'>,
  sample: EvalSample,
): string {
  return JSON.stringify(
    {
      schema: 'fortress-arena-promote/1',
      vote: {
        promptHash: vote.promptHash,
        aLabel: vote.aLabel,
        bLabel: vote.bLabel,
        winner: vote.winner,
      },
      sample,
    },
    null,
    2,
  );
}

export type ArenaVoteInput = Omit<ArenaVoteRow, 'id' | 'createdAt'>;

export function buildVoteInput(opts: {
  prompt: string;
  promptHashValue: string;
  aSnapshot: CandidateSnapshot;
  bSnapshot: CandidateSnapshot;
  winner: ArenaWinner;
  workspaceRoot: string | null;
}): ArenaVoteInput {
  return {
    promptHash: opts.promptHashValue,
    promptPreview: promptPreview(opts.prompt),
    aSnapshot: opts.aSnapshot,
    bSnapshot: opts.bSnapshot,
    aLabel: opts.aSnapshot.label,
    bLabel: opts.bSnapshot.label,
    winner: opts.winner,
    workspaceRoot: opts.workspaceRoot,
  };
}
