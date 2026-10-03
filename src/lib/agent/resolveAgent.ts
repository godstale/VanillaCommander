// P11-25: 기본 에이전트 폴백 결정 로직 (다이얼로그 UI는 AgentFallbackDialog).
import { getProviderPreset } from '@/lib/llm/providers';
import type { Agent, AgentConnectionStatus } from '@/lib/types/agent';

export interface FallbackCandidate {
  agent: Agent;
  status: AgentConnectionStatus;
  external: boolean;
}

/** 클라우드·외부 에이전트는 대화 내용이 외부로 나갈 수 있어 별도 확인이 필요하다. */
export function isExternalAgentConfig(agent: Agent): boolean {
  if (agent.llmProvider === 'external-agent') return true;
  const category = getProviderPreset(agent.llmProvider).category;
  return category === 'cloud' || category === 'gateway';
}

export type HealthChecker = (agent: Agent) => Promise<'connected' | 'disconnected'>;

export async function checkCandidatesHealth(
  agents: Agent[],
  check: HealthChecker,
): Promise<Record<string, 'connected' | 'disconnected'>> {
  const entries = await Promise.all(
    agents.map(async (a) => {
      try {
        const status = await check(a);
        return [a.id, status] as const;
      } catch {
        return [a.id, 'disconnected'] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

export function buildCandidates(
  agents: Agent[],
  statuses: Record<string, 'connected' | 'disconnected'>,
  excludeId?: string,
): FallbackCandidate[] {
  return agents
    .filter((a) => a.id !== excludeId)
    .map((a) => ({
      agent: a,
      status: statuses[a.id] ?? 'unknown',
      external: isExternalAgentConfig(a),
    }));
}

/**
 * 위키·매크로 백그라운드 실행용 (다이얼로그 없음).
 * 건강한 로컬 에이전트만 자동 선택한다. 없으면 null (대기 + StatusBar 알림은 호출자 몫).
 */
export function pickBackgroundAgent(
  agents: Agent[],
  statuses: Record<string, 'connected' | 'disconnected'>,
): Agent | null {
  const preferred = agents.find((a) => a.isDefault);
  const ordered = preferred ? [preferred, ...agents.filter((a) => a.id !== preferred.id)] : agents;
  return ordered.find((a) => !isExternalAgentConfig(a) && statuses[a.id] === 'connected') ?? null;
}

const FALLBACK_AGENT_KEY = 'vanilla-commander:fallback-agent';

export function getStoredFallbackAgentId(): string | null {
  try {
    const raw = window.localStorage.getItem(FALLBACK_AGENT_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function storeFallbackAgentId(id: string | null): void {
  try {
    if (id) {
      window.localStorage.setItem(FALLBACK_AGENT_KEY, id);
    } else {
      window.localStorage.removeItem(FALLBACK_AGENT_KEY);
    }
  } catch {
    // ignore
  }
}
