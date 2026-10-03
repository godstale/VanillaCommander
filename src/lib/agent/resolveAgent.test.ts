import { describe, it, expect } from 'vitest';
import {
  buildCandidates,
  isExternalAgentConfig,
  pickBackgroundAgent,
} from './resolveAgent';
import type { Agent } from '@/lib/types/agent';
import { DEFAULT_AGENT } from '@/lib/agent/defaultAgent';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    ...DEFAULT_AGENT,
    id: `agent-${Math.random().toString(36).slice(2)}`,
    name: 'Test',
    ...overrides,
  };
}

describe('isExternalAgentConfig', () => {
  it('flags cloud and external-agent providers only', () => {
    expect(isExternalAgentConfig(makeAgent({ llmProvider: 'ollama' }))).toBe(false);
    expect(isExternalAgentConfig(makeAgent({ llmProvider: 'lmstudio' }))).toBe(false);
    expect(isExternalAgentConfig(makeAgent({ llmProvider: 'openai' }))).toBe(true);
    expect(isExternalAgentConfig(makeAgent({ llmProvider: 'openrouter' }))).toBe(true);
    expect(isExternalAgentConfig(makeAgent({ llmProvider: 'external-agent' }))).toBe(true);
  });
});

describe('buildCandidates', () => {
  it('excludes the failed agent and marks external ones', () => {
    const local = makeAgent({ id: 'a', llmProvider: 'ollama' });
    const cloud = makeAgent({ id: 'b', llmProvider: 'openai' });
    const out = buildCandidates([local, cloud], { a: 'connected', b: 'disconnected' }, 'failed');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ status: 'connected', external: false });
    expect(out[1]).toMatchObject({ status: 'disconnected', external: true });
  });
});

describe('pickBackgroundAgent', () => {
  it('prefers the healthy default local agent, never external', () => {
    const def = makeAgent({ id: 'def', isDefault: true, llmProvider: 'ollama' });
    const ext = makeAgent({ id: 'ext', llmProvider: 'external-agent' });
    expect(pickBackgroundAgent([ext, def], { def: 'connected', ext: 'connected' })?.id).toBe('def');
    // 외부만 살아 있어도 선택하지 않는다 (무단 외부 전송 방지).
    expect(pickBackgroundAgent([ext], { ext: 'connected' })).toBeNull();
    expect(pickBackgroundAgent([def], { def: 'disconnected' })).toBeNull();
  });
});
