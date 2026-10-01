import type { EvalReportData } from '@/components/eval/report/reportData';
import type { EvalAggregateRow, MetricSpec } from '../types';
import { GPQA_REDACT_NOTE, isGpqaPack } from './draft';

// EEE (External Evaluation Exchange) bundle builder — pure, no I/O.
//
// FORMAT (mapping per Docs/plan/LLM_Evaluation_Plan.md §9.4):
// - `eval_runs.id` + candidate            -> `evaluation_id` (+ per-candidate rows)
// - app name/version, evaluator_relationship='third_party' -> `source_metadata`
// - `snapshot.model` + `model_meta`       -> `model_info`
// - snapshot temperature/topP/maxOutputTokens/reasoning -> `generation_config`
// - `eval_aggregates` (level='metric') + MetricSpec -> `evaluation_results[]`
//   (`metric_config`{lower_is_better, score_type, min/max} + `score_details` + CI)
// - `eval_trials` + `eval_scores`         -> `{runId}_samples.jsonl`
//   (input/output reference, token_usage, performance, scores)
// - `hardware` (EEE has no field)         -> `additional_details.hardware`
// - Bundle stamped `eee-0.1-fortress` in `source_metadata.format`.
// - GPQA-origin packs (pack id contains 'gpqa'): sample bodies are stripped
//   (empty input/output + redaction note); only ids and scores are exported.

export const EEE_FORMAT_VERSION = 'eee-0.1-fortress';

export interface EeeBundle {
  evaluation: Record<string, unknown>;
  samplesJsonl: string;
  evaluationFileName: string;
  samplesFileName: string;
  redactedPacks: string[];
}

function metricIdOf(key: string): string {
  const idx = key.lastIndexOf(':');
  return idx >= 0 ? key.slice(idx + 1) : key;
}

function metricConfigFor(
  metricId: string,
  specs: MetricSpec[] | undefined,
): Record<string, unknown> {
  const spec = specs?.find((s) => s.id === metricId);
  if (!spec) {
    return {
      metric_id: metricId,
      lower_is_better: false,
      score_type: 'continuous',
      min_score: 0,
      max_score: 1,
    };
  }
  return {
    metric_id: spec.id,
    lower_is_better: spec.lowerIsBetter,
    score_type: spec.scoreType,
    min_score: spec.range.min,
    max_score: spec.range.max,
  };
}

export function buildEeeBundle(
  data: EvalReportData,
  opts: { metricSpecs?: MetricSpec[]; appName?: string } = {},
): EeeBundle {
  const runId = data.run?.id ?? 'unknown-run';
  const redacted = new Set<string>();

  const modelInfo = data.candidates.map((c) => ({
    candidate_id: c.id,
    label: c.label,
    model: c.snapshot.model,
    provider: c.snapshot.provider,
    model_meta: c.modelMeta ?? {},
  }));
  const generationConfig = data.candidates.map((c) => ({
    candidate_id: c.id,
    temperature: c.snapshot.temperature,
    top_p: c.snapshot.topP ?? null,
    max_output_tokens: c.snapshot.maxOutputTokens ?? null,
    reasoning: c.snapshot.reasoning,
    seed: c.snapshot.seed ?? null,
  }));

  const metricRows = data.aggregates.filter((r) => r.level === 'metric');
  const byKey = new Map<string, EvalAggregateRow[]>();
  for (const row of metricRows) {
    const list = byKey.get(row.key) ?? [];
    list.push(row);
    byKey.set(row.key, list);
  }
  const evaluationResults = [...byKey.entries()].map(([key, rows]) => {
    const metricId = metricIdOf(key);
    return {
      key,
      metric_config: metricConfigFor(metricId, opts.metricSpecs),
      score_details: rows.map((r) => ({
        candidate_id: r.candidateId,
        score: r.raw ?? r.normalized,
        normalized: r.normalized,
        ci_low: r.ciLow,
        ci_high: r.ciHigh,
        n: r.n,
      })),
    };
  });

  const scoresByTrial = new Map<string, typeof data.scores>();
  for (const s of data.scores) {
    const list = scoresByTrial.get(s.trialId) ?? [];
    list.push(s);
    scoresByTrial.set(s.trialId, list);
  }
  const candidateLabel = new Map(data.candidates.map((c) => [c.id, c.label]));

  const sampleLines = data.trials.map((t) => {
    const stripped = isGpqaPack(t.packId);
    if (stripped) redacted.add(t.packId);
    const row: Record<string, unknown> = {
      trial_id: t.id,
      candidate_id: t.candidateId,
      candidate_label: candidateLabel.get(t.candidateId) ?? t.candidateId,
      pack_id: t.packId,
      sample_id: t.sampleId,
      epoch: t.epoch,
      outcome: t.outcome,
      input: stripped ? '' : `${t.packId}/${t.sampleId}`,
      output: stripped ? '' : (t.outputText ?? ''),
      token_usage: {
        input_tokens: t.inputTokens,
        output_tokens: t.outputTokens,
        thinking_tokens: t.thinkingTokens,
      },
      performance: {
        ttft_ms: t.ttftMs,
        prefill_tps: t.prefillTps,
        decode_tps: t.decodeTps,
        total_ms: t.totalMs,
      },
      scores: (scoresByTrial.get(t.id) ?? []).map((s) => ({
        scorer_key: s.scorerKey,
        scorer_type: s.scorerType,
        value: s.value,
        verdict: s.verdict,
        reason: s.reason,
        source: s.source,
      })),
    };
    if (stripped) {
      row.redacted = 'gpqa';
      row.redact_note = GPQA_REDACT_NOTE;
    }
    return JSON.stringify(row);
  });

  const evaluation: Record<string, unknown> = {
    evaluation_id: runId,
    format: EEE_FORMAT_VERSION,
    source_metadata: {
      app: opts.appName ?? 'fortress',
      version: data.run?.hardware.appVersion ?? 'unknown',
      evaluator_relationship: 'third_party',
      format: EEE_FORMAT_VERSION,
    },
    model_info: modelInfo,
    generation_config: generationConfig,
    evaluation_results: evaluationResults,
    additional_details: {
      hardware: data.run?.hardware ?? null,
      profile: data.run?.config.profile ?? null,
      packs: data.run?.config.packs ?? [],
    },
  };

  return {
    evaluation,
    samplesJsonl: sampleLines.length > 0 ? sampleLines.join('\n') + '\n' : '',
    evaluationFileName: `${runId}.eee.json`,
    samplesFileName: `${runId}_samples.jsonl`,
    redactedPacks: [...redacted],
  };
}
