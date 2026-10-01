import { useSyncExternalStore } from 'react';
import { chatQueueManager } from '@/lib/agent/chatQueueManager';

export interface EvalLockState {
  runId: string;
  runName: string;
  startedAt: number;
}

export const EVAL_PSEUDO_SESSION_PREFIX = 'eval:';

let lock: EvalLockState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function pseudoSessionId(runId: string): string {
  return `${EVAL_PSEUDO_SESSION_PREFIX}${runId}`;
}

export const evalLock = {
  acquire(runId: string, runName: string): boolean {
    if (lock !== null) return false;
    if (chatQueueManager.getBusySessionId() !== null) return false;
    lock = { runId, runName, startedAt: Date.now() };
    chatQueueManager.setSessionRunning(pseudoSessionId(runId), true);
    emit();
    return true;
  },
  release(runId: string): void {
    if (lock === null || lock.runId !== runId) return;
    const sid = pseudoSessionId(runId);
    lock = null;
    chatQueueManager.setSessionRunning(sid, false);
    emit();
  },
  get(): EvalLockState | null {
    return lock;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useEvalLock(): EvalLockState | null {
  return useSyncExternalStore(evalLock.subscribe, evalLock.get, evalLock.get);
}
