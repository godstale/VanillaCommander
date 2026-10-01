import { describe, expect, it } from 'vitest';
import { buildEeeBundle, EEE_FORMAT_VERSION } from './eeeExport';
import { makeAggregate, makeReportData, makeScore, makeTrial } from './testReportData';

describe('buildEeeBundle', () => {
  it('builds the EEE shape with version stamp and mapping fields', () => {
    const bundle = buildEeeBundle(makeReportData(), {
      metricSpecs: [
        {
          id: 'accuracy',
          description: { ko: '정확도', en: 'Accuracy' },
          source: 'score',
          aggregation: 'mean',
          lowerIsBetter: false,
          scoreType: 'binary',
          range: { min: 0, max: 1 },
          normalization: { kind: 'baseline', baseline: 0, ceiling: 1 },
          countsTowardComposite: true,
        },
      ],
    });
    expect(bundle.evaluationFileName).toBe('run-1.eee.json');
    expect(bundle.samplesFileName).toBe('run-1_samples.jsonl');
    const evaluation = bundle.evaluation as {
      evaluation_id: string;
      source_metadata: Record<string, unknown>;
      model_info: Array<Record<string, unknown>>;
      generation_config: Array<Record<string, unknown>>;
      evaluation_results: Array<{
        metric_config: Record<string, unknown>;
        score_details: Array<Record<string, unknown>>;
      }>;
      additional_details: Record<string, unknown>;
    };
    expect(evaluation.evaluation_id).toBe('run-1');
    expect(evaluation.source_metadata).toMatchObject({
      app: 'fortress',
      version: '0.1.0',
      evaluator_relationship: 'third_party',
      format: EEE_FORMAT_VERSION,
    });
    expect(evaluation.model_info[0]).toMatchObject({ model: 'qwen3:8b' });
    expect(evaluation.model_info[0].model_meta).toEqual({ quantization: 'Q4_K_M' });
    expect(evaluation.generation_config[0]).toMatchObject({
      temperature: 0.2,
      top_p: 0.9,
      max_output_tokens: 512,
      reasoning: 'off',
    });
    expect(evaluation.evaluation_results).toHaveLength(1);
    expect(evaluation.evaluation_results[0].metric_config).toMatchObject({
      lower_is_better: false,
      score_type: 'binary',
      min_score: 0,
      max_score: 1,
    });
    expect(evaluation.evaluation_results[0].score_details[0]).toMatchObject({
      candidate_id: 'cand-a',
      score: 0.8,
      ci_low: 70,
      ci_high: 80,
      n: 50,
    });
    expect(evaluation.additional_details.hardware).toMatchObject({ gpuName: 'Test GPU' });

    const rows = bundle.samplesJsonl.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      trial_id: 't1',
      pack_id: 'demo-pack',
      output: 'answer text',
    });
    expect(rows[0].token_usage).toMatchObject({ input_tokens: 100, output_tokens: 20 });
    expect(rows[0].performance).toMatchObject({ ttft_ms: 300, decode_tps: 40 });
    expect((rows[0].scores as unknown[])).toHaveLength(1);
  });

  it('strips GPQA-origin sample bodies but keeps ids and scores', () => {
    const data = makeReportData();
    data.trials = [
      makeTrial({ id: 't1', candidateId: 'cand-a', packId: 'GPQA-Main', outputText: 'secret answer' }),
      makeTrial({ id: 't2', candidateId: 'cand-a', packId: 'demo-pack', outputText: 'public' }),
    ];
    data.scores = [
      makeScore({ id: 's1', trialId: 't1', value: 1 }),
      makeScore({ id: 's2', trialId: 't2', value: 0 }),
    ];
    const bundle = buildEeeBundle(data);
    expect(bundle.redactedPacks).toEqual(['GPQA-Main']);
    const rows = bundle.samplesJsonl.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(rows[0].input).toBe('');
    expect(rows[0].output).toBe('');
    expect(rows[0].redacted).toBe('gpqa');
    expect((rows[0].scores as unknown[])).toHaveLength(1);
    expect(rows[1].output).toBe('public');
  });

  it('handles missing run and per-pack metric keys', () => {
    const data = makeReportData();
    data.run = null;
    data.aggregates = [
      makeAggregate({ candidateId: 'cand-a', key: 'demo-pack:decode_tps', raw: 40, normalized: 60, ciLow: null, ciHigh: null, n: 8 }),
    ];
    const bundle = buildEeeBundle(data);
    const evaluation = bundle.evaluation as {
      evaluation_id: string;
      source_metadata: Record<string, unknown>;
      evaluation_results: Array<{ metric_config: Record<string, unknown> }>;
    };
    expect(evaluation.evaluation_id).toBe('unknown-run');
    expect(evaluation.source_metadata.version).toBe('unknown');
    expect(evaluation.evaluation_results[0].metric_config.metric_id).toBe('decode_tps');
  });
});
