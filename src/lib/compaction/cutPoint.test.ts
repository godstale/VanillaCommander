import { describe, it, expect } from 'vitest';
import { findValidCutPoints, findCutPoint } from './cutPoint';
import {
  serializeMessagesForSummary,
  extractFileOps,
  TOOL_RESULT_MAX_CHARS,
} from './serialize';
import type { AgentMessage } from '@/lib/agent/types';

describe('compaction cutPoint & serialize (P4-07)', () => {
  describe('cutPoint.ts', () => {
    it('findValidCutPoints only returns user and assistant indices, never toolResult', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'U1' },
        {
          role: 'assistant',
          content: 'A1',
          toolCalls: [{ id: 'call_1', name: 'read', arguments: {} }],
          stopReason: 'toolUse',
        },
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'read',
          content: 'content',
          isError: false,
        },
        { role: 'assistant', content: 'A2', stopReason: 'stop' },
      ];

      const valid = findValidCutPoints(messages);
      expect(valid).toEqual([0, 1, 3]);
      expect(valid).not.toContain(2); // toolResult excluded
    });

    it('never cuts between assistant and toolResult, rewinding to user turn boundary', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Turn 1 user' },
        { role: 'assistant', content: 'Turn 1 assistant', stopReason: 'stop' },
        { role: 'user', content: 'Turn 2 user with tool request' },
        {
          role: 'assistant',
          content: 'Invoking tool...',
          toolCalls: [{ id: 'c1', name: 'read', arguments: { path: 'file.txt' } }],
          stopReason: 'toolUse',
        },
        {
          role: 'toolResult',
          toolCallId: 'c1',
          toolName: 'read',
          content: 'file contents',
          isError: false,
        },
        { role: 'assistant', content: 'Turn 2 final response', stopReason: 'stop' },
      ];

      // Keep recent tokens small enough so that it would land in Turn 2
      const cutPoint = findCutPoint(messages, 20);

      // Must rewind to Turn 2's user message (index 2)
      expect(cutPoint).toBe(2);
      expect(messages[cutPoint].role).toBe('user');
    });

    it('returns startIndex when keepRecentTokens is large enough to keep everything', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi', stopReason: 'stop' },
      ];

      const cutPoint = findCutPoint(messages, 10000);
      expect(cutPoint).toBe(0);
    });
  });

  describe('serialize.ts', () => {
    it('serializes messages according to §9.4 format', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'What is in file.txt?' },
        {
          role: 'assistant',
          thinking: 'I will read the file',
          content: 'Let me check file.txt for you.',
          toolCalls: [{ id: 'c1', name: 'read', arguments: { path: 'file.txt' } }],
          stopReason: 'toolUse',
        },
        {
          role: 'toolResult',
          toolCallId: 'c1',
          toolName: 'read',
          content: 'Line 1\nLine 2',
          isError: false,
        },
      ];

      const serialized = serializeMessagesForSummary(messages);
      expect(serialized).toContain('[User]:\nWhat is in file.txt?');
      expect(serialized).toContain('[Assistant thinking]:\nI will read the file');
      expect(serialized).toContain('[Assistant]:\nLet me check file.txt for you.');
      expect(serialized).toContain('[Assistant tool calls]:\nread(path="file.txt")');
      expect(serialized).toContain('[Tool result (read)]:\nLine 1\nLine 2');
    });

    it('truncates toolResult content exceeding 2000 characters', () => {
      const longOutput = 'x'.repeat(2500);
      const messages: AgentMessage[] = [
        {
          role: 'toolResult',
          toolCallId: 'c1',
          toolName: 'read',
          content: longOutput,
          isError: false,
        },
      ];

      const serialized = serializeMessagesForSummary(messages);
      expect(serialized).toContain('[... 500 characters truncated ...]');
      expect(serialized.length).toBeLessThan(TOOL_RESULT_MAX_CHARS + 200);
    });

    it('extractFileOps unions previous file operations and current tool calls', () => {
      const messages: AgentMessage[] = [
        {
          role: 'assistant',
          content: 'Reading and writing',
          toolCalls: [
            { id: '1', name: 'read', arguments: { path: 'src/index.ts' } },
            { id: '2', name: 'write', arguments: { path: 'dist/bundle.js' } },
          ],
          stopReason: 'toolUse',
        },
      ];

      const previousDetails = {
        readFiles: ['README.md'],
        modifiedFiles: ['package.json'],
      };

      const fileOps = extractFileOps(messages, previousDetails);
      expect(fileOps.readFiles).toEqual(['README.md', 'src/index.ts']);
      expect(fileOps.modifiedFiles).toEqual(['dist/bundle.js', 'package.json']);
    });
  });
});
