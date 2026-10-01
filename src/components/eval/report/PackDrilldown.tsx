import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { EvalCandidateRow, EvalScoreRow, EvalTrialRow } from '@/lib/eval/types';
import { combineTrialScores, pickEffectiveScore } from '@/lib/eval/scoring/metrics';
import { SampleDetail } from './SampleDetail';
import { HumanScoreEditor } from './HumanScoreEditor';

export interface PackDrilldownProps {
  trials: EvalTrialRow[];
  scores: EvalScoreRow[];
  candidates: EvalCandidateRow[];
  onScoresChanged?: () => void;
}

export function PackDrilldown({ trials, scores, candidates, onScoresChanged }: PackDrilldownProps) {
  const { t } = useLanguage();
  const [openPack, setOpenPack] = useState<string | null>(null);
  const [selectedTrialId, setSelectedTrialId] = useState<string | null>(null);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const packs = [...new Set(trials.map((tr) => tr.packId))].sort();

  const effective = pickEffectiveScore(scores);
  const byTrial = new Map<string, EvalScoreRow[]>();
  for (const s of effective) {
    const arr = byTrial.get(s.trialId);
    if (arr) arr.push(s);
    else byTrial.set(s.trialId, [s]);
  }
  const trialScore = (trialId: string): number | null => combineTrialScores(byTrial.get(trialId) ?? []);

  const selectedTrial = selectedTrialId ? trials.find((tr) => tr.id === selectedTrialId) ?? null : null;
  const selectedScores = selectedTrialId ? (byTrial.get(selectedTrialId) ?? []) : [];

  return (
    <div className="space-y-2">
      {packs.map((packId) => {
        const packTrials = trials.filter((tr) => tr.packId === packId);
        const open = openPack === packId;
        return (
          <div key={packId} className="rounded-lg border border-border">
            <button
              type="button"
              className="flex w-full items-center justify-between px-2.5 py-1.5 text-xs font-medium text-foreground"
              onClick={() => {
                setOpenPack(open ? null : packId);
                setSelectedTrialId(null);
              }}
            >
              <span>{packId}</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                {t('eval.report.pack.samples', { count: packTrials.length })}
              </span>
            </button>
            {open && (
              <div className="border-t border-border">
                {packTrials.length === 0 ? (
                  <p className="p-2.5 text-xs text-muted-foreground">{t('eval.report.pack.noSamples')}</p>
                ) : (
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="px-2 py-1 font-medium">{t('eval.report.rank.candidate')}</th>
                        <th className="px-2 py-1 font-medium">{t('eval.report.pack.sample')}</th>
                        <th className="px-2 py-1 text-right font-medium">{t('eval.report.pack.score')}</th>
                        <th className="px-2 py-1 font-medium">{t('eval.report.pack.outcome')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {packTrials.map((tr) => (
                        <tr key={tr.id} className="border-t border-border">
                          <td className="px-2 py-1">{byId.get(tr.candidateId)?.label ?? tr.candidateId}</td>
                          <td className="px-2 py-1">
                            <button
                              type="button"
                              className="font-mono text-primary hover:underline"
                              onClick={() => setSelectedTrialId(tr.id)}
                            >
                              {tr.sampleId}
                            </button>
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {(() => {
                              const v = trialScore(tr.id);
                              return v === null ? '-' : v.toFixed(2);
                            })()}
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">{tr.outcome}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
      {selectedTrial && (
        <div className="space-y-2">
          <SampleDetail
            trial={selectedTrial}
            scores={selectedScores}
            candidateLabel={byId.get(selectedTrial.candidateId)?.label ?? selectedTrial.candidateId}
          />
          <HumanScoreEditor
            trialId={selectedTrial.id}
            onSaved={() => onScoresChanged?.()}
          />
        </div>
      )}
    </div>
  );
}
