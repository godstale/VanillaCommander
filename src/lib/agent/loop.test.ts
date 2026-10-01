import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { FortressAgent } from '@/lib/agent/agent';
import type { AgentTool, AgentEvent } from '@/lib/agent/types';
import type { OllamaChunk } from '@/lib/llm/ollamaClient';

// Helper to create async generator from chunks
async function* createMockStream(chunks: OllamaChunk[]): AsyncIterable<OllamaChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('FortressAgent and runAgentLoop', () => {
  it('(a) text-only response', async () => {
    const mockStreamFn = vi.fn().mockImplementation(() => {
      return createMockStream([
        { content: 'Hello', done: false },
        { content: ' world!', done: true },
      ]);
    });

    const events: AgentEvent[] = [];
    const agent = new FortressAgent({
      agent: { model: 'test-model' },
      streamChatFn: mockStreamFn,
    });
    agent.subscribe((e) => events.push(e));

    const messages = await agent.prompt('Hi');

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: 'Hi' });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Hello world!',
      stopReason: 'stop',
    });

    expect(events.some((e) => e.type === 'agent_start')).toBe(true);
    expect(events.some((e) => e.type === 'message_update')).toBe(true);
    expect(events.some((e) => e.type === 'agent_end')).toBe(true);
  });

  it('(b) single tool call -> result -> subsequent response', async () => {
    let callCount = 0;
    const mockStreamFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First turn: assistant calls tool
        return createMockStream([
          {
            content: 'Let me check.',
            toolCalls: [
              {
                function: {
                  name: 'calculator',
                  arguments: { a: 2, b: 3 },
                },
              },
            ],
            done: true,
          },
        ]);
      } else {
        // Second turn: assistant answers with tool result
        return createMockStream([
          {
            content: 'The sum is 5.',
            done: true,
          },
        ]);
      }
    });

    const calcTool: AgentTool = {
      name: 'calculator',
      label: 'Calculator',
      description: 'Adds two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      risk: 'low',
      execute: async (_id, params: { a: number; b: number }) => {
        return { content: `Result: ${params.a + params.b}` };
      },
    };

    const agent = new FortressAgent({
      agent: { model: 'test-model' },
      tools: [calcTool],
      streamChatFn: mockStreamFn,
    });

    const messages = await agent.prompt('What is 2 + 3?');

    // Expected sequence: user -> assistant (toolCall) -> toolResult -> assistant (final answer)
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].role === 'assistant' && messages[1].toolCalls?.length).toBe(1);
    expect(messages[2].role).toBe('toolResult');
    expect(messages[2].role === 'toolResult' && messages[2].content).toBe('Result: 5');
    expect(messages[3].role).toBe('assistant');
    expect(messages[3].role === 'assistant' && messages[3].content).toBe('The sum is 5.');
  });

  it('(c) parallel tool calls preserve result order', async () => {
    let turn = 0;
    const mockStreamFn = vi.fn().mockImplementation(() => {
      turn++;
      if (turn === 1) {
        return createMockStream([
          {
            toolCalls: [
              { function: { name: 'toolA', arguments: { val: 'A' } } },
              { function: { name: 'toolB', arguments: { val: 'B' } } },
            ],
            done: true,
          },
        ]);
      }
      return createMockStream([{ content: 'Done both tools', done: true }]);
    });

    // Tool A takes longer than Tool B to test order preservation
    const toolA: AgentTool = {
      name: 'toolA',
      label: 'Tool A',
      description: 'Slow tool',
      parameters: z.object({ val: z.string() }),
      risk: 'low',
      execute: async () => {
        await new Promise((r) => setTimeout(r, 20));
        return { content: 'Result of A' };
      },
    };

    const toolB: AgentTool = {
      name: 'toolB',
      label: 'Tool B',
      description: 'Fast tool',
      parameters: z.object({ val: z.string() }),
      risk: 'low',
      execute: async () => {
        return { content: 'Result of B' };
      },
    };

    const agent = new FortressAgent({
      agent: { model: 'test-model' },
      tools: [toolA, toolB],
      streamChatFn: mockStreamFn,
    });

    const messages = await agent.prompt('Run A and B');

    // user -> assistant -> toolResult A -> toolResult B -> assistant
    expect(messages).toHaveLength(5);
    expect(messages[2].role).toBe('toolResult');
    expect(messages[2].role === 'toolResult' && messages[2].toolName).toBe('toolA');
    expect(messages[2].role === 'toolResult' && messages[2].content).toBe('Result of A');

    expect(messages[3].role).toBe('toolResult');
    expect(messages[3].role === 'toolResult' && messages[3].toolName).toBe('toolB');
    expect(messages[3].role === 'toolResult' && messages[3].content).toBe('Result of B');
  });

  it('(d) tool throw does not break conversation, records isError: true and continues', async () => {
    let turn = 0;
    const mockStreamFn = vi.fn().mockImplementation(() => {
      turn++;
      if (turn === 1) {
        return createMockStream([
          {
            toolCalls: [
              { function: { name: 'failingTool', arguments: {} } },
            ],
            done: true,
          },
        ]);
      }
      return createMockStream([
        { content: 'I see the tool failed. Let me explain.', done: true },
      ]);
    });

    const failingTool: AgentTool = {
      name: 'failingTool',
      label: 'Failing Tool',
      description: 'Throws an error',
      parameters: z.object({}),
      risk: 'low',
      execute: async () => {
        throw new Error('Database disk full');
      },
    };

    const agent = new FortressAgent({
      agent: { model: 'test-model' },
      tools: [failingTool],
      streamChatFn: mockStreamFn,
    });

    const messages = await agent.prompt('Try to run failing tool');

    expect(messages).toHaveLength(4);
    expect(messages[2].role).toBe('toolResult');
    if (messages[2].role === 'toolResult') {
      expect(messages[2].isError).toBe(true);
      expect(messages[2].content).toContain('Database disk full');
    }
    expect(messages[3].role).toBe('assistant');
    if (messages[3].role === 'assistant') {
      expect(messages[3].content).toBe('I see the tool failed. Let me explain.');
    }
  });

  it('(e) abort() terminates immediately', async () => {
    const mockStreamFn = vi.fn().mockImplementation((_req, signal?: AbortSignal) => {
      return (async function* () {
        yield { content: 'Starting...', done: false };
        // Wait or check abort
        for (let i = 0; i < 50; i++) {
          if (signal?.aborted) {
            throw new Error('Operation aborted');
          }
          await new Promise((r) => setTimeout(r, 10));
          yield { content: ` Chunk ${i}`, done: false };
        }
        yield { done: true };
      })();
    });

    const agent = new FortressAgent({
      agent: { model: 'test-model' },
      streamChatFn: mockStreamFn,
    });

    const promptPromise = agent.prompt('Stream a lot');
    setTimeout(() => {
      agent.abort();
    }, 25);

    const messages = await promptPromise;
    expect(agent.state).toBe('idle');
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    if (assistantMsg && assistantMsg.role === 'assistant') {
      expect(assistantMsg.stopReason).toBe('aborted');
    }
  });

  it('(f) think value reaches the Ollama request and setThink updates it live', async () => {
    const seenThink: unknown[] = [];
    const mockStreamFn = vi.fn().mockImplementation((req: { think?: unknown }) => {
      seenThink.push(req.think);
      return createMockStream([{ content: 'ok', done: true }]);
    });

    const agent = new FortressAgent({
      agent: { model: 'test-model', think: 'high' },
      streamChatFn: mockStreamFn,
    });

    await agent.prompt('First');
    expect(seenThink[0]).toBe('high');

    // Live update applies from the next prompt() call without rebuilding the agent
    agent.setThink('low');
    await agent.prompt('Second');
    expect(seenThink[1]).toBe('low');

    // Unset → think omitted (model default)
    agent.setThink(undefined);
    await agent.prompt('Third');
    expect(seenThink[2]).toBeUndefined();
  });
});
