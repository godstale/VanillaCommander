import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgents } from '@/lib/context/AgentsContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { candidateFromAgent } from '@/lib/eval/runner/candidates';
import {
  getStreamChatFn,
  resolveRuntimeForAgent,
} from '@/lib/llm/providerRuntime';
import { insertArenaVote } from '@/lib/db/repositories/evalRepo';
import { listPacks, type LoadedPackRef } from '@/lib/eval/packs/packLoader';
import { tauriPackFs } from '@/lib/eval/packs/packFs';
import type { ArenaWinner, CandidateSnapshot } from '@/lib/eval/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Leaderboard } from './Leaderboard';
import {
  buildArenaRequest,
  buildPromoteDownload,
  buildPromoteSample,
  buildVoteInput,
  decideLeftIsA,
  isExternalSnapshot,
  promptHash,
  randomPlacementBit,
} from './arenaUtils';

type DuelPhase = 'idle' | 'running' | 'awaitingVote' | 'voted';

interface DuelState {
  leftText: string;
  rightText: string;
  leftIsA: boolean;
  runningSide: 'left' | 'right' | null;
}

function CandidateSelect({
  label,
  value,
  onChange,
  excludeId,
  agents,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  excludeId: string | null;
  agents: ReturnType<typeof useAgents>['agents'];
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 rounded border border-border bg-background px-2 py-1.5 text-xs"
      >
        {agents.map((a) => (
          <option key={a.id} value={a.id} disabled={a.id === excludeId}>
            {a.name} · {a.model}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ArenaView({ refreshKey }: { refreshKey?: number } = {}) {
  const { t } = useLanguage();
  const { agents } = useAgents();
  const workspace = useSafeWorkspace();
  const workspaceRoot = workspace?.workspaceRoot ?? null;

  const [agentAId, setAgentAId] = useState<string | null>(null);
  const [agentBId, setAgentBId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<DuelPhase>('idle');
  const [duel, setDuel] = useState<DuelState>({
    leftText: '',
    rightText: '',
    leftIsA: true,
    runningSide: null,
  });
  const [status, setStatus] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [voteCount, setVoteCount] = useState(0);
  const [projectPacks, setProjectPacks] = useState<LoadedPackRef[]>([]);
  const [promotePackId, setPromotePackId] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Explicit picks fall back to the first two distinct agents so the pickers
  // always show a valid duel without seeding state inside an effect.
  const agentA = useMemo(
    () => agents.find((a) => a.id === agentAId) ?? agents[0] ?? null,
    [agents, agentAId],
  );
  const agentB = useMemo(
    () =>
      agents.find((a) => a.id === agentBId && a.id !== agentA?.id) ??
      agents.find((a) => a.id !== agentA?.id) ??
      null,
    [agents, agentBId, agentA?.id],
  );
  const snapshotA = useMemo(
    () => (agentA ? candidateFromAgent(agentA) : null),
    [agentA],
  );
  const snapshotB = useMemo(
    () => (agentB ? candidateFromAgent(agentB) : null),
    [agentB],
  );

  const canRun =
    phase !== 'running' &&
    prompt.trim().length > 0 &&
    agentA !== null &&
    agentB !== null &&
    agentA.id !== agentB.id;

  const collectAnswer = useCallback(
    async (
      agent: NonNullable<typeof agentA>,
      snapshot: CandidateSnapshot,
      signal: AbortSignal,
      onDelta: (text: string) => void,
    ): Promise<string> => {
      const runtime = resolveRuntimeForAgent(agent);
      const streamChat = getStreamChatFn(runtime);
      let out = '';
      const stream = streamChat(
        { ...buildArenaRequest(snapshot, prompt), apiKey: runtime.apiKey },
        signal,
      );
      for await (const chunk of stream) {
        if (chunk.content) {
          out += chunk.content;
          onDelta(out);
        }
        if (chunk.done) break;
      }
      return out;
    },
    [prompt],
  );

  const handleRunBoth = useCallback(async () => {
    if (!agentA || !agentB || !snapshotA || !snapshotB) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // Blind: randomize which candidate lands left/right per duel.
    const leftIsA = decideLeftIsA(randomPlacementBit());
    const leftAgent = leftIsA ? agentA : agentB;
    const rightAgent = leftIsA ? agentB : agentA;
    const leftSnapshot = leftIsA ? snapshotA : snapshotB;
    const rightSnapshot = leftIsA ? snapshotB : snapshotA;
    setPhase('running');
    setRevealed(false);
    setStatus(t('eval.arena.running'));
    setDuel({ leftText: '', rightText: '', leftIsA, runningSide: 'left' });
    try {
      // Sequential on purpose: concurrent runs contend for VRAM and would
      // skew latency/quality between the two sides.
      const leftText = await collectAnswer(leftAgent, leftSnapshot, controller.signal, (text) =>
        setDuel((d) => ({ ...d, leftText: text })),
      );
      if (controller.signal.aborted) return;
      setDuel((d) => ({ ...d, leftText, runningSide: 'right' }));
      setStatus(t('eval.arena.runningSide', { side: 'B' }));
      const rightText = await collectAnswer(rightAgent, rightSnapshot, controller.signal, (text) =>
        setDuel((d) => ({ ...d, rightText: text })),
      );
      if (controller.signal.aborted) return;
      setDuel((d) => ({ ...d, leftText, rightText, runningSide: null }));
      setPhase('awaitingVote');
      setStatus(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setPhase('idle');
      setDuel((d) => ({ ...d, runningSide: null }));
      setStatus(t('eval.arena.runFailed', { err: err instanceof Error ? err.message : String(err) }));
    }
  }, [agentA, agentB, snapshotA, snapshotB, collectAnswer, t]);

  const handleVote = useCallback(
    async (side: 'left' | 'right' | 'tie' | 'both_bad') => {
      if (!snapshotA || !snapshotB || phase !== 'awaitingVote') return;
      let winner: ArenaWinner;
      if (side === 'tie') winner = 'tie';
      else if (side === 'both_bad') winner = 'both_bad';
      else if (side === 'left') winner = duel.leftIsA ? 'a' : 'b';
      else winner = duel.leftIsA ? 'b' : 'a';
      try {
        const hash = await promptHash(prompt);
        await insertArenaVote(
          buildVoteInput({
            prompt,
            promptHashValue: hash,
            aSnapshot: snapshotA,
            bSnapshot: snapshotB,
            winner,
            workspaceRoot,
          }),
        );
        setPhase('voted');
        setStatus(t('eval.arena.voteSaved'));
        setVoteCount((n) => n + 1);
        try {
          const { refs } = await listPacks(tauriPackFs, workspaceRoot ?? undefined);
          const projects = refs.filter((r) => r.scope === 'project');
          setProjectPacks(projects);
          if (projects.length > 0 && !promotePackId) setPromotePackId(projects[0].manifest.id);
        } catch {
          setProjectPacks([]);
        }
      } catch (err) {
        setStatus(t('eval.arena.voteFailed', { err: err instanceof Error ? err.message : String(err) }));
      }
    },
    [snapshotA, snapshotB, phase, duel.leftIsA, prompt, workspaceRoot, t, promotePackId],
  );

  const handleNewDuel = useCallback(() => {
    abortRef.current?.abort();
    setPhase('idle');
    setRevealed(false);
    setStatus(null);
    setDuel({ leftText: '', rightText: '', leftIsA: true, runningSide: null });
  }, []);

  const handlePromote = useCallback(async () => {
    if (!snapshotA || !snapshotB || phase !== 'voted') return;
    const ref = projectPacks.find((r) => r.manifest.id === promotePackId);
    if (!ref || ref.manifest.source.type !== 'jsonl') {
      setStatus(t('eval.arena.noJsonl'));
      return;
    }
    try {
      const hash = await promptHash(prompt);
      const sample = buildPromoteSample(prompt, hash);
      const relPath = ref.manifest.source.file;
      const current = await tauriPackFs.read('project', ref.manifest.id, relPath, workspaceRoot ?? undefined);
      const appended = current.endsWith('\n') || current.length === 0
        ? `${current}${JSON.stringify(sample)}\n`
        : `${current}\n${JSON.stringify(sample)}\n`;
      await tauriPackFs.write(
        'project',
        ref.manifest.id,
        [{ relPath, content: appended }],
        workspaceRoot ?? undefined,
      );
      setStatus(t('eval.arena.promoteDone', { pack: ref.manifest.id }));
    } catch (err) {
      setStatus(t('eval.arena.promoteFailed', { err: err instanceof Error ? err.message : String(err) }));
    }
  }, [snapshotA, snapshotB, phase, projectPacks, promotePackId, prompt, workspaceRoot, t]);

  const handleDownload = useCallback(async () => {
    if (!snapshotA || !snapshotB) return;
    const hash = await promptHash(prompt);
    const sample = buildPromoteSample(prompt, hash);
    const payload = buildPromoteDownload(
      { promptHash: hash, aLabel: snapshotA.label, bLabel: snapshotB.label, winner: 'tie' },
      sample,
    );
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `arena-${hash.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [snapshotA, snapshotB, prompt]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3" data-testid="arena-view">
      <div>
        <h2 className="text-sm font-semibold">{t('eval.arena.title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('eval.arena.desc')}</p>
      </div>

      <div className="flex gap-2">
        <CandidateSelect
          label={t('eval.arena.candidateA')}
          value={agentA?.id ?? ''}
          onChange={setAgentAId}
          excludeId={null}
          agents={agents}
        />
        <CandidateSelect
          label={t('eval.arena.candidateB')}
          value={agentB?.id ?? ''}
          onChange={setAgentBId}
          excludeId={null}
          agents={agents}
        />
      </div>
      <div className="flex gap-2 text-[11px]">
        {snapshotA && isExternalSnapshot(snapshotA) && (
          <span
            title={t('eval.arena.externalTitle')}
            className="rounded-full bg-warning/15 px-2 py-px font-medium text-warning"
          >
            A: {t('eval.arena.externalBadge')}
          </span>
        )}
        {snapshotB && isExternalSnapshot(snapshotB) && (
          <span
            title={t('eval.arena.externalTitle')}
            className="rounded-full bg-warning/15 px-2 py-px font-medium text-warning"
          >
            B: {t('eval.arena.externalBadge')}
          </span>
        )}
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-muted-foreground">{t('eval.arena.promptLabel')}</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('eval.arena.promptPlaceholder')}
          rows={4}
          className="rounded border border-border bg-background px-2 py-1.5 text-xs"
        />
      </label>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={!canRun} onClick={() => void handleRunBoth()}>
          {phase === 'running' ? t('eval.arena.running') : t('eval.arena.runBoth')}
        </Button>
        {(phase === 'awaitingVote' || phase === 'voted') && (
          <Button type="button" size="sm" variant="outline" onClick={handleNewDuel}>
            {t('eval.arena.newDuel')}
          </Button>
        )}
      </div>
      {agentA && agentB && agentA.id === agentB.id && (
        <p className="text-xs text-destructive">{t('eval.arena.sameCandidate')}</p>
      )}
      <p className="text-[11px] text-muted-foreground">
        {t('eval.arena.fairnessNote')}
        <br />
        {t('eval.arena.plainPromptNote')}
      </p>
      {status && <p className="text-xs text-muted-foreground">{status}</p>}

      {(phase === 'running' || phase === 'awaitingVote' || phase === 'voted') && (
        <div className="grid grid-cols-2 gap-2">
          {(['left', 'right'] as const).map((side) => (
            <div key={side} className="rounded-lg border border-border bg-card/40 p-2.5">
              <div className="mb-1 flex items-center justify-between text-xs font-medium">
                <span>{side === 'left' ? t('eval.arena.answerLeft') : t('eval.arena.answerRight')}</span>
                {duel.runningSide === side && (
                  <span className="text-[11px] text-muted-foreground">
                    {t('eval.arena.runningSide', { side: side === 'left' ? 'A' : 'B' })}
                  </span>
                )}
              </div>
              <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs">
                {side === 'left' ? duel.leftText : duel.rightText}
              </p>
              {phase === 'voted' && revealed && snapshotA && snapshotB && (
                <p className="mt-1.5 text-[11px] font-medium text-primary">
                  {side === 'left'
                    ? t('eval.arena.revealedLeft', {
                        label: duel.leftIsA ? snapshotA.label : snapshotB.label,
                      })
                    : t('eval.arena.revealedRight', {
                        label: duel.leftIsA ? snapshotB.label : snapshotA.label,
                      })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {(phase === 'awaitingVote' || phase === 'voted') && (
        <p className="text-[11px] text-muted-foreground">{t('eval.arena.hiddenNote')}</p>
      )}

      {phase === 'awaitingVote' && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => void handleVote('left')}>
            {t('eval.arena.voteA')}
          </Button>
          <Button type="button" size="sm" onClick={() => void handleVote('right')}>
            {t('eval.arena.voteB')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void handleVote('tie')}>
            {t('eval.arena.voteTie')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void handleVote('both_bad')}>
            {t('eval.arena.voteBothBad')}
          </Button>
        </div>
      )}

      {phase === 'voted' && (
        <div className={cn('flex flex-col gap-2 rounded-lg border border-border p-2.5')}>
          {!revealed ? (
            <div>
              <Button type="button" size="sm" variant="outline" onClick={() => setRevealed(true)}>
                {t('eval.arena.reveal')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium" title={t('eval.arena.promoteTitle')}>
                {t('eval.arena.promote')}
              </p>
              {projectPacks.length > 0 ? (
                <div className="flex gap-2">
                  <select
                    value={promotePackId}
                    onChange={(e) => setPromotePackId(e.target.value)}
                    aria-label={t('eval.arena.promotePack')}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    {projectPacks.map((r) => (
                      <option key={r.manifest.id} value={r.manifest.id}>
                        {r.manifest.id}
                      </option>
                    ))}
                  </select>
                  <Button type="button" size="sm" onClick={() => void handlePromote()}>
                    {t('eval.arena.promote')}
                  </Button>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">{t('eval.arena.noJsonl')}</p>
              )}
              <div>
                <Button type="button" size="sm" variant="ghost" onClick={() => void handleDownload()}>
                  {t('eval.arena.downloadJson')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Leaderboard refreshKey={(refreshKey ?? 0) + voteCount} />
    </div>
  );
}
