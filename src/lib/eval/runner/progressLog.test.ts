import { describe, expect, it } from 'vitest';
import {
  createMemoryProgressLogStore,
  makeRecord,
  mergeLogEvents,
  parseProgressLog,
  ProgressLogWriter,
  toPersistedLogs,
  toPersistedResources,
} from './progressLog';

describe('progressLog', () => {
  it('round-trips records through the memory store', async () => {
    const store = createMemoryProgressLogStore();
    const writer = new ProgressLogWriter(store, 'run-1', undefined, 100);
    writer.record(makeRecord('run-1', { kind: 'run_status', status: 'running' }));
    writer.record(makeRecord('run-1', { kind: 'log', level: 'warn', message: 'slow trial' }));
    expect(writer.pending).toBe(2);
    await writer.close();
    expect(writer.pending).toBe(0);

    const readout = await store.read('run-1');
    const records = parseProgressLog(readout.text);
    expect(records).toHaveLength(2);
    expect(records[0].kind).toBe('run_status');
    expect(records[1].kind).toBe('log');
  });

  it('auto-flushes when the batch fills', async () => {
    const store = createMemoryProgressLogStore();
    const writer = new ProgressLogWriter(store, 'run-1', undefined, 2);
    writer.record(makeRecord('run-1', { kind: 'run_status', status: 'running' }));
    writer.record(makeRecord('run-1', { kind: 'run_status', status: 'judging' }));
    await writer.close();
    expect(store.linesOf('run-1')).toHaveLength(2);
  });

  it('skips corrupt lines when parsing', () => {
    const good = JSON.stringify(
      makeRecord('run-1', { kind: 'log', level: 'error', message: 'boom' }),
    );
    const records = parseProgressLog(`not json\n${good}\n{"v":1,"kind":"nope"}\n`);
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('log');
  });

  it('projects logs and resource points for the UI', () => {
    const records = [
      makeRecord('run-1', { kind: 'log', level: 'warn' as const, message: 'skipped pack' }),
      makeRecord('run-1', {
        kind: 'resource',
        vramUsedMb: 8000,
        gpuUtilPct: 55,
        gpuTempC: 60,
        decodeTps: 42,
      }),
    ];
    const logs = toPersistedLogs(records);
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('skipped pack');
    const points = toPersistedResources(records);
    expect(points).toHaveLength(1);
    expect(points[0].vramUsedMb).toBe(8000);
    expect(points[0].decodeTps).toBe(42);
  });

  it('marks the writer broken instead of throwing when the store fails', async () => {
    const failing = {
      append: async () => {
        throw new Error('disk full');
      },
      read: async () => ({ text: '', truncated: false }),
    };
    const writer = new ProgressLogWriter(failing, 'run-1');
    writer.record(makeRecord('run-1', { kind: 'run_status', status: 'running' }));
    await writer.close();
    expect(writer.failed).toBe(true);
    expect(writer.pending).toBe(0);
  });

  it('merges file history with live events without duplicating overlap', () => {
    const persisted = [
      { ts: '2026-09-27T00:00:00.000Z', level: 'warn' as const, message: 'slow trial' },
      { ts: '2026-09-27T00:00:01.000Z', level: 'info' as const, message: 'pause requested' },
    ];
    const live = [
      { level: 'warn' as const, message: 'slow trial' },
      { level: 'info' as const, message: 'pause requested' },
      { level: 'error' as const, message: 'new failure' },
    ];
    const merged = mergeLogEvents(persisted, live);
    expect(merged.map((e) => e.message)).toEqual(['slow trial', 'pause requested', 'new failure']);
  });
});
