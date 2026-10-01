import { describe, it, expect, vi } from 'vitest';
import { composeHooks } from './hooks';
import type { AgentHooks, BeforeToolCallContext } from './hooks';
import type { AgentMessage } from './types';

describe('composeHooks', () => {
  const dummyCtx: BeforeToolCallContext = {
    toolCallId: 'call-1',
    toolName: 'write',
    arguments: {},
    risk: 'high',
  };
  const dummySignal = new AbortController().signal;

  it('short-circuits beforeToolCall on block', async () => {
    const hook1: AgentHooks = {
      beforeToolCall: vi.fn().mockResolvedValue({ block: true, reason: 'Denied by user' }),
    };
    const hook2: AgentHooks = {
      beforeToolCall: vi.fn().mockResolvedValue({ block: false }),
    };

    const composed = composeHooks(hook1, hook2);
    const result = await composed.beforeToolCall?.(dummyCtx, dummySignal);

    expect(result).toEqual({ block: true, reason: 'Denied by user' });
    expect(hook1.beforeToolCall).toHaveBeenCalled();
    expect(hook2.beforeToolCall).not.toHaveBeenCalled();
  });

  it('chains transformContext sequentially in registration order', async () => {
    const hook1: AgentHooks = {
      transformContext: vi.fn().mockImplementation(async (msgs: AgentMessage[]) => {
        return [...msgs, { role: 'user', content: 'hook1 added' }];
      }),
    };
    const hook2: AgentHooks = {
      transformContext: vi.fn().mockImplementation(async (msgs: AgentMessage[]) => {
        return [...msgs, { role: 'user', content: 'hook2 added' }];
      }),
    };

    const composed = composeHooks(hook1, hook2);
    const initial: AgentMessage[] = [{ role: 'system', content: 'base' }];
    const result = await composed.transformContext?.(initial, dummySignal);

    expect(result).toHaveLength(3);
    expect(result?.[1].content).toBe('hook1 added');
    expect(result?.[2].content).toBe('hook2 added');
  });

  it('merges afterToolCall results in order', async () => {
    const hook1: AgentHooks = {
      afterToolCall: vi.fn().mockResolvedValue({ content: 'hook1 content' }),
    };
    const hook2: AgentHooks = {
      afterToolCall: vi.fn().mockResolvedValue({ isError: true }),
    };

    const composed = composeHooks(hook1, hook2);
    const result = await composed.afterToolCall?.(
      {
        toolCallId: '1',
        toolName: 'read',
        arguments: {},
        result: { content: 'original' },
      },
      dummySignal,
    );

    expect(result).toEqual({ content: 'hook1 content', isError: true });
  });
});
