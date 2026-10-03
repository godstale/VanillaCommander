import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { chatQueueManager } from '@/lib/agent/chatQueueManager';
import { getSession } from '@/lib/db/repositories/sessionsRepo';
import { launchMacroRun } from './launch';
import type { Macro } from './types';

function makeMacro(overrides: Partial<Macro> = {}): Macro {
  return {
    id: 'macro-1',
    name: 'Morning',
    prompts: ['hello', '/usage', '/skill:pdf-tools do it'],
    agentId: null,
    runRoot: '',
    schedule: { kind: 'none' },
    lastResult: null,
    lastRunAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('launchMacroRun', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
    chatQueueManager.resetAll();
    vi.restoreAllMocks();
  });

  it('creates a macro session and queues prompts in order', async () => {
    const opened: Array<{ id: string; type: string; title: string }> = [];
    const sessionId = await launchMacroRun(makeMacro(), 'agent-1', (tab) => {
      opened.push(tab);
    });

    expect(sessionId).toBe('macro:macro-1');
    const session = await getSession(sessionId);
    expect(session?.origin).toBe('macro');
    expect(session?.agentId).toBe('agent-1');

    const queue = chatQueueManager.getQueue(sessionId);
    expect(queue.map((q) => q.text)).toEqual(['hello', '/usage', '/skill:pdf-tools do it']);
    expect(queue[0].type).toBe('message');
    expect(queue[1]).toMatchObject({ type: 'slash_command', commandName: 'usage' });
    expect(queue[2].type).toBe('skill');

    expect(opened).toEqual([
      {
        id: 'chat:macro:macro-1',
        type: 'chat',
        title: 'Morning',
        meta: { sessionId: 'macro:macro-1', agentId: 'agent-1' },
      },
    ]);
  });

  it('reuses the session and updates a changed agent', async () => {
    const noop = () => {};
    await launchMacroRun(makeMacro(), 'agent-1', noop);
    await launchMacroRun(makeMacro(), 'agent-2', noop);
    expect((await getSession('macro:macro-1'))?.agentId).toBe('agent-2');
    // 두 번째 실행분이 뒤에 추가된다.
    expect(chatQueueManager.getQueue('macro:macro-1')).toHaveLength(6);
  });
});
