import { describe, it, expect } from 'vitest';
import {
  captureChatConfigSnapshot,
  chatConfigSignature,
  isAutoMonitorEnabled,
  resolveThinkValue,
} from './agent';
import type { Agent } from './agent';
import { DEFAULT_AGENT } from '@/lib/agent/defaultAgent';

describe('resolveThinkValue', () => {
  it('returns undefined (omit think) for model default', () => {
    expect(resolveThinkValue(undefined, undefined)).toBeUndefined();
    expect(resolveThinkValue('default', 'high')).toBeUndefined();
  });

  it('returns false when reasoning is off', () => {
    expect(resolveThinkValue('off', undefined)).toBe(false);
    expect(resolveThinkValue('off', 'high')).toBe(false);
  });

  it('returns the effort level when reasoning is on', () => {
    expect(resolveThinkValue('on', undefined)).toBe('medium');
    expect(resolveThinkValue('on', 'low')).toBe('low');
    expect(resolveThinkValue('on', 'medium')).toBe('medium');
    expect(resolveThinkValue('on', 'high')).toBe('high');
  });
});

describe('isAutoMonitorEnabled', () => {
  it('defaults to on when unset (legacy agents)', () => {
    expect(isAutoMonitorEnabled(undefined)).toBe(true);
    expect(isAutoMonitorEnabled(null)).toBe(true);
    const legacy = { ...DEFAULT_AGENT, autoMonitor: undefined } as Agent;
    expect(isAutoMonitorEnabled(legacy)).toBe(true);
  });

  it('respects the explicit on/off setting', () => {
    expect(isAutoMonitorEnabled({ ...DEFAULT_AGENT, autoMonitor: true })).toBe(true);
    expect(isAutoMonitorEnabled({ ...DEFAULT_AGENT, autoMonitor: false })).toBe(false);
  });
});

describe('captureChatConfigSnapshot (P9-06)', () => {
  it('captures agent defaults when no override is given', () => {
    const snapshot = captureChatConfigSnapshot(DEFAULT_AGENT);
    expect(snapshot.agentName).toBe(DEFAULT_AGENT.name);
    expect(snapshot.model).toBe(DEFAULT_AGENT.model);
    expect(snapshot.temperature).toBe(DEFAULT_AGENT.temperature);
    expect(snapshot.contextSize).toBe(DEFAULT_AGENT.contextSize);
    expect(snapshot.reasoning).toBe('default');
    expect(snapshot.reasoningEffort).toBe('medium');
    expect(snapshot.llmProvider).toBe('ollama');
  });

  it('prefers session overrides and an explicit effective think value', () => {
    const snapshot = captureChatConfigSnapshot(
      DEFAULT_AGENT,
      { reasoning: 'on', effort: 'high' },
      'high',
    );
    expect(snapshot.reasoning).toBe('on');
    expect(snapshot.reasoningEffort).toBe('high');
    expect(snapshot.think).toBe('high');
  });

  it('falls back to model defaults for legacy agents', () => {
    const legacy = { ...DEFAULT_AGENT, reasoning: undefined, reasoningEffort: undefined } as Agent;
    const snapshot = captureChatConfigSnapshot(legacy);
    expect(snapshot.reasoning).toBe('default');
    expect(snapshot.reasoningEffort).toBe('medium');
    expect(snapshot.think).toBeUndefined();
  });

  it('produces a stable signature that changes with settings', () => {
    const base = captureChatConfigSnapshot(DEFAULT_AGENT);
    const same = captureChatConfigSnapshot(DEFAULT_AGENT);
    expect(chatConfigSignature(same)).toBe(chatConfigSignature(base));

    const changed = captureChatConfigSnapshot(DEFAULT_AGENT, { reasoning: 'off' }, false);
    expect(chatConfigSignature(changed)).not.toBe(chatConfigSignature(base));
  });

  it('captures generation params and tracks them in the signature', () => {
    const withParams = captureChatConfigSnapshot({
      ...DEFAULT_AGENT,
      topP: 0.8,
      topK: 20,
      repeatPenalty: 1.2,
      frequencyPenalty: 0.3,
      presencePenalty: -0.2,
      seed: 42,
      stopSequences: ['###'],
      maxOutputTokens: 1024,
    });
    expect(withParams.topP).toBe(0.8);
    expect(withParams.seed).toBe(42);
    expect(withParams.stopSequences).toEqual(['###']);
    expect(withParams.maxOutputTokens).toBe(1024);
    expect(chatConfigSignature(withParams)).not.toBe(
      chatConfigSignature(captureChatConfigSnapshot(DEFAULT_AGENT)),
    );
  });
});
