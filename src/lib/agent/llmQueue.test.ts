import { beforeEach, describe, expect, it, vi } from 'vitest';
import { llmQueue, LlmQueueCancelledError } from './llmQueue';

describe('llmQueue', () => {
  beforeEach(() => {
    llmQueue.resetAll();
  });

  it('runs transactions one at a time in FIFO order', async () => {
    const a = await llmQueue.acquire('chat', 'a');
    let bGranted = false;
    const bPromise = llmQueue.acquire('wiki', 'b').then((l) => {
      bGranted = true;
      return l;
    });
    await Promise.resolve();
    expect(bGranted).toBe(false);
    expect(llmQueue.getSnapshot().map((t) => t.status)).toEqual(['running', 'queued']);
    a.release();
    const b = await bPromise;
    expect(llmQueue.getSnapshot().map((t) => t.label)).toEqual(['b']);
    b.release();
    expect(llmQueue.getSnapshot()).toHaveLength(0);
  });

  it('rejects a queued transaction when removed', async () => {
    const a = await llmQueue.acquire('chat', 'a');
    const pending = llmQueue.acquire('wiki', 'b');
    llmQueue.remove(llmQueue.getSnapshot()[1].id);
    await expect(pending).rejects.toBeInstanceOf(LlmQueueCancelledError);
    a.release();
  });

  it('aborts the running transaction on remove and starts the next', async () => {
    const a = await llmQueue.acquire('chat', 'a');
    const bPromise = llmQueue.acquire('wiki', 'b');
    llmQueue.remove(a.id);
    expect(a.signal.aborted).toBe(true);
    const b = await bPromise;
    a.release(); // 이미 종료된 lease는 무해해야 한다
    expect(llmQueue.getSnapshot().map((t) => t.label)).toEqual(['b']);
    b.release();
  });

  it('aborts a running transaction after the timeout', async () => {
    vi.useFakeTimers();
    try {
      llmQueue.setTimeoutMinutes(1);
      const a = await llmQueue.acquire('chat', 'a');
      vi.advanceTimersByTime(60_000);
      expect(a.signal.aborted).toBe(true);
      expect(llmQueue.getSnapshot()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clear drops everything', async () => {
    const a = await llmQueue.acquire('chat', 'a');
    const pending = llmQueue.acquire('wiki', 'b');
    llmQueue.clear();
    await expect(pending).rejects.toBeInstanceOf(LlmQueueCancelledError);
    expect(a.signal.aborted).toBe(true);
    expect(llmQueue.getSnapshot()).toHaveLength(0);
  });
});
