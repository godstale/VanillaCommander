import { describe, expect, it } from 'vitest';
import { ANCHORS_V1 } from '../constants';
import type { MetricSpec } from '../types';
import {
  categoryScoreFromMetrics,
  meanSkippingNA,
  normalizeAnchor,
  normalizeBaseline,
  normalizeMetricValue,
} from './normalize';

function identitySpec(id: string): MetricSpec {
  return {
    id,
    description: { ko: 'x', en: 'x' },
    source: 'score',
    aggregation: 'mean',
    lowerIsBetter: false,
    scoreType: 'continuous',
    range: { min: 0, max: 1 },
    normalization: { kind: 'identity' },
    countsTowardComposite: true,
  };
}

describe('normalizeBaseline', () => {
  it('maps GPQA-style raw 0.6 with baseline 0.25 to 46.67', () => {
    expect(normalizeBaseline(0.6, 0.25, { ceiling: 1 })).toBeCloseTo(46.6667, 3);
  });

  it('derives baseline from choice count', () => {
    expect(normalizeBaseline(0.6, 'auto_choices', { choiceCount: 4 })).toBeCloseTo(46.6667, 3);
    const circular = normalizeBaseline(1, 'auto_choices', { choiceCount: 4, circular: true });
    expect(circular).toBe(100);
    // circular chance level is (1/4)^4: a raw of 0.6 scores higher than non-circular
    expect(normalizeBaseline(0.6, 'auto_choices', { choiceCount: 4, circular: true })).toBeGreaterThan(59);
    expect(normalizeBaseline(0, 'auto_choices', { choiceCount: 4 })).toBe(0);
  });

  it('clamps and handles null', () => {
    expect(normalizeBaseline(2, 0.25)).toBe(100);
    expect(normalizeBaseline(-1, 0.25)).toBe(0);
    expect(normalizeBaseline(null, 0.25)).toBeNull();
  });
});

describe('normalizeAnchor', () => {
  it('maps log-up anchors end to end', () => {
    const anchor = ANCHORS_V1['decode_tps'];
    expect(normalizeAnchor(60, anchor)).toBeCloseTo(100, 10);
    expect(normalizeAnchor(3, anchor)).toBeCloseTo(0, 10);
    expect(normalizeAnchor(Math.sqrt(3 * 60), anchor)).toBeCloseTo(50, 10);
    expect(normalizeAnchor(0, anchor)).toBe(0);
  });

  it('maps log-down anchors end to end', () => {
    const anchor = ANCHORS_V1['ttft_p50_ms'];
    expect(normalizeAnchor(500, anchor)).toBeCloseTo(100, 10);
    expect(normalizeAnchor(15000, anchor)).toBeCloseTo(0, 10);
    expect(normalizeAnchor(100000, anchor)).toBe(0);
  });

  it('maps linear anchors end to end', () => {
    const anchor = ANCHORS_V1['depth_retention'];
    expect(normalizeAnchor(0.9, anchor)).toBe(100);
    expect(normalizeAnchor(0.3, anchor)).toBe(0);
    expect(normalizeAnchor(0.6, anchor)).toBeCloseTo(50, 10);
  });
});

describe('normalizeMetricValue', () => {
  it('applies S-dimension mappings', () => {
    expect(normalizeMetricValue('failure_rate', 0.1)).toBeCloseTo(90, 10);
    expect(normalizeMetricValue('format_error_rate', 0)).toBe(100);
    expect(normalizeMetricValue('pass_hat_k', 0.75)).toBeCloseTo(75, 10);
    expect(normalizeMetricValue('score_stddev', 0)).toBe(100);
    expect(normalizeMetricValue('score_stddev', 0.5)).toBe(0);
  });

  it('excludes aux metrics and maps identity specs', () => {
    expect(normalizeMetricValue('tokens_per_correct', 100)).toBeNull();
    expect(normalizeMetricValue('accuracy', 0.6, identitySpec('accuracy'))).toBeCloseTo(60, 10);
  });
});

describe('meanSkippingNA / categoryScoreFromMetrics', () => {
  it('skips N/A and returns null when all are N/A', () => {
    expect(meanSkippingNA([80, null, 60])).toBe(70);
    expect(meanSkippingNA([null, undefined])).toBeNull();
  });

  it('maps P1/S1 from available metrics only', () => {
    expect(categoryScoreFromMetrics('P1', { ttft_p50_ms: 60, load_ms: null })).toBe(60);
    expect(
      categoryScoreFromMetrics('S1', {
        format_error_rate: 100,
        failure_rate: 90,
        pass_hat_k: null,
        score_stddev: null,
      }),
    ).toBe(95);
    expect(categoryScoreFromMetrics('R1', { vram_headroom: null, gpu_offload: null })).toBeNull();
  });
});
