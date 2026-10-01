import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { deleteArenaVote, listArenaVotes } from '@/lib/db/repositories/evalRepo';
import type { ArenaVoteRow } from '@/lib/eval/types';
import {
  bradleyTerryCI,
  fitBradleyTerry,
} from '@/lib/eval/stats/bradleyTerry';
import { Button } from '@/components/ui/button';
import { countPairs, votesToBtMatches } from './arenaUtils';

// Ratings are trustworthy only with enough comparisons; mirrors the default
// EvalProfile arena.minVotes (30) without importing profile constants here.
const MIN_VOTES_NOTE = 30;
const CI_ITERATIONS = 500;
const CI_SEED = 42;

export function Leaderboard({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useLanguage();
  const [votes, setVotes] = useState<ArenaVoteRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setVotes(await listArenaVotes());
      setStatus(null);
    } catch (err) {
      setStatus(t('eval.arena.loadFailed', { err: err instanceof Error ? err.message : String(err) }));
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external arena_votes DB on mount/refresh
    void reload();
  }, [reload, refreshKey]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm(t('eval.arena.deleteVoteConfirm'))) return;
      await deleteArenaVote(id);
      await reload();
    },
    [reload, t],
  );

  const matches = votesToBtMatches(votes);
  const fit = matches.length > 0 ? fitBradleyTerry(matches) : null;
  const ci = matches.length > 0
    ? bradleyTerryCI(matches, { iterations: CI_ITERATIONS, seed: CI_SEED })
    : null;
  const pairs = countPairs(votes);
  const ranked = fit
    ? [...fit.players].sort((a, b) => (fit.display[b] ?? 0) - (fit.display[a] ?? 0))
    : [];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-2.5" data-testid="arena-leaderboard">
      <h3 className="text-xs font-semibold">{t('eval.arena.leaderboardTitle')}</h3>
      {status && <p className="text-xs text-destructive">{status}</p>}
      {votes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('eval.arena.leaderboardEmpty')}</p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            {t('eval.arena.minVotesNote', { n: String(votes.length), min: String(MIN_VOTES_NOTE) })}
          </p>
          {fit == null ? (
            <p className="text-xs text-warning">{t('eval.arena.disconnectedNote')}</p>
          ) : (
            <table className="text-xs">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">{t('eval.arena.colPlayer')}</th>
                  <th className="py-1 pr-2 font-medium">{t('eval.arena.colRating')}</th>
                  <th className="py-1 pr-2 font-medium">{t('eval.arena.colCI')}</th>
                  <th className="py-1 font-medium">{t('eval.arena.colGames')}</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((player) => {
                  const interval = ci?.[player];
                  return (
                    <tr key={player} className="border-t border-border/60">
                      <td className="max-w-48 truncate py-1 pr-2 font-medium" title={player}>
                        {player}
                      </td>
                      <td className="py-1 pr-2 tabular-nums">
                        {Math.round(fit.display[player] ?? NaN)}
                      </td>
                      <td className="py-1 pr-2 tabular-nums text-muted-foreground">
                        {interval && Number.isFinite(interval.low) && Number.isFinite(interval.high)
                          ? `${Math.round(interval.low)}–${Math.round(interval.high)}`
                          : '—'}
                      </td>
                      <td className="py-1 tabular-nums">{fit.games[player] ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <h4 className="mt-1 text-[11px] font-semibold text-muted-foreground">
            {t('eval.arena.pairsTitle')}
          </h4>
          <ul className="text-xs text-muted-foreground">
            {pairs.map(({ pair, n }) => (
              <li key={pair}>
                {pair}: {n}
              </li>
            ))}
          </ul>

          <h4 className="mt-1 text-[11px] font-semibold text-muted-foreground">
            {t('eval.arena.votesTitle')}
          </h4>
          <ul className="flex flex-col gap-1">
            {votes.slice(0, 20).map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1 text-xs"
              >
                <span className="min-w-0 flex-1 truncate" title={v.promptPreview ?? ''}>
                  {v.aLabel} vs {v.bLabel} → {v.winner}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px] text-destructive"
                  aria-label={t('eval.arena.deleteVote')}
                  onClick={() => void handleDelete(v.id)}
                >
                  {t('eval.arena.deleteVote')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
