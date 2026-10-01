import type {
  ConversationTokenSummary,
  ConversationTokenTotals,
  TokenStatusBreakdown,
  TurnTokenContribution,
} from '@/lib/types/monitoring';
import { emptyStatusTokens } from '@/lib/types/monitoring';

/**
 * 대화(한 번의 요청 입력 → 답변 종료, 즉 agent_start..agent_end) 단위 토큰 집계.
 * - Ollama/OpenAI 호환 스트림의 usage(input/output) 실측을 턴마다 누적한다.
 * - 사고(thinking) 토큰은 별도 카운터가 없으므로 출력 토큰 중 사고문/본문
 *   문자 비율로 안분한다(출력에 thinking이 포함된다는 실측 전제).
 * - 상태별 출력 토큰: prefill=입력, thinking=사고분, decoding=본문분,
 *   나머지는 0. generating은 루프의 범용 진행 상태라 decoding에 합치지 않고
 *   별도 키를 유지한다(현재 루프는 본문 청크를 decoding으로 보고한다).
 * - 순수 인메모리 저장소다. 영속화(대화 원장)는 monitoringCollector가
 *   finishConversation() 경유로 monitoringRepo에 위임한다.
 */

/** 휴리스틱 추정치와 동일한 스케일: ceil(chars / 4) */
export function estimateTokensFromChars(charCount: number): number {
  if (!charCount || charCount <= 0) return 0;
  return Math.ceil(charCount / 4);
}

/**
 * 출력 토큰을 사고분/본문분으로 안분한다.
 * 출력 실측이 없으면 문자 추정치로 폴백한다.
 */
export function splitOutputTokens(
  outputTokens: number,
  thinkingChars: number,
  contentChars: number,
): { thinkingTokens: number; contentTokens: number } {
  const think = Math.max(0, thinkingChars);
  const content = Math.max(0, contentChars);
  if (outputTokens <= 0) {
    return {
      thinkingTokens: estimateTokensFromChars(think),
      contentTokens: estimateTokensFromChars(content),
    };
  }
  const totalChars = think + content;
  if (totalChars <= 0) {
    return { thinkingTokens: 0, contentTokens: outputTokens };
  }
  const thinkingTokens = Math.round((outputTokens * think) / totalChars);
  return {
    thinkingTokens,
    contentTokens: Math.max(0, outputTokens - thinkingTokens),
  };
}

export function buildTurnContribution(args: {
  inputTokens: number;
  outputTokens: number;
  thinkingChars: number;
  contentChars: number;
}): TurnTokenContribution {
  const inputTokens = Math.max(0, Math.round(args.inputTokens));
  const outputTokens = Math.max(0, Math.round(args.outputTokens));
  const { thinkingTokens, contentTokens } = splitOutputTokens(
    outputTokens,
    args.thinkingChars,
    args.contentChars,
  );
  return {
    inputTokens,
    outputTokens,
    thinkingTokens,
    contentTokens,
    statusTokens: {
      ...emptyStatusTokens(),
      prefill: inputTokens,
      thinking: thinkingTokens,
      decoding: contentTokens,
    },
  };
}

interface ActiveAccumulator {
  id: string;
  sessionId?: string;
  startedAt: string;
  turns: TurnTokenContribution[];
}

const MAX_HISTORY_PER_AGENT = 200;
/** 비정상 종료로 endConversation이 호출되지 않은 활성 대화를 만료시키는 TTL */
const ACTIVE_TTL_MS = 30 * 60 * 1000;

const activeMap = new Map<string, ActiveAccumulator>();
const historyMap = new Map<string, ConversationTokenSummary[]>();
const seqMap = new Map<string, number>();
const listenerMap = new Map<string, Set<() => void>>();

function nextSeq(agentId: string): number {
  const next = (seqMap.get(agentId) ?? 0) + 1;
  seqMap.set(agentId, next);
  return next;
}

function notify(agentId: string): void {
  const set = listenerMap.get(agentId);
  if (!set) return;
  for (const listener of set) {
    try {
      listener();
    } catch {
      // ignore listener errors
    }
  }
}

function aggregateTurns(turns: TurnTokenContribution[]): {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  contentTokens: number;
  statusTokens: TokenStatusBreakdown;
} {
  const statusTokens = emptyStatusTokens();
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  let contentTokens = 0;
  for (const t of turns) {
    inputTokens += t.inputTokens;
    outputTokens += t.outputTokens;
    thinkingTokens += t.thinkingTokens;
    contentTokens += t.contentTokens;
    for (const key of Object.keys(statusTokens) as Array<keyof TokenStatusBreakdown>) {
      statusTokens[key] += t.statusTokens[key] ?? 0;
    }
  }
  return { inputTokens, outputTokens, thinkingTokens, contentTokens, statusTokens };
}

/** 대화 시작(agent_start). 이미 열려 있으면 이전 것을 강제 종료 후 새로 연다. */
export function beginConversation(agentId: string, sessionId?: string): string {
  if (activeMap.has(agentId)) {
    endConversation(agentId);
  }
  const startedAt = new Date().toISOString();
  const id = `conv-${agentId}-${Date.parse(startedAt).toString(36)}`;
  activeMap.set(agentId, {
    id,
    sessionId,
    startedAt,
    turns: [],
  });
  notify(agentId);
  return id;
}

/** 현재 턴의 토큰 기여분을 누적한다. 활성 대화가 없으면 자동 시작한다. */
export function recordTurn(agentId: string, contribution: TurnTokenContribution): void {
  let acc = activeMap.get(agentId);
  if (!acc) {
    const startedAt = new Date().toISOString();
    acc = {
      id: `conv-${agentId}-${Date.parse(startedAt).toString(36)}`,
      startedAt,
      turns: [],
    };
    activeMap.set(agentId, acc);
  }
  acc.turns.push(contribution);
  notify(agentId);
}

/** 대화 종료(agent_end). 집계 요약을 히스토리에 추가하고 반환한다. */
export function endConversation(agentId: string): ConversationTokenSummary | null {
  const acc = activeMap.get(agentId);
  if (!acc) return null;
  activeMap.delete(agentId);
  if (acc.turns.length === 0) {
    // 토큰 실측이 하나도 없는 대화(시작 직후 중단 등)는 원장에 남기지 않는다.
    notify(agentId);
    return null;
  }
  const agg = aggregateTurns(acc.turns);
  const endedAt = new Date().toISOString();
  const summary: ConversationTokenSummary = {
    id: acc.id,
    agentId,
    sessionId: acc.sessionId,
    seq: nextSeq(agentId),
    startedAt: acc.startedAt,
    endedAt,
    turnCount: acc.turns.length,
    inputTokens: agg.inputTokens,
    outputTokens: agg.outputTokens,
    totalTokens: agg.inputTokens + agg.outputTokens,
    thinkingTokens: agg.thinkingTokens,
    contentTokens: agg.contentTokens,
    statusTokens: agg.statusTokens,
  };
  const history = historyMap.get(agentId) ?? [];
  history.unshift(summary);
  historyMap.set(agentId, history.slice(0, MAX_HISTORY_PER_AGENT));
  notify(agentId);
  return summary;
}

/** 현재 진행 중인 대화의 id (없거나 만료되었으면 undefined) */
export function getActiveConversationId(agentId: string): string | undefined {
  const acc = activeMap.get(agentId);
  if (!acc) return undefined;
  if (Date.now() - Date.parse(acc.startedAt) > ACTIVE_TTL_MS) {
    // 강제 종료된 실행의 잔재: 영속화 없이 버리고 스냅샷 오귀속을 막는다.
    activeMap.delete(agentId);
    return undefined;
  }
  return acc.id;
}

/** 진행 중 대화의 일련번호. 에이전트별 대화는 직렬화되므로 종료 시 부여될 값과 같다. */
export function getActiveConversationSeq(agentId: string): number | undefined {
  if (!getActiveConversationId(agentId)) return undefined;
  return (seqMap.get(agentId) ?? 0) + 1;
}

/** 진행 중 대화의 지금까지 누적분 (스냅샷/카드의 "진행 중" 표시용) */
export function getActiveTotals(agentId: string): TurnTokenContribution | null {
  if (!getActiveConversationId(agentId)) return null;
  const acc = activeMap.get(agentId);
  if (!acc || acc.turns.length === 0) return null;
  const agg = aggregateTurns(acc.turns);
  return {
    inputTokens: agg.inputTokens,
    outputTokens: agg.outputTokens,
    thinkingTokens: agg.thinkingTokens,
    contentTokens: agg.contentTokens,
    statusTokens: agg.statusTokens,
  };
}

export function getConversations(agentId: string): ConversationTokenSummary[] {
  return [...(historyMap.get(agentId) ?? [])];
}

export function getTotals(agentId: string): ConversationTokenTotals {
  const history = historyMap.get(agentId) ?? [];
  const statusTokens = emptyStatusTokens();
  let turnCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  let contentTokens = 0;
  for (const c of history) {
    turnCount += c.turnCount;
    inputTokens += c.inputTokens;
    outputTokens += c.outputTokens;
    thinkingTokens += c.thinkingTokens;
    contentTokens += c.contentTokens;
    for (const key of Object.keys(statusTokens) as Array<keyof TokenStatusBreakdown>) {
      statusTokens[key] += c.statusTokens[key] ?? 0;
    }
  }
  return {
    conversationCount: history.length,
    turnCount,
    inputTokens,
    outputTokens,
    thinkingTokens,
    contentTokens,
    totalTokens: inputTokens + outputTokens,
    statusTokens,
  };
}

export function subscribe(agentId: string, listener: () => void): () => void {
  if (!listenerMap.has(agentId)) {
    listenerMap.set(agentId, new Set());
  }
  listenerMap.get(agentId)!.add(listener);
  return () => {
    const set = listenerMap.get(agentId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        listenerMap.delete(agentId);
      }
    }
  };
}

/** 테스트/초기화용. 활성 대화·히스토리·seq를 모두 비운다. */
export function clear(agentId?: string): void {
  if (agentId) {
    activeMap.delete(agentId);
    historyMap.delete(agentId);
    seqMap.delete(agentId);
    notify(agentId);
    return;
  }
  activeMap.clear();
  historyMap.clear();
  seqMap.clear();
}

export const tokenTracker = {
  estimateTokensFromChars,
  splitOutputTokens,
  buildTurnContribution,
  beginConversation,
  recordTurn,
  endConversation,
  getActiveConversationId,
  getActiveConversationSeq,
  getActiveTotals,
  getConversations,
  getTotals,
  subscribe,
  clear,
};
