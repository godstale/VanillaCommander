import { describe, it, expect } from 'vitest';
import {
  formatGenerationParamValue,
  isGenerationParamSupported,
  normalizeGenerationParams,
  supportsEffortLevels,
  toOllamaOptions,
  toOpenAiParams,
  unsupportedGenerationParams,
} from './generationParams';

describe('isGenerationParamSupported', () => {
  it('supports shared params on both providers', () => {
    for (const key of ['topP', 'seed', 'stopSequences', 'maxOutputTokens'] as const) {
      expect(isGenerationParamSupported(key, 'ollama')).toBe(true);
      expect(isGenerationParamSupported(key, 'openai')).toBe(true);
      expect(isGenerationParamSupported(key, 'lmstudio')).toBe(true);
    }
  });

  it('restricts topK/repeatPenalty to Ollama', () => {
    expect(isGenerationParamSupported('topK', 'ollama')).toBe(true);
    expect(isGenerationParamSupported('topK', 'openai')).toBe(false);
    expect(isGenerationParamSupported('topK', 'vllm')).toBe(false);
    expect(isGenerationParamSupported('repeatPenalty', 'ollama')).toBe(true);
    expect(isGenerationParamSupported('repeatPenalty', 'jan')).toBe(false);
  });

  it('restricts frequency/presence penalties to OpenAI-compatible', () => {
    expect(isGenerationParamSupported('frequencyPenalty', 'openai')).toBe(true);
    expect(isGenerationParamSupported('frequencyPenalty', 'ollama')).toBe(false);
    expect(isGenerationParamSupported('presencePenalty', 'llamacpp')).toBe(true);
    expect(isGenerationParamSupported('presencePenalty', 'ollama')).toBe(false);
  });

  it('lists unsupported params per provider', () => {
    expect(unsupportedGenerationParams('ollama')).toEqual([
      'frequencyPenalty',
      'presencePenalty',
    ]);
    expect(unsupportedGenerationParams('openai')).toEqual(['topK', 'repeatPenalty']);
  });
});

describe('normalizeGenerationParams', () => {
  it('returns empty for blank input', () => {
    expect(normalizeGenerationParams({})).toEqual({});
  });

  it('clamps out-of-range values', () => {
    const out = normalizeGenerationParams({
      topP: 5,
      topK: 0.4,
      repeatPenalty: 9,
      frequencyPenalty: -9,
      presencePenalty: 9,
      maxOutputTokens: 1e9,
    });
    expect(out.topP).toBe(1);
    expect(out.topK).toBe(1);
    expect(out.repeatPenalty).toBe(2);
    expect(out.frequencyPenalty).toBe(-2);
    expect(out.presencePenalty).toBe(2);
    expect(out.maxOutputTokens).toBe(131072);
  });

  it('drops NaN/Infinity and empty stops', () => {
    const out = normalizeGenerationParams({
      topP: NaN,
      seed: Infinity,
      stopSequences: ['  ', '', '###'],
    });
    expect(out.topP).toBeUndefined();
    expect(out.seed).toBeUndefined();
    expect(out.stopSequences).toEqual(['###']);
  });

  it('floors seed and caps stop count', () => {
    const out = normalizeGenerationParams({
      seed: 3.7,
      stopSequences: Array.from({ length: 20 }, (_, i) => `s${i}`),
    });
    expect(out.seed).toBe(3);
    expect(out.stopSequences).toHaveLength(16);
  });
});

describe('provider payload mapping', () => {
  it('maps to Ollama options keys', () => {
    expect(
      toOllamaOptions({ topP: 0.9, topK: 40, repeatPenalty: 1.1, maxOutputTokens: 512 }),
    ).toEqual({ top_p: 0.9, top_k: 40, repeat_penalty: 1.1, num_predict: 512 });
  });

  it('maps to OpenAI-compatible body keys', () => {
    expect(
      toOpenAiParams({ topP: 0.9, frequencyPenalty: 0.3, seed: 7, maxOutputTokens: 512 }),
    ).toEqual({
      top_p: 0.9,
      frequency_penalty: 0.3,
      seed: 7,
      max_tokens: 512,
    });
  });

  it('omits unset params', () => {
    expect(toOllamaOptions({})).toEqual({});
    expect(toOpenAiParams({})).toEqual({});
  });
});

describe('supportsEffortLevels', () => {
  it('returns true when capability is unknown', () => {
    expect(supportsEffortLevels(undefined)).toBe(true);
  });

  it('returns false for boolean-only thinking values', () => {
    expect(supportsEffortLevels({ values: [true, false] })).toBe(false);
    expect(supportsEffortLevels({ values: [false] })).toBe(false);
  });

  it('returns true when level strings exist', () => {
    expect(supportsEffortLevels({ values: [false, 'low', 'medium', 'high'] })).toBe(true);
  });
});

describe('formatGenerationParamValue', () => {
  it('shows auto for unset values', () => {
    expect(formatGenerationParamValue('topP', {})).toBe('auto');
    expect(formatGenerationParamValue('stopSequences', {})).toBe('auto');
  });

  it('formats set values', () => {
    expect(formatGenerationParamValue('seed', { seed: 42 })).toBe('42');
    expect(formatGenerationParamValue('stopSequences', { stopSequences: ['a', 'b'] })).toBe(
      'a, b',
    );
  });
});
