import { describe, it, expect, beforeEach } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import {
  saveMonitoringSnapshot,
  getMonitoringSnapshots,
  getRecentMonitoringSnapshots,
  clearMonitoringSnapshots,
  getMonitoringSummary,
  getMonitoringAgentStats,
  pruneOldMonitoringSnapshots,
  saveConversationSummary,
  getConversationSummaries,
  clearConversationSummaries,
  listRecentMonitoringSnapshots,
  deleteMonitoringSnapshot,
  clearAllMonitoringSnapshots,
  clearAllConversationSummaries,
} from './monitoringRepo';
import type { AgentMonitoringSnapshot, ConversationTokenSummary } from '@/lib/types/monitoring';
import { emptyStatusTokens } from '@/lib/types/monitoring';

describe('monitoringRepo', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
  });

  const sampleSnapshot: AgentMonitoringSnapshot = {
    id: 'snap-1',
    agentId: 'agent-1',
    timestamp: new Date().toISOString(),
    gpuName: 'NVIDIA GeForce RTX 4070 SUPER',
    gpuVramTotalMb: 12282,
    gpuVramUsedMb: 4096,
    gpuVramFreeMb: 8186,
    gpuUtilizationPct: 25.5,
    gpuTemperatureC: 48.0,
    systemMemoryTotalMb: 32768,
    systemMemoryFreeMb: 16384,
    llmModel: 'granite4.1:8b',
    llmArchitecture: 'granite',
    llmParameterSize: '8.8B',
    contextSize: 8192,
    contextLimit: 131072,
    modelWeightBytes: 5347933017,
    vramAllocatedBytes: 5347933017,
    kvCacheBytes: 268435456,
    gpuOffloadPct: 100,
    agentStatus: 'idle',
    currentTask: '대기 중 (유휴 상태)',
    prefillTokens: 120,
    prefillDurationMs: 450,
    prefillSpeed: 266.7,
    decodingTokens: 80,
    decodingDurationMs: 2100,
    decodingSpeed: 38.1,
    totalDurationMs: 2550,
    thinkingTokens: 12,
    conversationId: 'conv-agent-1-abc',
    conversationSeq: 3,
    details: { blockCount: 40 },
    createdAt: new Date().toISOString(),
  };

  it('saves and retrieves monitoring snapshots', async () => {
    await saveMonitoringSnapshot(sampleSnapshot);

    const snapshots = await getMonitoringSnapshots('agent-1');
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].id).toBe('snap-1');
    expect(snapshots[0].gpuName).toBe('NVIDIA GeForce RTX 4070 SUPER');
    expect(snapshots[0].gpuUtilizationPct).toBe(25.5);
    expect(snapshots[0].llmModel).toBe('granite4.1:8b');
    expect(snapshots[0].prefillSpeed).toBe(266.7);
    expect(snapshots[0].decodingSpeed).toBe(38.1);
    expect(snapshots[0].prefillDurationMs).toBe(450);
    expect(snapshots[0].decodingDurationMs).toBe(2100);
    expect(snapshots[0].details).toEqual({ blockCount: 40 });
    expect(snapshots[0].thinkingTokens).toBe(12);
    expect(snapshots[0].conversationId).toBe('conv-agent-1-abc');
    expect(snapshots[0].conversationSeq).toBe(3);
  });

  it('filters recent snapshots within specified time window', async () => {
    await saveMonitoringSnapshot(sampleSnapshot);

    const recent = await getRecentMonitoringSnapshots('agent-1', 10);
    expect(recent.length).toBe(1);

    const emptyForOtherAgent = await getRecentMonitoringSnapshots('other-agent', 10);
    expect(emptyForOtherAgent.length).toBe(0);
  });

  it('clears snapshots for specific agent', async () => {
    await saveMonitoringSnapshot(sampleSnapshot);
    await clearMonitoringSnapshots('agent-1');

    const snapshots = await getMonitoringSnapshots('agent-1');
    expect(snapshots.length).toBe(0);
  });

  it('calculates monitoring summary properly', async () => {
    await saveMonitoringSnapshot(sampleSnapshot);
    await saveMonitoringSnapshot({
      ...sampleSnapshot,
      id: 'snap-2',
      timestamp: new Date(Date.now() + 3000).toISOString(),
      gpuUtilizationPct: 50.0,
      gpuVramUsedMb: 6000,
    });

    const summary = await getMonitoringSummary('agent-1');
    expect(summary.totalSnapshots).toBe(2);
    expect(summary.avgGpuUtilization).toBe(37.8);
    expect(summary.peakVramUsedMb).toBe(6000);
    expect(summary.latestGpuName).toBe('NVIDIA GeForce RTX 4070 SUPER');
  });

  it('prunes old snapshots exceeding maximum keep count and expired age', async () => {
    // Save 5 snapshots with ascending timestamps
    for (let i = 1; i <= 5; i++) {
      await saveMonitoringSnapshot({
        ...sampleSnapshot,
        id: `snap-${i}`,
        timestamp: new Date(Date.now() - (6 - i) * 1000).toISOString(),
      });
    }

    const before = await getMonitoringSnapshots('agent-1', 10);
    expect(before.length).toBe(5);

    // Prune to keep max 3
    const pruned = await pruneOldMonitoringSnapshots('agent-1', { maxKeep: 3 });
    expect(pruned).toBe(2);

    const after = await getMonitoringSnapshots('agent-1', 10);
    expect(after.length).toBe(3);
    expect(after.map((s) => s.id)).toEqual(['snap-5', 'snap-4', 'snap-3']);
  });

  it('saves and retrieves conversation token summaries', async () => {
    const summary: ConversationTokenSummary = {
      id: 'conv-agent-1-1',
      agentId: 'agent-1',
      sessionId: 'session-1',
      seq: 1,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      endedAt: new Date().toISOString(),
      turnCount: 2,
      inputTokens: 300,
      outputTokens: 90,
      totalTokens: 390,
      thinkingTokens: 20,
      contentTokens: 70,
      statusTokens: {
        ...emptyStatusTokens(),
        prefill: 300,
        thinking: 20,
        decoding: 70,
      },
    };
    await saveConversationSummary(summary);

    const rows = await getConversationSummaries('agent-1');
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('conv-agent-1-1');
    expect(rows[0].seq).toBe(1);
    expect(rows[0].turnCount).toBe(2);
    expect(rows[0].inputTokens).toBe(300);
    expect(rows[0].outputTokens).toBe(90);
    expect(rows[0].totalTokens).toBe(390);
    expect(rows[0].thinkingTokens).toBe(20);
    expect(rows[0].statusTokens.prefill).toBe(300);
    expect(rows[0].statusTokens.decoding).toBe(70);

    const emptyForOther = await getConversationSummaries('other-agent');
    expect(emptyForOther.length).toBe(0);

    await clearConversationSummaries('agent-1');
    expect(await getConversationSummaries('agent-1')).toHaveLength(0);
  });

  it('lists snapshots across agents and deletes a single record', async () => {
    await saveMonitoringSnapshot(sampleSnapshot);
    await saveMonitoringSnapshot({
      ...sampleSnapshot,
      id: 'snap-2',
      agentId: 'agent-2',
      timestamp: new Date(Date.now() + 1000).toISOString(),
    });

    const all = await listRecentMonitoringSnapshots(10);
    expect(all.map((s) => s.id)).toEqual(['snap-2', 'snap-1']);

    // 단일 삭제는 해당 기록만 지우고 다른 에이전트 기록은 유지한다.
    await deleteMonitoringSnapshot('snap-2');
    expect(await listRecentMonitoringSnapshots(10)).toHaveLength(1);
    expect(await getMonitoringSnapshots('agent-1')).toHaveLength(1);
    expect(await getMonitoringSnapshots('agent-2')).toHaveLength(0);
  });

  it('aggregates per-agent stats across the full history', async () => {
    const ts1 = new Date(Date.now() - 2000).toISOString();
    const ts2 = new Date(Date.now() - 1000).toISOString();
    const ts3 = new Date().toISOString();
    await saveMonitoringSnapshot({ ...sampleSnapshot, timestamp: ts1 });
    await saveMonitoringSnapshot({
      ...sampleSnapshot,
      id: 'snap-2',
      agentId: 'agent-2',
      timestamp: ts2,
    });
    await saveMonitoringSnapshot({ ...sampleSnapshot, id: 'snap-3', timestamp: ts3 });

    const stats = await getMonitoringAgentStats();
    expect(stats).toHaveLength(2);
    // 최신 스냅샷 순으로 정렬된다.
    expect(stats.map((s) => s.agentId)).toEqual(['agent-1', 'agent-2']);
    expect(stats[0]).toEqual({ agentId: 'agent-1', count: 2, latestTimestamp: ts3 });
    expect(stats[1]).toEqual({ agentId: 'agent-2', count: 1, latestTimestamp: ts2 });
  });

  it('clears all monitoring snapshots and conversation summaries', async () => {
    await saveMonitoringSnapshot(sampleSnapshot);
    await saveConversationSummary({
      id: 'conv-agent-1-1',
      agentId: 'agent-1',
      sessionId: 'session-1',
      seq: 1,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      endedAt: new Date().toISOString(),
      turnCount: 1,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      thinkingTokens: 1,
      contentTokens: 4,
      statusTokens: emptyStatusTokens(),
    });

    await clearAllMonitoringSnapshots();
    await clearAllConversationSummaries();
    expect(await listRecentMonitoringSnapshots(10)).toHaveLength(0);
    expect(await getConversationSummaries('agent-1')).toHaveLength(0);
  });
});
