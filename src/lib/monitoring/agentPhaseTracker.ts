/**
 * Per-agent detailed execution phase tracker.
 * Solves the "always IDLE" problem: Ollama streaming only logs at
 * turn start/end, so a 15s log window goes stale during long generations.
 * The agent loop reports its live phase here on every chunk/tool event,
 * and the monitoring collector consults this first.
 */

export type AgentDetailedPhase =
  | 'idle'
  | 'thinking'
  | 'prefill'
  | 'generating'
  | 'decoding'
  | 'executing_tool'
  | 'waiting_approval';

export interface AgentPhaseInfo {
  phase: AgentDetailedPhase;
  task: string;
  updatedAt: number;
  sessionId?: string;
}

const PHASE_TTL_MS = 20_000;
const phaseMap = new Map<string, AgentPhaseInfo>();
const sessionToAgent = new Map<string, string>();

export function setAgentPhase(
  agentId: string,
  phase: AgentDetailedPhase,
  task?: string,
  sessionId?: string,
): void {
  phaseMap.set(agentId, {
    phase,
    task: task ?? defaultTaskForPhase(phase),
    updatedAt: Date.now(),
    sessionId,
  });
  if (sessionId) {
    sessionToAgent.set(sessionId, agentId);
  }
}

export function getAgentPhase(agentId: string): AgentPhaseInfo | null {
  const info = phaseMap.get(agentId);
  if (!info) return null;
  if (Date.now() - info.updatedAt > PHASE_TTL_MS) {
    return null;
  }
  return info;
}

export function clearAgentPhase(agentId: string): void {
  phaseMap.delete(agentId);
}

export function bindSessionToAgent(sessionId: string, agentId: string): void {
  sessionToAgent.set(sessionId, agentId);
}

export function getAgentIdForSession(sessionId: string): string | undefined {
  return sessionToAgent.get(sessionId);
}

export function getBusyAgentFromSessions(busySessionId: string | null): string | undefined {
  if (!busySessionId) return undefined;
  return sessionToAgent.get(busySessionId);
}

function defaultTaskForPhase(phase: AgentDetailedPhase): string {
  switch (phase) {
    case 'thinking':
      return 'LLM 사고 과정(Thinking) 진행 중';
    case 'prefill':
      return '입력 프롬프트 병렬 평가(Prefill) 중';
    case 'generating':
      return 'LLM 응답 생성(Generating) 중';
    case 'decoding':
      return '토큰 순차 디코딩(Decoding) 중';
    case 'executing_tool':
      return '도구 실행(Executing_Tool) 중';
    case 'waiting_approval':
      return '사용자 승인 대기 중';
    case 'idle':
    default:
      return '대기 중 (유휴 상태)';
  }
}

export const agentPhaseTracker = {
  set: setAgentPhase,
  get: getAgentPhase,
  clear: clearAgentPhase,
  bindSession: bindSessionToAgent,
  agentForSession: getAgentIdForSession,
  busyAgent: getBusyAgentFromSessions,
};
