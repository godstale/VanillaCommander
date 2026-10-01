import { useLanguage } from '@/lib/i18n/LanguageContext';

interface LiveSamplePreviewProps {
  packId: string | null;
  sampleId: string | null;
  candidateLabel: string | null;
  sampleInput: string | null;
  streamText: string;
  turns: number | null;
  toolCallCount: number | null;
  outcome: string | null;
}

export const SAMPLE_INPUT_PREVIEW_CHARS = 300;

export function LiveSamplePreview({
  packId,
  sampleId,
  candidateLabel,
  sampleInput,
  streamText,
  turns,
  toolCallCount,
  outcome,
}: LiveSamplePreviewProps) {
  const { t } = useLanguage();

  if (sampleId == null) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('eval.progress.preview.idle')}
      </p>
    );
  }

  const truncated =
    sampleInput != null ? sampleInput.slice(0, SAMPLE_INPUT_PREVIEW_CHARS) : null;
  const inputOverflow = sampleInput != null && sampleInput.length > SAMPLE_INPUT_PREVIEW_CHARS;

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-semibold text-foreground">
          {t('eval.progress.preview.sample')}: {sampleId}
        </span>
        {packId && (
          <span className="font-mono text-[11px] text-muted-foreground">{packId}</span>
        )}
        {candidateLabel && (
          <span className="text-[11px] text-muted-foreground">{candidateLabel}</span>
        )}
        {outcome && (
          <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
            {outcome}
          </span>
        )}
      </div>
      <div className="rounded-md border border-border/60 bg-card/40 p-2">
        {truncated != null ? (
          <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/90">
            {truncated}
            {inputOverflow ? '…' : ''}
          </pre>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {t('eval.progress.preview.inputUnavailable')}
          </p>
        )}
      </div>
      <div>
        <div className="mb-1 text-[11px] font-medium text-muted-foreground">
          {t('eval.progress.preview.stream')}
        </div>
        <pre className="max-h-40 min-h-8 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background p-2 font-mono text-[11px] text-foreground/90">
          {streamText || '…'}
        </pre>
      </div>
      {(turns != null || toolCallCount != null) && (
        <p className="text-[11px] text-muted-foreground">
          {t('eval.progress.preview.toolCalls', {
            n: toolCallCount ?? 0,
            t: turns ?? 0,
          })}
        </p>
      )}
    </div>
  );
}
