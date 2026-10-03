// P11-40: 매크로 타입. 스케줄 실행(P11-41)이 이 정의를 그대로 쓴다.

/** 매크로 실행 스케줄 (P11-41 scheduler가 해석). */
export type MacroSchedule =
  | { kind: 'none' }
  | { kind: 'interval'; minutes: number; catchUp?: boolean }
  | { kind: 'daily'; time: string; catchUp?: boolean }
  | { kind: 'weekly'; weekday: number; time: string; catchUp?: boolean };

export const NO_SCHEDULE: MacroSchedule = { kind: 'none' };

export function isScheduleEnabled(schedule: MacroSchedule | null | undefined): boolean {
  return !!schedule && schedule.kind !== 'none';
}

export function describeSchedule(schedule: MacroSchedule): string {
  switch (schedule.kind) {
    case 'none':
      return '';
    case 'interval':
      return `${schedule.minutes}분 간격${schedule.catchUp ? ' · 보충' : ''}`;
    case 'daily':
      return `매일 ${schedule.time}${schedule.catchUp ? ' · 보충' : ''}`;
    case 'weekly':
      return `매주 ${['일', '월', '화', '수', '목', '금', '토'][schedule.weekday] ?? ''} ${schedule.time}${schedule.catchUp ? ' · 보충' : ''}`;
  }
}

export function parseSchedule(raw: unknown): MacroSchedule {
  if (typeof raw !== 'object' || raw === null) return { kind: 'none' };
  const v = raw as Record<string, unknown>;
  if (v.kind === 'interval' && typeof v.minutes === 'number' && Number.isFinite(v.minutes)) {
    return { kind: 'interval', minutes: Math.max(1, Math.floor(v.minutes)), catchUp: v.catchUp === true };
  }
  if (v.kind === 'daily' && typeof v.time === 'string' && /^\d{2}:\d{2}$/.test(v.time)) {
    return { kind: 'daily', time: v.time, catchUp: v.catchUp === true };
  }
  if (
    v.kind === 'weekly' &&
    typeof v.weekday === 'number' &&
    v.weekday >= 0 &&
    v.weekday <= 6 &&
    typeof v.time === 'string' &&
    /^\d{2}:\d{2}$/.test(v.time)
  ) {
    return { kind: 'weekly', weekday: Math.floor(v.weekday), time: v.time, catchUp: v.catchUp === true };
  }
  return { kind: 'none' };
}

export interface Macro {
  id: string;
  name: string;
  prompts: string[];
  /** null이면 기본 에이전트. */
  agentId: string | null;
  /** 실행 위치. ''이면 작업 폴더. */
  runRoot: string;
  schedule: MacroSchedule;
  lastResult: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MacroDraft {
  name: string;
  prompts: string[];
  agentId: string | null;
  runRoot: string;
  schedule: MacroSchedule;
}

/** 첫 프롬프트 앞부분으로 매크로 이름을 자동 할당한다. 중복 시 (2), (3)을 붙인다. */
export function buildMacroName(prompts: string[], existingNames: string[] = []): string {
  const first = (prompts[0] ?? '').replace(/^[/#]\w+:\w+\s*/, '').replace(/\s+/g, ' ').trim();
  const snippet = first.length > 24 ? `${first.slice(0, 24)}...` : first;
  const base = snippet
    ? prompts.length > 1
      ? `${snippet} 외 ${prompts.length - 1}건`
      : snippet
    : `Macro ${new Date().toLocaleString()} (${prompts.length}건)`;
  if (!existingNames.includes(base)) return base;
  let n = 2;
  while (existingNames.includes(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
