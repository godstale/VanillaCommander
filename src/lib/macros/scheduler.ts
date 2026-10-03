// P11-41: 매크로 스케줄러. 1분 틱, 놓친 실행 보충(D7), 동시 실행 1개,
// 채팅 실행 중이면 대기. 승인은 절대 자동화하지 않고 대기 알림만 낸다.
import { chatQueueManager } from '@/lib/agent/chatQueueManager';
import { approvalBus } from '@/lib/approval/approvalBus';
import { launchMacroRun } from './launch';
import {
  isScheduleEnabled,
  type Macro,
  type MacroSchedule,
} from './types';

export interface MacroSchedulerContext {
  listMacros: () => Promise<Macro[]>;
  getDefaultAgentId: () => string;
  resolveAgentId: (macro: Macro) => string;
  openChatTab: (tab: { id: string; type: 'chat'; title: string; meta?: Record<string, unknown> }) => void;
  recordRun: (id: string, patch: { lastRunAt?: string; lastResult?: string | null }) => Promise<void>;
  /** 승인 대기 알림 (호출자가 StatusBar 등에 표시). */
  onApprovalNeeded?: (macro: Macro) => void;
  now?: () => Date;
  tickMs?: number;
}

export interface DueResult {
  due: boolean;
  /** 한 주기 이상 놓친 오래된 슬롯인가 (catchUp=false면 건너뛰고 소진). */
  stale: boolean;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function slotToday(time: string, now: Date): Date {
  const [h, m] = time.split(':').map(Number);
  const slot = startOfDay(now);
  slot.setHours(h, m, 0, 0);
  return slot;
}

/** 가장 최근에 지난 (weekday, time) 슬롯. 오늘 아직 안 지났으면 지난주 같은 요일. */
function latestWeeklySlot(weekday: number, time: string, now: Date): Date {
  const [h, m] = time.split(':').map(Number);
  const slot = startOfDay(now);
  const delta = (now.getDay() - weekday + 7) % 7;
  slot.setDate(slot.getDate() - delta);
  slot.setHours(h, m, 0, 0);
  if (slot.getTime() > now.getTime()) {
    slot.setDate(slot.getDate() - 7);
  }
  return slot;
}

/**
 * 스케줄 만기 판정 (순수 함수). lastRunAt은 ISO 문자열, null이면 첫 실행이다.
 * interval 첫 실행은 즉시 due (예측 가능한 시작).
 */
export function computeDue(
  schedule: MacroSchedule,
  lastRunAt: string | null,
  now: Date = new Date(),
): DueResult {
  const none = { due: false, stale: false };
  const last = lastRunAt ? new Date(lastRunAt).getTime() : null;
  const lastValid = last !== null && !Number.isNaN(last);
  switch (schedule.kind) {
    case 'none':
      return none;
    case 'interval': {
      if (!lastValid) return { due: true, stale: false };
      const periodMs = schedule.minutes * 60_000;
      if (now.getTime() < (last as number) + periodMs) return none;
      // 마지막 실행 후 한 주기를 초과했으면 그 사이 슬롯을 놓친 것이다.
      return { due: true, stale: now.getTime() - (last as number) > periodMs };
    }
    case 'daily': {
      const slot = slotToday(schedule.time, now);
      if (now.getTime() < slot.getTime()) return none;
      if (lastValid && (last as number) >= slot.getTime()) return none;
      const stale = lastValid && now.getTime() - (last as number) > 24 * 3_600_000;
      return { due: true, stale };
    }
    case 'weekly': {
      const slot = latestWeeklySlot(schedule.weekday, schedule.time, now);
      if (lastValid && (last as number) >= slot.getTime()) return none;
      const stale = lastValid && now.getTime() - (last as number) > 7 * 24 * 3_600_000;
      return { due: true, stale };
    }
  }
}

// -- 실행 상태 (모듈 싱글톤) --

let ctx: MacroSchedulerContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let approvalUnsub: (() => void) | null = null;
/** 실행 중 매크로 id → 세션 id. 동시 실행 1개이므로 크기는 0 또는 1이다. */
const running = new Map<string, string>();

export function configureMacroScheduler(next: MacroSchedulerContext): void {
  ctx = next;
}

function catchUpOf(macro: Macro): boolean {
  const s = macro.schedule;
  return s.kind !== 'none' && (s.catchUp ?? false);
}

async function launchDue(macro: Macro, now: Date): Promise<void> {
  if (!ctx) return;
  const agentId = ctx.resolveAgentId(macro);
  const sessionId = await launchMacroRun(macro, agentId, ctx.openChatTab);
  running.set(macro.id, sessionId);
  await ctx.recordRun(macro.id, {
    lastRunAt: now.toISOString(),
    lastResult: `${macro.prompts.length}건 실행 시작`,
  });
}

async function finishDrained(): Promise<void> {
  if (!ctx || running.size === 0) return;
  for (const [macroId, sessionId] of [...running]) {
    const busy = chatQueueManager.getBusySessionId();
    if (busy !== null && busy === sessionId) continue;
    if (chatQueueManager.getQueue(sessionId).length > 0) continue;
    running.delete(macroId);
    await ctx.recordRun(macroId, {
      lastResult: `${new Date().toLocaleString()} 실행 완료 (세션에서 전체 대화 확인)`,
    });
  }
}

/** 스케줄 틱 1회. 테스트·수동 트리거 진입점. */
export async function tickMacroScheduler(now?: Date): Promise<void> {
  if (!ctx) return;
  const at = now ?? ctx.now?.() ?? new Date();
  await finishDrained();
  // 동시 실행 1개: 진행 중이면 새 실행을 시작하지 않는다.
  if (running.size > 0) return;
  // 채팅 실행 중이면 대기한다 (lastRunAt을 건드리지 않아 다음 틱에 재시도).
  if (chatQueueManager.getBusySessionId() !== null) return;
  let macros: Macro[];
  try {
    macros = await ctx.listMacros();
  } catch {
    return;
  }
  for (const macro of macros) {
    if (running.size > 0) return;
    if (!isScheduleEnabled(macro.schedule)) continue;
    const { due, stale } = computeDue(macro.schedule, macro.lastRunAt, at);
    if (!due) continue;
    if (stale && !catchUpOf(macro)) {
      // 보충 옵션이 꺼진 오래된 슬롯은 실행 없이 소진한다.
      await ctx.recordRun(macro.id, { lastRunAt: at.toISOString() });
      continue;
    }
    try {
      await launchDue(macro, at);
    } catch {
      // 다음 틱에 재시도한다.
    }
    return;
  }
}

export function startMacroScheduler(): void {
  if (timer) return;
  const interval = ctx?.tickMs ?? 60_000;
  if (!approvalUnsub) {
    approvalUnsub = approvalBus.subscribe((request) => {
      if (!request || running.size === 0 || !ctx) return;
      void ctx.listMacros().then((macros) => {
        const macro = macros.find((m) => running.has(m.id));
        if (macro) ctx?.onApprovalNeeded?.(macro);
      });
    });
  }
  timer = setInterval(() => {
    void tickMacroScheduler();
  }, interval);
  void tickMacroScheduler();
}

export function stopMacroScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  approvalUnsub?.();
  approvalUnsub = null;
  running.clear();
}

/** 테스트용: 실행 중 매크로 수. */
export function runningMacroCount(): number {
  return running.size;
}
