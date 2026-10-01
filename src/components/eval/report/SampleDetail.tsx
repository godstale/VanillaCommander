import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { EvalScoreRow, EvalTrialRow } from '@/lib/eval/types';

export interface SampleDetailProps {
  trial: EvalTrialRow;
  scores: EvalScoreRow[];
  candidateLabel: string;
}

export function SampleDetail({ trial, scores, candidateLabel }: SampleDetailProps) {
  const { t } = useLanguage();
  const hasHuman = scores.some((s) => s.source === 'human');

  return (
    <div className="space-y-2 rounded-lg border border-border p-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-foreground">
          {candidateLabel} · {trial.packId} · {trial.sampleId} · epoch {trial.epoch}
        </span>
        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{trial.outcome}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {t('eval.report.sample.tokens', { input: trial.inputTokens ?? '-', output: trial.outputTokens ?? '-' })}
      </div>
      {(trial.outputText || trial.reasoningText) && (
        <div className="grid gap-2 md:grid-cols-2">
          {trial.outputText && (
            <div>
              <div className="mb-0.5 font-medium text-muted-foreground">{t('eval.report.sample.output')}</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-1.5">{trial.outputText}</pre>
            </div>
          )}
          {trial.reasoningText && (
            <div>
              <div className="mb-0.5 font-medium text-muted-foreground">{t('eval.report.sample.reasoning')}</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-1.5">{trial.reasoningText}</pre>
            </div>
          )}
        </div>
      )}
      <div>
        <div className="mb-0.5 font-medium text-muted-foreground">{t('eval.report.sample.scores')}</div>
        {scores.length === 0 ? (
          <p className="text-muted-foreground">-</p>
        ) : (
          <ul className="space-y-0.5">
            {scores.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-2 tabular-nums">
                <span className="font-mono">{s.scorerKey}</span>
                <span>{s.value.toFixed(2)}</span>
                <span className="text-muted-foreground">({s.verdict}/{s.source})</span>
                {s.reason && <span className="text-muted-foreground">{s.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {hasHuman && (
        <p className="rounded bg-primary/10 px-1.5 py-1 text-[11px] text-primary">
          {t('eval.report.sample.humanOverride')}
        </p>
      )}
    </div>
  );
}
