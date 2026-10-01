import { describe, it, expect } from 'vitest';
import {
  mapAgentMessagesToOpenAi,
  mapAgentToolsToOpenAi,
} from './messageMapper';
import { z } from 'zod';
import type { AgentMessage, AgentTool } from '@/lib/agent/types';

describe('messageMapper (OpenAI-compatible)', () => {
  it('maps assistant toolCalls with id/type and JSON-stringified arguments', () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'read a file' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'read', arguments: { path: '/tmp/a.txt' } }],
        stopReason: 'toolUse',
      },
      {
        role: 'toolResult',
        toolCallId: 'call_1',
        toolName: 'read',
        content: 'file contents',
        isError: false,
      },
    ];

    const mapped = mapAgentMessagesToOpenAi(messages);
    expect(mapped[0]).toEqual({ role: 'user', content: 'read a file' });
    expect(mapped[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"/tmp/a.txt"}' } },
      ],
    });
    expect(mapped[2]).toEqual({
      role: 'tool',
      content: 'file contents',
      tool_call_id: 'call_1',
    });
  });

  it('strips <think> blocks from assistant content', () => {
    const messages: AgentMessage[] = [
      {
        role: 'assistant',
        content: '<think>scratchpad</think>final answer',
        stopReason: 'stop',
      },
    ];
    const mapped = mapAgentMessagesToOpenAi(messages);
    expect(mapped[0]).toEqual({ role: 'assistant', content: 'final answer', tool_calls: undefined });
  });

  it('prunes older tool results beyond the recent window', () => {
    const big = 'x'.repeat(5000);
    const messages: AgentMessage[] = [
      { role: 'toolResult', toolCallId: 'c1', toolName: 'read', content: big, isError: false },
      { role: 'toolResult', toolCallId: 'c2', toolName: 'read', content: big, isError: false },
      { role: 'toolResult', toolCallId: 'c3', toolName: 'read', content: big, isError: false },
      { role: 'toolResult', toolCallId: 'c4', toolName: 'read', content: big, isError: false },
    ];
    const mapped = mapAgentMessagesToOpenAi(messages, {
      pastToolResultMaxChars: 100,
      keepRecentToolCount: 1,
    });
    // 첫 3개는 축약, 마지막 1개는 원본 유지
    for (let i = 0; i < 3; i++) {
      const entry = mapped[i] as { content: string };
      expect(entry.content.length).toBeLessThan(big.length);
      expect(entry.content).toContain('축약됨');
    }
    expect((mapped[3] as { content: string }).content).toBe(big);
  });

  it('maps tools to OpenAI function schema', () => {
    const tools: AgentTool[] = [
      {
        name: 'read',
        label: 'read',
        description: 'Read a file',
        parameters: z.object({ path: z.string() }),
        risk: 'low',
        execute: async () => ({ content: '' }),
      },
    ];
    const mapped = mapAgentToolsToOpenAi(tools) as Array<{
      type: string;
      function: { name: string; description: string; parameters: unknown };
    }>;
    expect(mapped).toHaveLength(1);
    expect(mapped[0].type).toBe('function');
    expect(mapped[0].function.name).toBe('read');
  });
});
