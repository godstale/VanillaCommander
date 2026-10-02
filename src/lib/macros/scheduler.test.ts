import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import { chatQueueManager } from '@/lib/agent/chatQueueManager';
import { approvalBus } from '@/lib/approval/approvalBus';
import {
  computeDue,
  configureMacroScheduler,
  runningMacroCount,
  startMacroScheduler,
  stopMacroScheduler,
  tickMacroScheduler,
  type MacroSchedulerContext,
} from './scheduler';
import { getMacro } from './macrosRepo';
import type { Macro } from './types';

function makeMacro(overrides: Partial<Macro> = {}): Macro {
  return {
    id: 'macro-1',
    name: 'M',
    prompts: ['hello'],
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

describe('computeDue', () => {
  it('never fires without a schedule', () => {
    expect(computeDue({ kind: 'none' }, null, new Date(2026, 9, 3, 10, 0))).toEqual({
      due: false,
      stale: false,
    });
  });

  it('fires interval schedules promptly on first run', () => {
    const now = new Date(2026, 9, 3, 10, 0);
    expect(computeDue({ kind: 'interval', minutes: 60 }, null, now).due).toBe(true);
    const last = new Date(2026, 9, 3, 9, 30).toISOString();
    expect(computeDue({ kind: 'interval', minutes: 60 }, last, now).due).toBe(false);
    // 한 주기를 초과해서 지났으면 stale이다.
    const old = new Date(2026, 9, 3, 8, 0).toISOString();
    expect(computeDue({ kind: 'interval', minutes: 60 }, old, now)).toEqual({
      due: true,
      stale: true,
    });
  });

  it('fires daily slots once per day', () => {
    const morning = new Date(2026, 9, 3, 10, 0);
    const sched = { kind: 'daily', time: '09:00' } as const;
    expect(computeDue(sched, null, morning).due).toBe(true);
    expect(computeDue(sched, new Date(2026, 9, 2, 9, 5).toISOString(), morning).due).toBe(true);
    expect(computeDue(sched, new Date(2026, 9, 3, 9, 5).toISOString(), morning).due).toBe(false);
    // 슬롯 이전에는 실행하지 않는다.
    expect(computeDue(sched, null, new Date(2026, 9, 3, 8, 59)).due).toBe(false);
  });

  it('fires weekly slots for the most recent occurrence', () => {
    // 2026-10-03은 토요일. 월요일(1) 09:00 슬롯은 9/28이다.
    const sat = new Date(2026, 9, 3, 10, 0);
    const sched = { kind: 'weekly', weekday: 1, time: '09:00' } as const;
    expect(computeDue(sched, null, sat).due).toBe(true);
    expect(computeDue(sched, new Date(2026, 8, 28, 9, 5).toISOString(), sat).due).toBe(false);
    // 9/21 실행분은 9/28 슬롯을 놓쳤고 한 주기도 초과했으므로 stale이다.
    expect(computeDue(sched, new Date(2026, 8, 21, 9, 5).toISOString(), sat)).toEqual({
      due: true,
      stale: true,
    });
  });
});

describe('macro scheduler tick', () => {
  let macros: Macro[];
  let opened: Array<{ id: string }>;
  let recorded: Array<{ id: string; patch: { lastRunAt?: string; lastResult?: string | null } }>;
  let approvals: Macro[];

  function baseCtx(): MacroSchedulerContext {
    return {
      listMacros: async () => macros,
      getDefaultAgentId: () => 'agent-1',
      resolveAgentId: () => 'agent-1',
      openChatTab: (tab) => {
        opened.push(tab);
      },
      recordRun: async (id, patch) => {
        recorded.push({ id, patch });
        const target = macros.find((m) => m.id === id);
        if (target) {
          if (patch.lastRunAt !== undefined) target.lastRunAt = patch.lastRunAt;
          if (patch.lastResult !== undefined) target.lastResult = patch.lastResult;
        }
      },
      onApprovalNeeded: (macro) => {
        approvals.push(macro);
      },
      now: () => new Date(2026, 9, 3, 10, 0),
    };
  }

  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
    chatQueueManager.resetAll();
    stopMacroScheduler();
    macros = [];
    opened = [];
    recorded = [];
    approvals = [];
    vi.restoreAllMocks();
  });

  afterEach(() => {
    stopMacroScheduler();
    chatQueueManager.resetAll();
  });

  it('launches due macros and marks them running', async () => {
    macros = [makeMacro({ schedule: { kind: 'interval', minutes: 5 } })];
    configureMacroScheduler(baseCtx());
    await tickMacroScheduler();
    expect(opened).toHaveLength(1);
    expect(opened[0].id).toBe('chat:macro:macro-1');
    expect(runningMacroCount()).toBe(1);
    expect(recorded[0].patch.lastRunAt).toBeDefined();
    // 동시 실행 1개: 두 번째 틱은 시작하지 않는다.
    await tickMacroScheduler();
    expect(opened).toHaveLength(1);
  });

  it('waits while a chat session is busy', async () => {
    macros = [makeMacro({ schedule: { kind: 'interval', minutes: 5 } })];
    configureMacroScheduler(baseCtx());
    chatQueueManager.setSessionBusy('other-chat');
    await tickMacroScheduler();
    expect(opened).toHaveLength(0);
    chatQueueManager.setSessionIdle('other-chat');
    await tickMacroScheduler();
    expect(opened).toHaveLength(1);
  });

  it('consumes stale slots without catch-up', async () => {
    macros = [
      makeMacro({
        schedule: { kind: 'interval', minutes: 60 },
        lastRunAt: new Date(2026, 9, 2, 10, 0).toISOString(),
      }),
    ];
    configureMacroScheduler(baseCtx());
    await tickMacroScheduler();
    expect(opened).toHaveLength(0);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].patch.lastRunAt).toBe(new Date(2026, 9, 3, 10, 0).toISOString());
  });

  it('notifies when an approval request appears during a run', async () => {
    macros = [makeMacro({ schedule: { kind: 'interval', minutes: 5 } })];
    configureMacroScheduler(baseCtx());
    startMacroScheduler();
    await tickMacroScheduler();
    expect(runningMacroCount()).toBe(1);
    // 전역 승인 다이얼로그가 열리면 스케줄러도 알림 콜백을 탄다.
    const decision = approvalBus.request({
      id: 'appr-1',
      toolCallId: 'tc-1',
      toolName: 'fs_trash',
      arguments: {},
      risk: 'high',
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(approvals.map((m) => m.id)).toEqual(['macro-1']);
    approvalBus.resolve('appr-1', { approved: false });
    await decision;
  });

  it('writes the run result back to the macro row', async () => {
    const { createMacro } = await import('./macrosRepo');
    const created = await createMacro({
      name: 'M',
      prompts: ['hello'],
      agentId: null,
      runRoot: '',
      schedule: { kind: 'interval', minutes: 5 },
    });
    macros = [{ ...created, schedule: { kind: 'interval', minutes: 5 } }];
    configureMacroScheduler({
      ...baseCtx(),
      recordRun: async (id, patch) => {
        const { updateMacro } = await import('./macrosRepo');
        await updateMacro(id, patch);
      },
    });
    await tickMacroScheduler();
    const afterLaunch = await getMacro(created.id);
    expect(afterLaunch?.lastRunAt).toBeDefined();
    expect(afterLaunch?.lastResult).toContain('실행 시작');
  });
});
