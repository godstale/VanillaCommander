import type { Agent } from '@/lib/types/agent';
import type { AgentMonitoringSnapshot } from '@/lib/types/monitoring';

export type MonitoringFilterMode = 'all' | 'agent' | 'provider' | 'model' | 'status';

/** 에이전트 설정을 알 수 없을 때(삭제됨) 사용하는 그룹 키 조각 */
export const UNKNOWN_MONITOR_SEGMENT = '__unknown__';

export interface MonitoringGroup {
  key: string;
  snapshots: AgentMonitoringSnapshot[];
}

function compareByTimestampDesc(
  a: AgentMonitoringSnapshot,
  b: AgentMonitoringSnapshot,
): number {
  return b.timestamp.localeCompare(a.timestamp);
}

/**
 * 스냅샷이 속한 그룹 키를 구한다.
 * - agent: `agent:${agentId}` (삭제 여부와 무관하게 안정적)
 * - provider: `provider:${llmProvider ?? __unknown__}`
 * - model: `model:${llmModel || __unknown__}`
 * - status: `status:${agentStatus}`
 */
export function getMonitoringGroupKey(
  snapshot: AgentMonitoringSnapshot,
  mode: Exclude<MonitoringFilterMode, 'all'>,
  getAgent: (id: string) => Agent | undefined,
): string {
  if (mode === 'agent') {
    return `agent:${snapshot.agentId}`;
  }
  if (mode === 'status') {
    return `status:${snapshot.agentStatus ?? 'unknown'}`;
  }
  const agent = getAgent(snapshot.agentId);
  if (mode === 'provider') {
    return `provider:${agent?.llmProvider ?? UNKNOWN_MONITOR_SEGMENT}`;
  }
  const model = snapshot.llmModel || agent?.model || UNKNOWN_MONITOR_SEGMENT;
  return `model:${model}`;
}

/**
 * 스냅샷 목록을 그룹 키별로 묶는다. 그룹 내부는 timestamp 내림차순,
 * 그룹 순서는 각 그룹의 최신 스냅샷 timestamp 내림차순이다.
 */
export function groupMonitoringSnapshots(
  snapshots: AgentMonitoringSnapshot[],
  mode: Exclude<MonitoringFilterMode, 'all'>,
  getAgent: (id: string) => Agent | undefined,
): MonitoringGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, AgentMonitoringSnapshot[]>();
  for (const snapshot of snapshots) {
    const key = getMonitoringGroupKey(snapshot, mode, getAgent);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(snapshot);
    } else {
      buckets.set(key, [snapshot]);
      order.push(key);
    }
  }
  const groups: MonitoringGroup[] = order.map((key) => ({
    key,
    snapshots: (buckets.get(key) ?? []).slice().sort(compareByTimestampDesc),
  }));
  groups.sort((a, b) =>
    (b.snapshots[0]?.timestamp ?? '').localeCompare(
      a.snapshots[0]?.timestamp ?? '',
    ),
  );
  return groups;
}
