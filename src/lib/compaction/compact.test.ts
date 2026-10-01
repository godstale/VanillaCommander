import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareCompaction, executeCompact } from './compact';
import type { Entry, MessageEntry, CompactionEntry } from '@/lib/types/chat';
import * as entriesRepo from '@/lib/db/repositories/entriesRepo';
import { setDatabase } from '@/lib/db/client';

describe('compact.ts (P4-08)', () => {
  const sessionId = 'test-session-1';
  const baseDate = '2026-09-18T12:00:00.000Z';

  beforeEach(() => {
    setDatabase(null); // resets to in-memory fallback
  });

  it('prepares compaction and identifies messagesToSummarize and firstKeptEntryId', () => {
    const entries: Entry[] = [
      {
        id: 'e1',
        sessionId,
        parentId: null,
        seq: 1,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'Turn 1 user request' },
      } as MessageEntry,
      {
        id: 'e2',
        sessionId,
        parentId: 'e1',
        seq: 2,
        type: 'message',
        createdAt: baseDate,
        message: {
          role: 'assistant',
          content: 'Turn 1 assistant answer',
          stopReason: 'stop',
        },
      } as MessageEntry,
      {
        id: 'e3',
        sessionId,
        parentId: 'e2',
        seq: 3,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'Turn 2 user request' },
      } as MessageEntry,
      {
        id: 'e4',
        sessionId,
        parentId: 'e3',
        seq: 4,
        type: 'message',
        createdAt: baseDate,
        message: {
          role: 'assistant',
          content: 'Turn 2 assistant answer',
          stopReason: 'stop',
        },
      } as MessageEntry,
    ];

    const prep = prepareCompaction(sessionId, entries, {
      contextSize: 8192,
      reserveTokens: 2048,
      keepRecentTokens: 10, // Small keepRecent so it keeps Turn 2 (e3, e4) and summarizes Turn 1 (e1, e2)
    });

    expect(prep).not.toBeNull();
    if (prep) {
      expect(prep.sessionId).toBe(sessionId);
      expect(prep.messagesToSummarize).toHaveLength(2);
      expect(prep.messagesToSummarize[0].content).toBe('Turn 1 user request');
      expect(prep.firstKeptEntryId).toBe('e3');
    }
  });

  it('executes compact with LLM stream and stores compaction + notice entries', async () => {
    const entries: Entry[] = [
      {
        id: 'e1',
        sessionId,
        parentId: null,
        seq: 1,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'Old question' },
      } as MessageEntry,
      {
        id: 'e2',
        sessionId,
        parentId: 'e1',
        seq: 2,
        type: 'message',
        createdAt: baseDate,
        message: {
          role: 'assistant',
          content: 'Old answer',
          toolCalls: [
            { id: 'c1', name: 'read', arguments: { path: 'src/config.ts' } },
          ],
          stopReason: 'stop',
        },
      } as MessageEntry,
      {
        id: 'e3',
        sessionId,
        parentId: 'e2',
        seq: 3,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'Recent question' },
      } as MessageEntry,
      {
        id: 'e4',
        sessionId,
        parentId: 'e3',
        seq: 4,
        type: 'message',
        createdAt: baseDate,
        message: {
          role: 'assistant',
          content: 'Recent answer',
          stopReason: 'stop',
        },
      } as MessageEntry,
    ];

    await entriesRepo.appendEntries(sessionId, entries as Omit<Entry, 'seq'>[]);

    const prep = prepareCompaction(sessionId, entries, {
      contextSize: 8192,
      reserveTokens: 2048,
      keepRecentTokens: 5,
    });

    expect(prep).not.toBeNull();
    if (!prep) return;

    const mockStreamFn = vi.fn().mockImplementation(async function* () {
      yield { content: '## Goal\nSummarized goal\n\n' };
      yield { content: '## Progress\n### Done\n- Read src/config.ts' };
    });

    const result = await executeCompact(prep, {
      model: 'qwen3.5:9b',
      reason: 'threshold',
      streamChatFn: mockStreamFn,
    });

    expect(result.summary).toContain('## Goal');
    expect(result.compactionEntry.type).toBe('compaction');
    expect(result.compactionEntry.firstKeptEntryId).toBe('e3');
    expect(result.compactionEntry.details.readFiles).toContain('src/config.ts');
    expect(result.noticeEntry.type).toBe('custom');

    // Check that entries are saved in repository
    const stored = await entriesRepo.getEntries(sessionId);
    expect(stored.some((e) => e.type === 'compaction')).toBe(true);
    expect(stored.some((e) => e.type === 'custom')).toBe(true);
  });

  it('accumulates file operations across multiple compactions', () => {
    const entries: Entry[] = [
      {
        id: 'cmp-1',
        sessionId,
        parentId: null,
        seq: 1,
        type: 'compaction',
        createdAt: baseDate,
        summary: 'Earlier summary',
        firstKeptEntryId: 'e1',
        tokensBefore: 1000,
        details: { readFiles: ['a.ts'], modifiedFiles: ['b.ts'] },
      } as CompactionEntry,
      {
        id: 'e1',
        sessionId,
        parentId: 'cmp-1',
        seq: 2,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'U1' },
      } as MessageEntry,
      {
        id: 'e2',
        sessionId,
        parentId: 'e1',
        seq: 3,
        type: 'message',
        createdAt: baseDate,
        message: {
          role: 'assistant',
          content: 'A1',
          toolCalls: [
            { id: '1', name: 'read', arguments: { path: 'c.ts' } },
            { id: '2', name: 'edit', arguments: { path: 'd.ts' } },
          ],
          stopReason: 'stop',
        },
      } as MessageEntry,
      {
        id: 'e3',
        sessionId,
        parentId: 'e2',
        seq: 4,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'user', content: 'Recent U2' },
      } as MessageEntry,
      {
        id: 'e4',
        sessionId,
        parentId: 'e3',
        seq: 5,
        type: 'message',
        createdAt: baseDate,
        message: { role: 'assistant', content: 'Recent A2', stopReason: 'stop' },
      } as MessageEntry,
    ];

    const prep = prepareCompaction(sessionId, entries, {
      contextSize: 8192,
      reserveTokens: 2048,
      keepRecentTokens: 5,
    });

    expect(prep).not.toBeNull();
    if (prep) {
      expect(prep.previousSummary).toBe('Earlier summary');
      expect(prep.fileOps.readFiles).toEqual(['a.ts', 'c.ts']);
      expect(prep.fileOps.modifiedFiles).toEqual(['b.ts', 'd.ts']);
    }
  });
});
