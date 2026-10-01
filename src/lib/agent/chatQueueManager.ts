import { useSyncExternalStore, useCallback } from 'react';

export interface QueuedItem {
  id: string;
  sessionId: string;
  text: string;
  type: 'message' | 'slash_command' | 'skill';
  commandName?: string;
  commandArgs?: string;
  createdAt: number;
}

export interface ChatQueueState {
  busySessionId: string | null;
  queues: Record<string, QueuedItem[]>;
}

export type ChatQueueListener = (state: ChatQueueState) => void;

// Immutable empty array reference for stable useSyncExternalStore snapshot
const EMPTY_QUEUE: readonly QueuedItem[] = Object.freeze([]);

export class ChatQueueManager {
  private runningSessionId: string | null = null;
  private busySessionId: string | null = null;
  private queues: Record<string, QueuedItem[]> = {};
  private pausedSessions: Set<string> = new Set();
  private listeners: Set<ChatQueueListener> = new Set();

  /**
   * Returns the sessionId that is currently executing LLM inference or holds queued items.
   * If a session is actively running LLM (even with 0 queued items), it is strictly the busy session!
   */
  public getBusySessionId(): string | null {
    if (this.runningSessionId !== null) {
      return this.runningSessionId;
    }
    // If no session is running LLM, check if any session has pending queued items
    for (const [sid, q] of Object.entries(this.queues)) {
      if (q && q.length > 0) {
        return sid;
      }
    }
    return this.busySessionId;
  }

  /**
   * Directly sets whether a session is actively running LLM inference.
   */
  public setSessionRunning(sessionId: string, isRunning: boolean): void {
    if (isRunning) {
      if (this.runningSessionId !== sessionId) {
        this.runningSessionId = sessionId;
        this.busySessionId = sessionId;
        this.notifyListeners();
      }
    } else {
      if (this.runningSessionId === sessionId) {
        this.runningSessionId = null;
        // If queue still has items, keep busySessionId; otherwise clear it
        const q = this.queues[sessionId] || EMPTY_QUEUE;
        if (q.length === 0) {
          this.busySessionId = null;
        }
        this.notifyListeners();
      }
    }
  }

  /**
   * Checks if a session is currently executing LLM inference.
   */
  public isSessionRunning(sessionId: string): boolean {
    return this.runningSessionId === sessionId;
  }

  /**
   * Pauses automatic processing of the queue for a session (e.g. after Stop or Error).
   */
  public pauseSession(sessionId: string): void {
    if (!this.pausedSessions.has(sessionId)) {
      this.pausedSessions.add(sessionId);
      this.notifyListeners();
    }
  }

  /**
   * Resumes automatic processing of the queue for a session.
   */
  public resumeSession(sessionId: string): void {
    if (this.pausedSessions.has(sessionId)) {
      this.pausedSessions.delete(sessionId);
      this.notifyListeners();
    }
  }

  /**
   * Checks if a session's queue is currently paused.
   */
  public isSessionPaused(sessionId: string): boolean {
    return this.pausedSessions.has(sessionId);
  }

  /**
   * Sets the busy session ID manually.
   */
  public setSessionBusy(sessionId: string): void {
    this.setSessionRunning(sessionId, true);
  }

  /**
   * Releases the busy session status if the session is not running and has no remaining queued items.
   */
  public setSessionIdle(sessionId: string): void {
    let changed = false;
    if (this.runningSessionId === sessionId) {
      this.runningSessionId = null;
      changed = true;
    }
    if (this.busySessionId === sessionId) {
      const q = this.queues[sessionId] || EMPTY_QUEUE;
      if (q.length === 0) {
        this.busySessionId = null;
        changed = true;
      }
    }
    if (changed) {
      this.notifyListeners();
    }
  }

  /**
   * Forcefully clears the busy and running session status.
   */
  public forceIdle(): void {
    if (this.runningSessionId !== null || this.busySessionId !== null) {
      this.runningSessionId = null;
      this.busySessionId = null;
      this.notifyListeners();
    }
  }

  /**
   * Checks if a specific session is the currently busy one.
   */
  public isSessionBusy(sessionId: string): boolean {
    return this.getBusySessionId() === sessionId;
  }

  /**
   * Checks if another session is currently busy and holding the LLM lock.
   */
  public isOtherSessionBusy(sessionId: string): boolean {
    const busyId = this.getBusySessionId();
    return busyId !== null && busyId !== sessionId;
  }

  /**
   * Returns the queued items for a specific session.
   * NOTE: Returns a referentially stable array instance if unchanged (critical for useSyncExternalStore).
   */
  public getQueue(sessionId: string): QueuedItem[] {
    return (this.queues[sessionId] as QueuedItem[]) || (EMPTY_QUEUE as QueuedItem[]);
  }

  /**
   * Enqueues a new item (message, slash command, or skill invocation) into a session's queue.
   */
  public enqueue(
    sessionId: string,
    item: {
      text: string;
      type: 'message' | 'slash_command' | 'skill';
      commandName?: string;
      commandArgs?: string;
    },
  ): QueuedItem {
    this.setSessionBusy(sessionId);

    const queuedItem: QueuedItem = {
      id: crypto.randomUUID(),
      sessionId,
      text: item.text,
      type: item.type,
      commandName: item.commandName,
      commandArgs: item.commandArgs,
      createdAt: Date.now(),
    };

    const prev = this.queues[sessionId] || EMPTY_QUEUE;
    this.queues[sessionId] = [...prev, queuedItem];
    this.notifyListeners();
    return queuedItem;
  }

  /**
   * Removes and returns the first queued item for a session.
   */
  public dequeue(sessionId: string): QueuedItem | undefined {
    const q = this.queues[sessionId];
    if (!q || q.length === 0) return undefined;
    const item = q[0];
    const next = q.slice(1);
    this.queues[sessionId] = next.length > 0 ? next : (EMPTY_QUEUE as QueuedItem[]);
    this.notifyListeners();
    return item;
  }

  /**
   * Peeks at the next item in the session's queue without removing it.
   */
  public peek(sessionId: string): QueuedItem | undefined {
    return this.queues[sessionId]?.[0];
  }

  /**
   * Dequeues a specific item from the queue by its ID (e.g. when user clicks on a specific queued item to run).
   */
  public dequeueItem(sessionId: string, itemId: string): QueuedItem | undefined {
    const q = this.queues[sessionId];
    if (!q || q.length === 0) return undefined;
    const targetIdx = q.findIndex((i) => i.id === itemId);
    if (targetIdx === -1) return undefined;
    const targetItem = q[targetIdx];
    const next = [...q.slice(0, targetIdx), ...q.slice(targetIdx + 1)];
    this.queues[sessionId] = next.length > 0 ? next : (EMPTY_QUEUE as QueuedItem[]);
    this.notifyListeners();
    return targetItem;
  }

  /**
   * Removes a specific item from a session's queue by its ID.
   */
  public removeItem(sessionId: string, itemId: string): boolean {
    const q = this.queues[sessionId];
    if (!q || q.length === 0) return false;
    const next = q.filter((i) => i.id !== itemId);
    if (next.length === q.length) return false;
    this.queues[sessionId] = next.length > 0 ? next : (EMPTY_QUEUE as QueuedItem[]);
    this.notifyListeners();
    return true;
  }

  /**
   * Clears all queued items for a specific session.
   */
  public clearQueue(sessionId: string): void {
    let changed = false;
    if (this.queues[sessionId] && this.queues[sessionId].length > 0) {
      this.queues[sessionId] = EMPTY_QUEUE as QueuedItem[];
      changed = true;
    }
    if (this.pausedSessions.has(sessionId)) {
      this.pausedSessions.delete(sessionId);
      changed = true;
    }
    if (changed) {
      this.notifyListeners();
    }
  }

  /**
   * Clears everything across all sessions (for reset/testing).
   */
  public resetAll(): void {
    this.runningSessionId = null;
    this.busySessionId = null;
    this.queues = {};
    this.pausedSessions.clear();
    this.notifyListeners();
  }

  /**
   * Subscribes to changes in the queue manager state.
   */
  public subscribe(listener: ChatQueueListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const state: ChatQueueState = {
      busySessionId: this.getBusySessionId(),
      queues: { ...this.queues },
    };
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('ChatQueueManager listener error:', err);
      }
    }
  }
}

export const chatQueueManager = new ChatQueueManager();

const getBusySessionSnapshot = () => chatQueueManager.getBusySessionId();

/**
 * 전역 LLM 실행 잠금 구독 훅.
 * 폴더(프로젝트) 변경 등 "LLM 동작 중에는 금지" 동작의 가드 조건으로 사용한다.
 * busySessionId가 null이 아니면 어떤 세션에서든 LLM 추론/대기 큐가 진행 중이다.
 */
export function useGlobalLlmBusy(): string | null {
  return useSyncExternalStore(
    (callback) => chatQueueManager.subscribe(callback),
    getBusySessionSnapshot,
  );
}

/**
 * React hook using useSyncExternalStore for reactive subscription to ChatQueueManager.
 * Guaranteed to return referentially stable snapshots to prevent infinite re-render loops.
 */
export function useChatQueue(sessionId: string) {
  const getQueueSnapshot = useCallback(
    () => chatQueueManager.getQueue(sessionId),
    [sessionId],
  );

  const getPausedSnapshot = useCallback(
    () => chatQueueManager.isSessionPaused(sessionId),
    [sessionId],
  );

  const queue = useSyncExternalStore(
    (callback) => chatQueueManager.subscribe(callback),
    getQueueSnapshot,
  );

  const isPaused = useSyncExternalStore(
    (callback) => chatQueueManager.subscribe(callback),
    getPausedSnapshot,
  );

  const busySessionId = useSyncExternalStore(
    (callback) => chatQueueManager.subscribe(callback),
    getBusySessionSnapshot,
  );

  const isLockedByOtherSession =
    busySessionId !== null && busySessionId !== sessionId;
  const isThisSessionBusy = busySessionId === sessionId;

  const enqueue = useCallback(
    (item: {
      text: string;
      type: 'message' | 'slash_command' | 'skill';
      commandName?: string;
      commandArgs?: string;
    }) => chatQueueManager.enqueue(sessionId, item),
    [sessionId],
  );

  const dequeue = useCallback(
    () => chatQueueManager.dequeue(sessionId),
    [sessionId],
  );

  const peek = useCallback(
    () => chatQueueManager.peek(sessionId),
    [sessionId],
  );

  const dequeueItem = useCallback(
    (itemId: string) => chatQueueManager.dequeueItem(sessionId, itemId),
    [sessionId],
  );

  const removeItem = useCallback(
    (itemId: string) => chatQueueManager.removeItem(sessionId, itemId),
    [sessionId],
  );

  const clearQueue = useCallback(
    () => chatQueueManager.clearQueue(sessionId),
    [sessionId],
  );

  const pauseQueue = useCallback(
    () => chatQueueManager.pauseSession(sessionId),
    [sessionId],
  );

  const resumeQueue = useCallback(
    () => chatQueueManager.resumeSession(sessionId),
    [sessionId],
  );

  return {
    queue,
    isPaused,
    busySessionId,
    isLockedByOtherSession,
    isThisSessionBusy,
    enqueue,
    dequeue,
    peek,
    dequeueItem,
    removeItem,
    clearQueue,
    pauseQueue,
    resumeQueue,
  };
}
