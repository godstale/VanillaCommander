import { describe, it, expect, vi } from 'vitest';
import { buildLlmContext, buildUiTimeline } from './buildContext';
import type {
  MessageEntry,
  CompactionEntry,
  CustomEntry,
  Entry,
} from '@/lib/types/chat';

describe('buildContext (P4-03)', () => {
  const baseDate = '2026-09-18T10:00:00.000Z';

  it('Case 1: No compaction -> all message entries included, custom excluded', () => {
    const entries: Entry[] = [
      {
        id: '1',
        sessionId: 's1',
        parentId: null,
        seq: 1,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'First question' },
      } as MessageEntry,
      {
        id: '2',
        sessionId: 's1',
        parentId: '1',
        seq: 2,
        type: 'custom',
        createdAt: baseDate,
        customType: 'notice',
        payload: { text: 'Some notice' },
      } as CustomEntry,
      {
        id: '3',
        sessionId: 's1',
        parentId: '2',
        seq: 3,
        type: 'message',
        createdAt: baseDate,
        message: {
          role: 'assistant',
          content: 'First answer',
          stopReason: 'stop',
        },
      } as MessageEntry,
    ];

    const llmContext = buildLlmContext(entries);
    expect(llmContext).toHaveLength(2);
    expect(llmContext[0]).toEqual({
      role: 'user',
      content: 'First question',
    });
    expect(llmContext[1]).toEqual({
      role: 'assistant',
      content: 'First answer',
      stopReason: 'stop',
    });

    const uiTimeline = buildUiTimeline(entries);
    expect(uiTimeline).toHaveLength(3);
    expect(uiTimeline.map((t) => t.type)).toEqual([
      'message',
      'custom',
      'message',
    ]);
  });

  it('Case 2: 1 compaction -> summary + messages starting from firstKeptEntryId', () => {
    const entries: Entry[] = [
      {
        id: '1',
        sessionId: 's1',
        parentId: null,
        seq: 1,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'Turn 1 user' },
      } as MessageEntry,
      {
        id: '2',
        sessionId: 's1',
        parentId: '1',
        seq: 2,
        type: 'message',
        createdAt: baseDate,
        message: {
          role: 'assistant',
          content: 'Turn 1 assistant',
          stopReason: 'stop',
        },
      } as MessageEntry,
      {
        id: '3',
        sessionId: 's1',
        parentId: '2',
        seq: 3,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'Turn 2 user' },
      } as MessageEntry,
      {
        id: '4',
        sessionId: 's1',
        parentId: '3',
        seq: 4,
        type: 'message',
        createdAt: baseDate,
        message: {
          role: 'assistant',
          content: 'Turn 2 assistant',
          stopReason: 'stop',
        },
      } as MessageEntry,
      {
        id: 'cmp-1',
        sessionId: 's1',
        parentId: '4',
        seq: 5,
        type: 'compaction',
        createdAt: baseDate,
        summary: 'Summary of Turn 1',
        firstKeptEntryId: '3', // Keep turn 2 (entry 3 & 4)
        tokensBefore: 1500,
        details: { readFiles: [], modifiedFiles: [] },
      } as CompactionEntry,
    ];

    const llmContext = buildLlmContext(entries);
    // Should have: 1 summary message + entry 3 + entry 4 = 3 messages
    expect(llmContext).toHaveLength(3);
    expect(llmContext[0].role).toBe('system');
    expect(llmContext[0].content).toContain('Summary of Turn 1');
    expect(llmContext[1]).toEqual({
      role: 'user',
      content: 'Turn 2 user',
    });
    expect(llmContext[2]).toEqual({
      role: 'assistant',
      content: 'Turn 2 assistant',
      stopReason: 'stop',
    });

    const timeline = buildUiTimeline(entries);
    expect(timeline).toHaveLength(5);
    expect(timeline[4].type).toBe('compaction');
  });

  it('Case 3: 2 compactions -> only latest compaction summary used', () => {
    const entries: Entry[] = [
      {
        id: '1',
        sessionId: 's1',
        parentId: null,
        seq: 1,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'Turn 1 user' },
      } as MessageEntry,
      {
        id: 'cmp-1',
        sessionId: 's1',
        parentId: '1',
        seq: 2,
        type: 'compaction',
        createdAt: baseDate,
        summary: 'Summary 1',
        firstKeptEntryId: '1',
        tokensBefore: 1000,
        details: { readFiles: [], modifiedFiles: [] },
      } as CompactionEntry,
      {
        id: '2',
        sessionId: 's1',
        parentId: 'cmp-1',
        seq: 3,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'Turn 2 user' },
      } as MessageEntry,
      {
        id: 'cmp-2',
        sessionId: 's1',
        parentId: '2',
        seq: 4,
        type: 'compaction',
        createdAt: baseDate,
        summary: 'Summary 2 (Latest)',
        firstKeptEntryId: '2',
        tokensBefore: 2000,
        details: { readFiles: [], modifiedFiles: [] },
      } as CompactionEntry,
      {
        id: '3',
        sessionId: 's1',
        parentId: 'cmp-2',
        seq: 5,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'Turn 3 user' },
      } as MessageEntry,
    ];

    const llmContext = buildLlmContext(entries);
    expect(llmContext).toHaveLength(3);
    // 1 summary (Summary 2) + entry 2 (firstKept) + entry 3
    expect(llmContext[0].role).toBe('system');
    expect(llmContext[0].content).toContain('Summary 2 (Latest)');
    expect(llmContext[1]).toEqual({
      role: 'user',
      content: 'Turn 2 user',
    });
    expect(llmContext[2]).toEqual({
      role: 'user',
      content: 'Turn 3 user',
    });
  });

  it('Case 4: Broken toolCall-toolResult pair is sanitized', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const entries: Entry[] = [
      {
        id: '1',
        sessionId: 's1',
        parentId: null,
        seq: 1,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'Run command' },
      } as MessageEntry,
      {
        id: '2',
        sessionId: 's1',
        parentId: '1',
        seq: 2,
        type: 'message',
        createdAt: baseDate,
        message: {
          role: 'assistant',
          content: 'Running...',
          toolCalls: [
            { id: 'call_1', name: 'read', arguments: { path: 'test.txt' } },
          ],
          stopReason: 'toolUse',
        },
      } as MessageEntry,
      // Missing toolResult for call_1! Instead directly followed by user message
      {
        id: '3',
        sessionId: 's1',
        parentId: '2',
        seq: 3,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'What happened?' },
      } as MessageEntry,
    ];

    const llmContext = buildLlmContext(entries);
    expect(llmContext).toHaveLength(3);
    // Tool calls should be stripped from assistant message
    const assistantMsg = llmContext[1];
    expect(assistantMsg.role).toBe('assistant');
    if (assistantMsg.role === 'assistant') {
      expect(assistantMsg.toolCalls).toBeUndefined();
    }
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
