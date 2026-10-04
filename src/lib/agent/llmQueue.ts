// 로컬 LLM 트랜잭션 큐. 로컬 모델은 동시에 한 요청만 안정적으로 처리하므로
// 채팅 한 턴(요청→응답 완료)·위키 파일 1건 처리(추출→분류→등록)를 하나의 트랜잭션으로 보고
// 앱 전역에서 직렬 실행한다. 모니터링 화면에서 항목 삭제·전체 비우기가 가능하다.
import { useSyncExternalStore } from 'react';

export type LlmTransactionKind = 'chat' | 'wiki';

export interface LlmTransaction {
  id: string;
  kind: LlmTransactionKind;
  label: string;
  /** 소유자(채팅 세션 ID 등). 같은 소유자의 대기 항목을 한꺼번에 취소할 때 쓴다. */
  owner?: string;
  status: 'queued' | 'running';
  enqueuedAt: number;
  startedAt: number | null;
}

export interface LlmLease {
  id: string;
  /** 큐에서 삭제되었거나 시간 제한에 걸리면 abort 된다. */
  signal: AbortSignal;
  /** 트랜잭션 종료. 이미 취소·만료된 경우에도 안전하다 (멱등). */
  release: () => void;
}

export type LlmQueueEndReason = 'removed' | 'timeout';

/** 대기 중 삭제된 트랜잭션의 acquire 거절 사유. */
export class LlmQueueCancelledError extends Error {
  constructor() {
    super('LLM queue transaction was cancelled.');
    this.name = 'LlmQueueCancelledError';
  }
}

export const DEFAULT_LLM_QUEUE_TIMEOUT_MIN = 10;

interface Entry {
  tx: LlmTransaction;
  controller: AbortController;
  grant: (lease: LlmLease) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const EMPTY: readonly LlmTransaction[] = Object.freeze([]);

export class LlmTransactionQueue {
  private entries: Entry[] = [];
  private snapshot: readonly LlmTransaction[] = EMPTY;
  private timeoutMs = DEFAULT_LLM_QUEUE_TIMEOUT_MIN * 60_000;
  private listeners = new Set<() => void>();

  setTimeoutMinutes(minutes: number): void {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    this.timeoutMs = minutes * 60_000;
    this.notify();
  }

  getTimeoutMs(): number {
    return this.timeoutMs;
  }

  getSnapshot = (): readonly LlmTransaction[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** 트랜잭션을 줄 세우고, 차례가 오면 lease 를 돌려준다. 대기 중 삭제되면 거절된다. */
  acquire(kind: LlmTransactionKind, label: string, owner?: string): Promise<LlmLease> {
    return new Promise<LlmLease>((resolve, reject) => {
      const entry: Entry = {
        tx: {
          id: crypto.randomUUID(),
          kind,
          label,
          owner,
          status: 'queued',
          enqueuedAt: Date.now(),
          startedAt: null,
        },
        controller: new AbortController(),
        grant: resolve,
        reject,
        timer: null,
      };
      this.entries.push(entry);
      this.pump();
      this.notify();
    });
  }

  /** 대기 중이면 취소하고, 실행 중이면 abort 신호를 보낸 뒤 즉시 자리를 비운다. */
  remove(id: string): boolean {
    const entry = this.entries.find((e) => e.tx.id === id);
    if (!entry) return false;
    this.finish(entry, 'removed');
    return true;
  }

  /** 소유자의 대기 중 항목만 취소한다 (실행 중 항목은 건드리지 않는다). */
  removeQueuedByOwner(owner: string): void {
    for (const entry of [...this.entries]) {
      if (entry.tx.owner === owner && entry.tx.status === 'queued') this.finish(entry, 'removed');
    }
  }

  clear(): void {
    // 대기 항목을 먼저 비워야 실행 중 항목이 끝날 때 다음 항목이 시작되지 않는다.
    const ordered = [...this.entries].sort((x, y) => Number(x.tx.status === 'running') - Number(y.tx.status === 'running'));
    for (const entry of ordered) this.finish(entry, 'removed');
  }

  private finish(entry: Entry, reason: LlmQueueEndReason): void {
    const idx = this.entries.indexOf(entry);
    if (idx < 0) return;
    this.entries.splice(idx, 1);
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.tx.status === 'queued') {
      entry.reject(new LlmQueueCancelledError());
    } else {
      entry.controller.abort(reason);
    }
    this.pump();
    this.notify();
  }

  private pump(): void {
    if (this.entries.some((e) => e.tx.status === 'running')) return;
    const next = this.entries.find((e) => e.tx.status === 'queued');
    if (!next) return;
    next.tx = { ...next.tx, status: 'running', startedAt: Date.now() };
    next.timer = setTimeout(() => this.finish(next, 'timeout'), this.timeoutMs);
    next.grant({
      id: next.tx.id,
      signal: next.controller.signal,
      release: () => {
        // 정상 종료는 abort 없이 자리만 비운다.
        const idx = this.entries.indexOf(next);
        if (idx < 0) return;
        this.entries.splice(idx, 1);
        if (next.timer) clearTimeout(next.timer);
        this.pump();
        this.notify();
      },
    });
  }

  private notify(): void {
    this.snapshot = this.entries.length === 0 ? EMPTY : this.entries.map((e) => e.tx);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('LlmTransactionQueue listener error:', err);
      }
    }
  }

  /** 테스트용 초기화. */
  resetAll(): void {
    this.clear();
    this.timeoutMs = DEFAULT_LLM_QUEUE_TIMEOUT_MIN * 60_000;
  }
}

export const llmQueue = new LlmTransactionQueue();

export function useLlmQueue(): readonly LlmTransaction[] {
  return useSyncExternalStore(llmQueue.subscribe, llmQueue.getSnapshot);
}
