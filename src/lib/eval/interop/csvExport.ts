import type { EvalReportData } from '@/components/eval/report/reportData';
import { GPQA_REDACT_NOTE, isGpqaPack } from './draft';

// Flat trials+scores CSV export. The repo's sources/csv module only parses,
// so a small RFC 4180 escaper lives here. GPQA-origin rows keep ids and
// scores but ship an empty output plus a redaction note.

const CSV_HEADER = [
  'run_id',
  'candidate_label',
  'pack_id',
  'sample_id',
  'epoch',
  'outcome',
  'output_text',
  'input_tokens',
  'output_tokens',
  'total_ms',
  'scorer_key',
  'scorer_type',
  'score_value',
  'verdict',
  'reason',
  'note',
];

export function escapeCsvField(value: string): string {
  if (value === '' || !/["\n\r,]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return escapeCsvField(String(value));
}

export function buildTrialsCsv(data: EvalReportData): string {
  const runId = data.run?.id ?? '';
  const labelOf = new Map(data.candidates.map((c) => [c.id, c.label]));
  const scoresByTrial = new Map<string, typeof data.scores>();
  for (const s of data.scores) {
    const list = scoresByTrial.get(s.trialId) ?? [];
    list.push(s);
    scoresByTrial.set(s.trialId, list);
  }
  const lines: string[] = [CSV_HEADER.map(escapeCsvField).join(',')];
  for (const t of data.trials) {
    const stripped = isGpqaPack(t.packId);
    const base = [
      cell(runId),
      cell(labelOf.get(t.candidateId) ?? t.candidateId),
      cell(t.packId),
      cell(t.sampleId),
      cell(t.epoch),
      cell(t.outcome),
      cell(stripped ? '' : (t.outputText ?? '')),
      cell(t.inputTokens),
      cell(t.outputTokens),
      cell(t.totalMs),
    ];
    const note = stripped ? GPQA_REDACT_NOTE : '';
    const scores = scoresByTrial.get(t.id) ?? [];
    if (scores.length === 0) {
      lines.push([...base, '', '', '', '', '', cell(note)].join(','));
      continue;
    }
    for (const s of scores) {
      lines.push(
        [
          ...base,
          cell(s.scorerKey),
          cell(s.scorerType),
          cell(s.value),
          cell(s.verdict),
          cell(s.reason ?? ''),
          cell(note),
        ].join(','),
      );
    }
  }
  return lines.join('\n') + '\n';
}
