import { describe, it, expect } from 'vitest';
import {
  buildMacroName,
  describeSchedule,
  isScheduleEnabled,
  parseSchedule,
} from './types';

describe('macro types', () => {
  it('builds names from the first prompt with dedup suffix', () => {
    expect(buildMacroName(['hello world'], [])).toBe('hello world');
    expect(buildMacroName(['a', 'b'], [])).toBe('a 외 1건');
    expect(buildMacroName(['hello world'], ['hello world'])).toBe('hello world (2)');
    expect(buildMacroName([], [])).toContain('Macro');
  });

  it('parses schedules defensively', () => {
    expect(parseSchedule(null)).toEqual({ kind: 'none' });
    expect(parseSchedule({ kind: 'interval', minutes: 30 })).toEqual({
      kind: 'interval',
      minutes: 30,
      catchUp: false,
    });
    expect(parseSchedule({ kind: 'daily', time: '9:00' })).toEqual({ kind: 'none' });
    expect(parseSchedule({ kind: 'daily', time: '09:00' })).toEqual({
      kind: 'daily',
      time: '09:00',
      catchUp: false,
    });
    expect(parseSchedule({ kind: 'weekly', weekday: 9, time: '09:00' })).toEqual({
      kind: 'none',
    });
    expect(parseSchedule({ kind: 'weekly', weekday: 1, time: '09:00', catchUp: true })).toEqual({
      kind: 'weekly',
      weekday: 1,
      time: '09:00',
      catchUp: true,
    });
  });

  it('describes schedules and detects enabled ones', () => {
    expect(isScheduleEnabled({ kind: 'none' })).toBe(false);
    expect(isScheduleEnabled({ kind: 'interval', minutes: 5 })).toBe(true);
    expect(describeSchedule({ kind: 'none' })).toBe('');
    expect(describeSchedule({ kind: 'interval', minutes: 5 })).toContain('5분');
    expect(describeSchedule({ kind: 'daily', time: '09:00' })).toContain('매일');
    expect(describeSchedule({ kind: 'weekly', weekday: 1, time: '09:00' })).toContain('월');
  });
});
