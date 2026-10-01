import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { createAgent } from '@/lib/db/repositories/agentsRepo';
import type { EvalAggregateRow, EvalCandidateRow } from '@/lib/eval/types';
import type { Recommendation } from '@/lib/eval/scoring/recommend';
import { explainBest, explainFast, explainQuality } from '@/lib/eval/scoring/explain';
import { findAggregate, formatScore } from './reportData';
import { Button } from '@/components/ui/button';

export interface RecommendationCardsProps {
  candidates: EvalCandidateRow[];
  aggregates: EvalAggregateRow[];
  recommendation: Recommendation;
}

function dimOf(aggregates: EvalAggregateRow[], id: string, dim: string): number | null {
  return findAggregate(aggregates, id, 'dimension', dim)?.normalized ?? null;
}

export function RecommendationCards({ candidates, aggregates, recommendation }: RecommendationCardsProps) {
  const { t } = useLanguage();
  const { openTab } = useWorkspaceTabs();
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const labelOf = (id: string): string => byId.get(id)?.label ?? id;
  const compositeOf = (id: string): number | null =>
    findAggregate(aggregates, id, 'composite', 'composite')?.normalized ?? null;

  const cards: { kind: 'best' | 'fast' | 'quality'; id: string | undefined; reason: string }[] = [];
  const { best, fast, quality } = recommendation.picks;
  if (best) {
    const r = explainBest(labelOf(best), compositeOf(best));
    cards.push({ kind: 'best', id: best, reason: t(r.key, r.params) });
  }
  if (fast && fast !== best) {
    const r = explainFast(labelOf(fast), best ? labelOf(best) : '-', dimOf(aggregates, fast, 'P'));
    cards.push({ kind: 'fast', id: fast, reason: t(r.key, r.params) });
  }
  if (quality && quality !== best) {
    const q = dimOf(aggregates, quality, 'Q');
    const a = dimOf(aggregates, quality, 'A');
    const r = explainQuality(labelOf(quality), q !== null && a !== null ? (q + a) / 2 : null);
    cards.push({ kind: 'quality', id: quality, reason: t(r.key, r.params) });
  }

  if (recommendation.eligible.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('eval.report.rec.ineligible')}</p>;
  }

  const handleCreate = async (candidateId: string) => {
    const cand = byId.get(candidateId);
    if (!cand) return;
    setCreatingId(candidateId);
    try {
      const s = cand.snapshot;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await createAgent({
        id,
        name: `${cand.label}`,
        description: undefined,
        systemPrompt: s.systemPrompt,
        model: s.model,
        temperature: s.temperature,
        contextSize: s.contextSize,
        reserveTokens: s.reserveTokens,
        keepRecentTokens: s.keepRecentTokens,
        enabledSkills: [...s.enabledSkills],
        enabledBuiltinTools: [...s.enabledBuiltinTools],
        approvalMode: 'dangerous-only',
        reasoning: s.reasoning,
        reasoningEffort: s.reasoningEffort,
        topP: s.topP,
        topK: s.topK,
        repeatPenalty: s.repeatPenalty,
        frequencyPenalty: s.frequencyPenalty,
        presencePenalty: s.presencePenalty,
        seed: s.seed,
        stopSequences: s.stopSequences ? [...s.stopSequences] : undefined,
        maxOutputTokens: s.maxOutputTokens,
        llmProvider: s.provider,
        llmBaseUrl: s.baseUrl,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      });
      setCreatedId(candidateId);
      openTab({
        id: `agent-editor:${id}`,
        type: 'agent-editor',
        title: cand.label,
        meta: { agentId: id },
      });
    } catch (err) {
      console.error('Failed to create agent from candidate:', err);
    } finally {
      setCreatingId(null);
    }
  };

  const kindTitle = { best: t('eval.report.rec.best'), fast: t('eval.report.rec.fast'), quality: t('eval.report.rec.quality') };

  return (
    <div className="grid gap-2 md:grid-cols-3">
      {cards.map((card) => (
        <div key={card.kind} className="rounded-lg border border-border bg-card/40 p-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold uppercase tracking-wider text-[11px] text-muted-foreground">
              {kindTitle[card.kind]}
            </span>
            <span className="font-semibold text-foreground">{card.id ? labelOf(card.id) : t('eval.report.rec.none')}</span>
          </div>
          <p className="mt-1 text-muted-foreground">
            {card.id ? `${card.reason} (${formatScore(card.id ? compositeOf(card.id) : null)})` : card.reason}
          </p>
          {card.id && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 h-6 px-2 text-[11px]"
              disabled={creatingId === card.id}
              onClick={() => void handleCreate(card.id as string)}
            >
              {creatingId === card.id ? t('eval.report.rec.creating') : t('eval.report.rec.createAgent')}
            </Button>
          )}
          {createdId === card.id && (
            <p className="mt-1 text-[11px] text-success">{t('eval.report.rec.created')}</p>
          )}
        </div>
      ))}
    </div>
  );
}
