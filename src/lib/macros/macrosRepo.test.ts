import { describe, it, expect, beforeEach } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import {
  createMacro,
  deleteMacro,
  getMacro,
  listMacros,
  updateMacro,
} from './macrosRepo';

describe('macrosRepo', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
  });

  it('creates, reads, updates, and deletes macros', async () => {
    const created = await createMacro({
      name: 'Morning digest',
      prompts: ['summarize inbox', '/usage'],
      agentId: 'agent-1',
      runRoot: 'C:/work',
      schedule: { kind: 'interval', minutes: 30, catchUp: true },
    });
    expect(created.prompts).toHaveLength(2);
    expect(created.schedule).toEqual({ kind: 'interval', minutes: 30, catchUp: true });

    const loaded = await getMacro(created.id);
    expect(loaded?.name).toBe('Morning digest');

    const updated = await updateMacro(created.id, {
      prompts: ['a', ' ', 'b'],
      schedule: { kind: 'none' },
      lastResult: 'ok',
      lastRunAt: '2026-01-01T00:00:00.000Z',
    });
    expect(updated?.prompts).toEqual(['a', 'b']);
    expect(updated?.lastResult).toBe('ok');

    expect((await listMacros())).toHaveLength(1);
    await deleteMacro(created.id);
    expect(await getMacro(created.id)).toBeNull();
  });

  it('returns null for unknown ids', async () => {
    expect(await getMacro('missing')).toBeNull();
    expect(await updateMacro('missing', { name: 'x' })).toBeNull();
  });
});
