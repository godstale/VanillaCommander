import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeJsTestBody, type JsWorkerRequest } from './jsWorker';
import { runJsTests } from './jsWorkerHost';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('executeJsTestBody', () => {
  it('counts passing assertEqual calls', () => {
    const r = executeJsTestBody(
      'function add(a, b) { return a + b; }',
      'assertEqual(add(1, 2), 3);\nassertEqual(add(0, 0), 0);',
    );
    expect(r).toEqual({ passed: 2, failed: 0, error: null });
  });

  it('counts failures and keeps the first error', () => {
    const r = executeJsTestBody(
      'function add(a, b) { return a + b; }',
      'assertEqual(add(1, 2), 3);\nassertEqual(add(1, 2), 999);',
    );
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.error).toContain('assertEqual failed');
  });

  it('reports thrown runtime errors', () => {
    const r = executeJsTestBody('function boom() { throw new Error("kaboom"); }', 'boom();');
    expect(r.failed).toBe(1);
    expect(r.error).toContain('kaboom');
  });

  it('neutralizes network APIs inside the sandbox', () => {
    const r = executeJsTestBody('function main() {}', 'fetch("http://example.com");');
    expect(r.failed).toBe(1);
    expect(r.error).toContain('fetch is disabled in eval sandbox');
    expect(typeof fetch).toBe('function');
  });

  it('neutralizes XMLHttpRequest/WebSocket access', () => {
    const r = executeJsTestBody('', 'new XMLHttpRequest();');
    expect(r.failed).toBe(1);
    expect(r.error).toBeTruthy();
  });
});

class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(msg: JsWorkerRequest): void {
    const result = executeJsTestBody(msg.code, msg.tests);
    queueMicrotask(() => {
      this.onmessage?.({ data: result } as MessageEvent);
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

class HangingWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(): void {
    // Never responds, simulating an infinite loop.
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('runJsTests', () => {
  it('passes worker results through and terminates the worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const r = await runJsTests(
      'function add(a, b) { return a + b; }',
      'assertEqual(add(2, 3), 5);',
      1000,
    );
    expect(r.timedOut).toBe(false);
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('times out and terminates on an infinite loop (tiny timeout)', async () => {
    vi.stubGlobal('Worker', HangingWorker);
    const r = await runJsTests('while (true) {}', '', 20);
    expect(r.timedOut).toBe(true);
    expect(r.error).toContain('timed out');
  });
});
