import {
  OllamaConnectionError,
  OllamaModelNotFoundError,
  OllamaRequestError,
} from '@/lib/llm/ollamaClient';

export interface RetryPolicy {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  enabled: true,
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
};

export function isRetryableError(err: unknown): boolean {
  if (err instanceof OllamaModelNotFoundError) {
    return false;
  }
  if (err instanceof OllamaRequestError) {
    // 5xx status codes and 408 / 429 are retryable; 400, 404, etc. are not.
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  if (err instanceof OllamaConnectionError) {
    return true;
  }
  if (err instanceof TypeError && (err.message.includes('fetch') || err.message.includes('network'))) {
    return true;
  }
  // Generic network errors or timeouts
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes('connection') ||
      msg.includes('network') ||
      msg.includes('econnrefused') ||
      msg.includes('timeout')
    ) {
      return true;
    }
  }
  return false;
}

export async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new Error('Operation aborted');
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new Error('Operation aborted'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort);
  });
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy?: Partial<RetryPolicy>,
  signal?: AbortSignal,
  onRetry?: (attempt: number, maxRetries: number, error: unknown) => void,
): Promise<T> {
  const merged: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...policy };

  if (!merged.enabled || merged.maxRetries <= 0) {
    return fn(0);
  }

  let attempt = 0;
  while (true) {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }
    try {
      return await fn(attempt);
    } catch (err: unknown) {
      if (signal?.aborted || attempt >= merged.maxRetries || !isRetryableError(err)) {
        throw err;
      }
      attempt++;
      onRetry?.(attempt, merged.maxRetries, err);

      const delay = Math.min(
        merged.maxDelayMs,
        merged.baseDelayMs * Math.pow(2, attempt - 1),
      );
      await sleepWithAbort(delay, signal);
    }
  }
}
