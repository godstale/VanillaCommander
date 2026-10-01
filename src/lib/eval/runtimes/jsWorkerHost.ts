import type { JsWorkerRequest, JsWorkerResponse } from './jsWorker';

export interface JsTestResult extends JsWorkerResponse {
  timedOut: boolean;
}

export function runJsTests(code: string, tests: string, timeoutMs = 5000): Promise<JsTestResult> {
  return new Promise<JsTestResult>((resolve) => {
    let settled = false;
    const worker = new Worker(new URL('./jsWorker.ts', import.meta.url), { type: 'module' });
    const finish = (result: JsTestResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        worker.terminate();
      } catch {
        // Termination is best-effort; the result is already decided.
      }
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        passed: 0,
        failed: 0,
        error: `JS execution timed out after ${timeoutMs}ms`,
        timedOut: true,
      });
    }, timeoutMs);
    worker.onmessage = (ev: MessageEvent<JsWorkerResponse>) => {
      const data = ev.data;
      finish({ passed: data.passed, failed: data.failed, error: data.error, timedOut: false });
    };
    worker.onerror = (ev: ErrorEvent) => {
      finish({ passed: 0, failed: 1, error: ev.message || 'worker error', timedOut: false });
    };
    const request: JsWorkerRequest = { code, tests, timeoutMs };
    worker.postMessage(request);
  });
}
