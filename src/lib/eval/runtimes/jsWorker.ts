export interface JsWorkerRequest {
  code: string;
  tests: string;
  timeoutMs: number;
}

export interface JsWorkerResponse {
  passed: number;
  failed: number;
  error: string | null;
}

const NETWORK_APIS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'caches'];

function networkBlocked(name: string): () => never {
  return () => {
    throw new Error(`${name} is disabled in eval sandbox`);
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function formatValue(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

export function executeJsTestBody(code: string, tests: string): JsWorkerResponse {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, { present: boolean; value: unknown }>();
  for (const name of NETWORK_APIS) {
    saved.set(name, { present: name in g, value: g[name] });
    if (name === 'fetch') {
      g[name] = networkBlocked(name);
    } else {
      g[name] = undefined;
    }
  }
  let passed = 0;
  let failed = 0;
  let firstError: string | null = null;
  const fail = (message: string): void => {
    failed += 1;
    if (firstError === null) firstError = message;
  };
  const assertEqual = (actual: unknown, expected: unknown): void => {
    if (deepEqual(actual, expected)) {
      passed += 1;
    } else {
      fail(`assertEqual failed: expected ${formatValue(expected)} but got ${formatValue(actual)}`);
    }
  };
  try {
    const fn = new Function('assertEqual', `${code}\n${tests}`) as (
      assertFn: (actual: unknown, expected: unknown) => void,
    ) => void;
    fn(assertEqual);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  } finally {
    for (const [name, prev] of saved) {
      if (prev.present) {
        g[name] = prev.value;
      } else {
        delete g[name];
      }
    }
  }
  return { passed, failed, error: firstError };
}

interface WorkerScope {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage: (msg: JsWorkerResponse) => void;
}

function registerWorkerEntry(): void {
  if (typeof window !== 'undefined') return;
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g['postMessage'] !== 'function' || !('onmessage' in globalThis)) return;
  (globalThis as unknown as WorkerScope).onmessage = (ev: MessageEvent) => {
    const data = ev.data as JsWorkerRequest;
    const result = executeJsTestBody(data.code, data.tests);
    (globalThis as unknown as WorkerScope).postMessage(result);
  };
}

registerWorkerEntry();
