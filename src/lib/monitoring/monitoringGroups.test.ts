import { describe, it, expect } from 'vitest';
import {
  groupMonitoringSnapshots,
  getMonitoringGroupKey,
} from './monitoringGroups';
import type { Agent } from '@/lib/types/agent';
import type { AgentMonitoringSnapshot } from '@/lib/types/monitoring';

function makeSnapshot(
  overrides: Partial<AgentMonitoringSnapshot> & { id: string },
): AgentMonitoringSnapshot {
  return {
    agentId: 'agent-1',
    timestamp: new Date().toISOString(),
    gpuName: 'Test GPU',
    gpuVramTotalMb: 8192,
    gpuVramUsedMb: 1024,
    gpuVramFreeMb: 7168,
    gpuUtilizationPct: 10,
    gpuTemperatureC: 50,
    systemMemoryTotalMb: 16384,
    systemMemoryFreeMb: 8192,
    llmModel: 'qwen3.5:9b',
    llmArchitecture: 'qwen',
    llmParameterSize: '9B',
    contextSize: 4096,
    contextLimit: 8192,
    modelWeightBytes: 1000,
    vramAllocatedBytes: 1000,
    kvCacheBytes: 100,
    gpuOffloadPct: 100,
    agentStatus: 'idle',
    currentTask: '',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const knownAgent = {
  id: 'agent-1',
  llmProvider: 'ollama',
  model: 'qwen3.5:9b',
} as Agent;

function getAgent(id: string): Agent | undefined {
  return id === 'agent-1' ? knownAgent : undefined;
}

describe('monitoringGroups', () => {
  it('groups by stable agent id even when the agent was deleted', () => {
    const snapshots = [
      makeSnapshot({ id: 's1', agentId: 'deleted-1', timestamp: '2026-09-25T10:00:00.000Z' }),
      makeSnapshot({ id: 's2', agentId: 'deleted-1', timestamp: '2026-09-25T11:00:00.000Z' }),
    ];
    const groups = groupMonitoringSnapshots(
      snapshots,
      'agent',
      () => undefined,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('agent:deleted-1');
    // 그룹 내부는 timestamp 내림차순이다.
    expect(groups[0].snapshots[0].id).toBe('s2');
  });

  it('falls back to unknown segment for provider/model when agent is gone', () => {
    const snapshots = [
      makeSnapshot({ id: 's1', agentId: 'deleted-1', llmModel: '' }),
    ];
    expect(
      getMonitoringGroupKey(snapshots[0], 'provider', () => undefined),
    ).toBe('provider:__unknown__');
    expect(
      getMonitoringGroupKey(snapshots[0], 'model', () => undefined),
    ).toBe('model:__unknown__');
  });

  it('orders groups by latest snapshot timestamp desc', () => {
    const snapshots = [
      makeSnapshot({ id: 's1', agentId: 'agent-1', timestamp: '2026-09-25T09:00:00.000Z' }),
      makeSnapshot({ id: 's2', agentId: 'agent-2', timestamp: '2026-09-25T12:00:00.000Z' }),
    ];
    const groups = groupMonitoringSnapshots(snapshots, 'agent', getAgent);
    expect(groups[0].key).toBe('agent:agent-2');
    expect(groups[1].key).toBe('agent:agent-1');
  });
});
