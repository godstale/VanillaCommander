import { describe, expect, it, beforeEach } from 'vitest';
import { chatQueueManager } from '@/lib/agent/chatQueueManager';
import { evalLock } from './evalLock';

describe('evalLock', () => {
  beforeEach(() => {
    chatQueueManager.resetAll();
    const current = evalLock.get();
    if (current) evalLock.release(current.runId);
  });

  it('acquires when no chat is busy and exposes a pseudo busy session', () => {
    expect(evalLock.acquire('run-1', 'Test run')).toBe(true);
    expect(evalLock.get()?.runId).toBe('run-1');
    expect(chatQueueManager.getBusySessionId()).toBe('eval:run-1');
    expect(chatQueueManager.isOtherSessionBusy('chat:abc')).toBe(true);
  });

  it('fails to acquire while a chat is busy', () => {
    chatQueueManager.setSessionRunning('chat:abc', true);
    expect(evalLock.acquire('run-1', 'Test run')).toBe(false);
    expect(evalLock.get()).toBeNull();
  });

  it('fails to acquire while another evaluation holds the lock', () => {
    expect(evalLock.acquire('run-1', 'First')).toBe(true);
    expect(evalLock.acquire('run-2', 'Second')).toBe(false);
    expect(evalLock.get()?.runId).toBe('run-1');
  });

  it('ignores release with a mismatched runId', () => {
    expect(evalLock.acquire('run-1', 'Test run')).toBe(true);
    evalLock.release('run-other');
    expect(evalLock.get()?.runId).toBe('run-1');
    evalLock.release('run-1');
    expect(evalLock.get()).toBeNull();
    expect(chatQueueManager.getBusySessionId()).toBeNull();
  });

  it('notifies subscribers on acquire and release', () => {
    let notifications = 0;
    const unsubscribe = evalLock.subscribe(() => {
      notifications += 1;
    });
    evalLock.acquire('run-1', 'Test run');
    evalLock.release('run-1');
    unsubscribe();
    expect(notifications).toBe(2);
  });
});
