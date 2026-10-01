import { describe, it, expect } from 'vitest';
import {
  getSessionGroupKey,
  groupSessions,
  UNKNOWN_GROUP_SEGMENT,
} from './sessionGroups';
import type { Agent } from '@/lib/types/agent';
import type { ChatSession } from '@/lib/types/chat';

function makeAgent(overrides: Partial<Agent> & { id: string }): Agent {
  return {
    name: 'agent',
    systemPrompt: 'prompt',
    model: 'llama3.1:8b',
    temperature: 0.7,
    contextSize: 8192,
    reserveTokens: 0,
    keepRecentTokens: 0,
    enabledSkills: [],
    enabledBuiltinTools: [],
    approvalMode: 'dangerous-only',
    isDefault: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSession(
  id: string,
  agentId: string,
  updatedAt: string,
): ChatSession {
  return {
    id,
    agentId,
    workspaceRoot: null,
    title: id,
    createdAt: updatedAt,
    updatedAt,
  };
}

const agents = new Map<string, Agent>([
  [
    'a1',
    makeAgent({
      id: 'a1',
      name: 'Coder',
      model: 'qwen3:8b',
      llmProvider: 'ollama',
    }),
  ],
  [
    'a2',
    makeAgent({
      id: 'a2',
      name: 'Writer',
      model: 'gpt-oss:20b',
      llmProvider: 'vllm',
    }),
  ],
]);

const getAgent = (id: string) => agents.get(id);

describe('getSessionGroupKey', () => {
  const session = makeSession('s1', 'a1', '2026-09-25T00:00:00.000Z');

  it('groups by agent id', () => {
    expect(getSessionGroupKey(session, 'agent', getAgent)).toBe('agent:a1');
  });

  it('groups by provider', () => {
    expect(getSessionGroupKey(session, 'provider', getAgent)).toBe(
      'provider:ollama',
    );
  });

  it('groups by model', () => {
    expect(getSessionGroupKey(session, 'model', getAgent)).toBe(
      'model:qwen3:8b',
    );
  });

  it('falls back to the unknown segment when the agent is gone', () => {
    const deleted = makeSession('s9', 'deleted-id', '2026-09-25T00:00:00.000Z');
    expect(getSessionGroupKey(deleted, 'agent', getAgent)).toBe(
      'agent:deleted-id',
    );
    expect(getSessionGroupKey(deleted, 'provider', getAgent)).toBe(
      `provider:${UNKNOWN_GROUP_SEGMENT}`,
    );
    expect(getSessionGroupKey(deleted, 'model', getAgent)).toBe(
      `model:${UNKNOWN_GROUP_SEGMENT}`,
    );
  });
});

describe('groupSessions', () => {
  const sessions = [
    makeSession('s1', 'a1', '2026-09-25T03:00:00.000Z'),
    makeSession('s2', 'a2', '2026-09-25T02:00:00.000Z'),
    makeSession('s3', 'a1', '2026-09-25T01:00:00.000Z'),
    makeSession('s4', 'deleted-id', '2026-09-25T04:00:00.000Z'),
  ];

  it('groups by agent and orders groups by latest session', () => {
    const groups = groupSessions(sessions, 'agent', getAgent);
    expect(groups.map((g) => g.key)).toEqual([
      'agent:deleted-id',
      'agent:a1',
      'agent:a2',
    ]);
    expect(groups[1]?.sessions.map((s) => s.id)).toEqual(['s1', 's3']);
  });

  it('groups sessions sharing a model into one group', () => {
    const sameModel = makeAgent({
      id: 'a3',
      name: 'Coder2',
      model: 'qwen3:8b',
      llmProvider: 'lmstudio',
    });
    const lookup = (id: string) =>
      id === 'a3' ? sameModel : getAgent(id);
    const groups = groupSessions(
      [sessions[0]!, { ...sessions[1]!, agentId: 'a3' }],
      'model',
      lookup,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('model:qwen3:8b');
  });

  it('keeps sessions time-ordered within a group', () => {
    const shuffled = [sessions[2]!, sessions[0]!];
    const groups = groupSessions(shuffled, 'agent', getAgent);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(['s1', 's3']);
  });
});
