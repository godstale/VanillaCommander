import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  estimateTokensFromChars,
  splitOutputTokens,
  buildTurnContribution,
  beginConversation,
  recordTurn,
  endConversation,
  getConversations,
  getTotals,
  getActiveConversationId,
  getActiveConversationSeq,
  getActiveTotals,
  subscribe,
  clear,
} from './tokenTracker';

describe('tokenTracker', () => {
  beforeEach(() => {
    clear();
  });

  it('estimates tokens from chars with ceil(chars / 4)', () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(-5)).toBe(0);
    expect(estimateTokensFromChars(4)).toBe(1);
    expect(estimateTokensFromChars(5)).toBe(2);
    expect(estimateTokensFromChars(80)).toBe(20);
  });

  it('splits output tokens proportionally between thinking and content', () => {
    // 50 출력 토큰 중 사고문 80자 / 본문 120자 → 20 / 30
    expect(splitOutputTokens(50, 80, 120)).toEqual({
      thinkingTokens: 20,
      contentTokens: 30,
    });
    // 사고문이 없으면 전부 본문
    expect(splitOutputTokens(50, 0, 120)).toEqual({
      thinkingTokens: 0,
      contentTokens: 50,
    });
    // 출력 실측이 없으면 문자 추정치로 폴백
    expect(splitOutputTokens(0, 80, 120)).toEqual({
      thinkingTokens: 20,
      contentTokens: 30,
    });
  });

  it('builds turn contribution with status attribution', () => {
    const turn = buildTurnContribution({
      inputTokens: 100,
      outputTokens: 50,
      thinkingChars: 80,
      contentChars: 120,
    });
    expect(turn.inputTokens).toBe(100);
    expect(turn.outputTokens).toBe(50);
    expect(turn.thinkingTokens).toBe(20);
    expect(turn.contentTokens).toBe(30);
    expect(turn.statusTokens.prefill).toBe(100);
    expect(turn.statusTokens.thinking).toBe(20);
    expect(turn.statusTokens.decoding).toBe(30);
    expect(turn.statusTokens.generating).toBe(0);
  });

  it('aggregates a multi-turn conversation on end', () => {
    const id = beginConversation('agent-1', 'session-1');
    expect(getActiveConversationId('agent-1')).toBe(id);
    expect(getActiveConversationSeq('agent-1')).toBe(1);

    recordTurn(
      'agent-1',
      buildTurnContribution({ inputTokens: 100, outputTokens: 50, thinkingChars: 80, contentChars: 120 }),
    );
    recordTurn(
      'agent-1',
      buildTurnContribution({ inputTokens: 200, outputTokens: 40, thinkingChars: 0, contentChars: 160 }),
    );

    const active = getActiveTotals('agent-1');
    expect(active?.inputTokens).toBe(300);
    expect(active?.outputTokens).toBe(90);

    const summary = endConversation('agent-1');
    expect(summary?.id).toBe(id);
    expect(summary?.agentId).toBe('agent-1');
    expect(summary?.sessionId).toBe('session-1');
    expect(summary?.seq).toBe(1);
    expect(summary?.turnCount).toBe(2);
    expect(summary?.inputTokens).toBe(300);
    expect(summary?.outputTokens).toBe(90);
    expect(summary?.totalTokens).toBe(390);
    expect(summary?.thinkingTokens).toBe(20);
    expect(summary?.contentTokens).toBe(70);
    expect(summary?.statusTokens.prefill).toBe(300);
    expect(summary?.statusTokens.thinking).toBe(20);
    expect(summary?.statusTokens.decoding).toBe(70);

    expect(getActiveConversationId('agent-1')).toBeUndefined();
    expect(getConversations('agent-1')).toHaveLength(1);
  });

  it('does not record conversations without any measured tokens', () => {
    beginConversation('agent-1');
    expect(endConversation('agent-1')).toBeNull();
    expect(getConversations('agent-1')).toHaveLength(0);
  });

  it('auto-starts a conversation when a turn is recorded without begin', () => {
    recordTurn(
      'agent-1',
      buildTurnContribution({ inputTokens: 10, outputTokens: 5, thinkingChars: 0, contentChars: 20 }),
    );
    expect(getActiveConversationId('agent-1')).toBeDefined();
    const summary = endConversation('agent-1');
    expect(summary?.turnCount).toBe(1);
    expect(summary?.seq).toBe(1);
  });

  it('assigns monotonically increasing seq per agent', () => {
    beginConversation('agent-1');
    recordTurn(
      'agent-1',
      buildTurnContribution({ inputTokens: 10, outputTokens: 5, thinkingChars: 0, contentChars: 20 }),
    );
    expect(endConversation('agent-1')?.seq).toBe(1);

    expect(getActiveConversationSeq('agent-1')).toBeUndefined();
    beginConversation('agent-1');
    // 아직 끝나지 않은 대화의 seq는 종료 시 부여될 값을 예측한다
    expect(getActiveConversationSeq('agent-1')).toBe(2);
    recordTurn(
      'agent-1',
      buildTurnContribution({ inputTokens: 7, outputTokens: 3, thinkingChars: 0, contentChars: 12 }),
    );
    expect(endConversation('agent-1')?.seq).toBe(2);

    // 다른 에이전트는 별도 카운터
    beginConversation('agent-2');
    recordTurn(
      'agent-2',
      buildTurnContribution({ inputTokens: 1, outputTokens: 1, thinkingChars: 0, contentChars: 4 }),
    );
    expect(endConversation('agent-2')?.seq).toBe(1);
  });

  it('computes totals across conversations', () => {
    for (let i = 0; i < 2; i++) {
      beginConversation('agent-1');
      recordTurn(
        'agent-1',
        buildTurnContribution({ inputTokens: 100, outputTokens: 50, thinkingChars: 100, contentChars: 100 }),
      );
      endConversation('agent-1');
    }
    const totals = getTotals('agent-1');
    expect(totals.conversationCount).toBe(2);
    expect(totals.turnCount).toBe(2);
    expect(totals.inputTokens).toBe(200);
    expect(totals.outputTokens).toBe(100);
    expect(totals.thinkingTokens).toBe(50);
    expect(totals.totalTokens).toBe(300);
    expect(totals.statusTokens.prefill).toBe(200);
  });

  it('notifies subscribers on begin/record/end', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe('agent-1', listener);
    beginConversation('agent-1');
    recordTurn(
      'agent-1',
      buildTurnContribution({ inputTokens: 1, outputTokens: 1, thinkingChars: 0, contentChars: 4 }),
    );
    endConversation('agent-1');
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    beginConversation('agent-1');
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
