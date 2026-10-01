import type { RiskLevel } from '@/lib/agent/types';

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
  rememberForSession?: boolean;
}

export interface ApprovalRequestItem {
  id: string;
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  risk: RiskLevel;
  description?: string;
}

export type ApprovalListener = (request: ApprovalRequestItem | null) => void;

export class ApprovalBus {
  private pending = new Map<
    string,
    {
      resolve: (decision: ApprovalDecision) => void;
      reject: (error: Error) => void;
      request: ApprovalRequestItem;
    }
  >();

  private subscribers = new Set<ApprovalListener>();
  private sessionOverrides = new Set<string>();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.abortAll();
      });
    }
  }

  public subscribe(fn: ApprovalListener): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private notifyListeners(): void {
    const nextItem = this.getPendingRequests()[0] ?? null;
    for (const listener of this.subscribers) {
      try {
        listener(nextItem);
      } catch (err) {
        console.error('ApprovalBus subscriber error:', err);
      }
    }
  }

  public getSessionOverrides(): Set<string> {
    return this.sessionOverrides;
  }

  public addSessionOverride(toolName: string): void {
    this.sessionOverrides.add(toolName);
  }

  public clearSessionOverrides(): void {
    this.sessionOverrides.clear();
  }

  public request(item: ApprovalRequestItem, signal?: AbortSignal): Promise<ApprovalDecision> {
    if (signal?.aborted) {
      return Promise.resolve({
        approved: false,
        reason: 'Operation was aborted before approval was granted.',
      });
    }

    return new Promise<ApprovalDecision>((resolve, reject) => {
      const cleanup = () => {
        this.pending.delete(item.id);
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        cleanup();
        this.notifyListeners();
        resolve({
          approved: false,
          reason: 'Operation was aborted by user.',
        });
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.pending.set(item.id, {
        resolve: (decision) => {
          cleanup();
          if (decision.approved && decision.rememberForSession) {
            this.sessionOverrides.add(item.toolName);
          }
          this.notifyListeners();
          resolve(decision);
        },
        reject: (err) => {
          cleanup();
          this.notifyListeners();
          reject(err);
        },
        request: item,
      });

      this.notifyListeners();
    });
  }

  public resolve(id: string, decision: ApprovalDecision): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    p.resolve(decision);
    return true;
  }

  public rejectAll(reason: string): void {
    const list = Array.from(this.pending.values());
    this.pending.clear();
    for (const p of list) {
      p.resolve({ approved: false, reason });
    }
    this.notifyListeners();
  }

  public abortAll(): void {
    const list = Array.from(this.pending.values());
    this.pending.clear();
    for (const p of list) {
      p.resolve({ approved: false, reason: 'Aborted' });
    }
    this.notifyListeners();
  }

  public getPendingRequests(): ApprovalRequestItem[] {
    return Array.from(this.pending.values()).map((p) => p.request);
  }
}

export const approvalBus = new ApprovalBus();
