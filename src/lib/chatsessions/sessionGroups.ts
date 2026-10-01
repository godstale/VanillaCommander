import type { Agent } from '@/lib/types/agent';
import type { ChatSession } from '@/lib/types/chat';

export type SessionFilterMode = 'all' | 'agent' | 'provider' | 'model';

/** 세션의 에이전트 설정을 알 수 없을 때(삭제됨 또는 로딩 중) 사용하는 그룹 키 조각 */
export const UNKNOWN_GROUP_SEGMENT = '__unknown__';

export interface SessionGroup {
  key: string;
  sessions: ChatSession[];
}

function compareByUpdatedAtDesc(a: ChatSession, b: ChatSession): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * 세션이 속한 그룹 키를 구한다.
 * - agent: `agent:${agentId}` (에이전트 설정별, 삭제 여부와 무관하게 안정적)
 * - provider: `provider:${llmProvider ?? __unknown__}`
 * - model: `model:${model ?? __unknown__}`
 */
export function getSessionGroupKey(
  session: ChatSession,
  mode: Exclude<SessionFilterMode, 'all'>,
  getAgent: (id: string) => Agent | undefined,
): string {
  if (mode === 'agent') {
    return `agent:${session.agentId}`;
  }
  const agent = getAgent(session.agentId);
  if (mode === 'provider') {
    return `provider:${agent?.llmProvider ?? UNKNOWN_GROUP_SEGMENT}`;
  }
  return `model:${agent?.model ?? UNKNOWN_GROUP_SEGMENT}`;
}

/**
 * 세션 목록을 그룹 키별로 묶는다. 그룹 내부는 updatedAt 내림차순,
 * 그룹 순서는 각 그룹의 최신 세션 updatedAt 내림차순이다.
 */
export function groupSessions(
  sessions: ChatSession[],
  mode: Exclude<SessionFilterMode, 'all'>,
  getAgent: (id: string) => Agent | undefined,
): SessionGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, ChatSession[]>();
  for (const session of sessions) {
    const key = getSessionGroupKey(session, mode, getAgent);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(session);
    } else {
      buckets.set(key, [session]);
      order.push(key);
    }
  }
  const groups: SessionGroup[] = order.map((key) => ({
    key,
    sessions: (buckets.get(key) ?? []).slice().sort(compareByUpdatedAtDesc),
  }));
  groups.sort((a, b) =>
    (b.sessions[0]?.updatedAt ?? '').localeCompare(a.sessions[0]?.updatedAt ?? ''),
  );
  return groups;
}
