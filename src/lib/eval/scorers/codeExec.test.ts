import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvalPackManifest, EvalRunConfig, EvalSample } from '../types';
import type { ScorerInput } from './types';
import { codeExecScorer } from './codeExec';
import { getScorer } from './index';
import { canRunPython } from '../runtimes/python';
import type { EvalRuntimesInfo } from '../ipc';

vi.mock('../runtimes/jsWorkerHost', () => ({
  runJsTests: vi.fn(),
}));
vi.mock('../runtimes/python', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../runtimes/python')>();
  return { ...mod, runPythonTests: vi.fn() };
});
vi.mock('../runtimes/detect', () => ({
  detectRuntimesCached: vi.fn(),
  clearRuntimesCache: vi.fn(),
}));
vi.mock('@/lib/db/repositories/integrationsRepo', () => ({
  getIntegrationSettings: vi.fn(),
}));

import { runJsTests } from '../runtimes/jsWorkerHost';
import { runPythonTests } from '../runtimes/python';
import { detectRuntimesCached } from '../runtimes/detect';
import { getIntegrationSettings } from '@/lib/db/repositories/integrationsRepo';

const mockedRunJsTests = vi.mocked(runJsTests);
const mockedRunPythonTests = vi.mocked(runPythonTests);
const mockedDetect = vi.mocked(detectRuntimesCached);
const mockedSettings = vi.mocked(getIntegrationSettings);

const pack = { id: 'p' } as unknown as EvalPackManifest;
const ctx = { signal: new AbortController().signal };

function input(
  sample: Partial<EvalSample> & { id: string },
  outputText: string,
  extra?: Record<string, unknown>,
): ScorerInput {
  return { sample: { input: 'q', ...sample } as EvalSample, pack, outputText, toolCalls: [], extra };
}

function jsSample(): Partial<EvalSample> & { id: string } {
  return {
    id: 's',
    code: { entryPoint: 'add', tests: 'assertEqual(add(1, 2), 3);', language: 'js' },
  };
}

function confirmations(): EvalRunConfig['confirmations'] {
  return {
    weightsConfirmedAt: '2026-01-01T00:00:00Z',
    externalTransfers: [],
    externalConfirmedAt: null,
    codeExecution: { runtime: 'python', snippetCount: 1, confirmedAt: '2026-01-01T00:00:00Z' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('codeExec scorer (js)', () => {
  it('is registered as code_exec with requiresAsync', () => {
    expect(getScorer('code_exec')).toBe(codeExecScorer);
    expect(codeExecScorer.requiresAsync).toBe(true);
  });

  it('scores 1 when all js tests pass', async () => {
    mockedRunJsTests.mockResolvedValue({ passed: 2, failed: 0, error: null, timedOut: false });
    const r = await codeExecScorer.score(
      input(jsSample(), '```js\nfunction add(a, b) { return a + b; }\n```'),
      {},
      ctx,
    );
    expect(r).toMatchObject({ value: 1, verdict: 'correct' });
    expect(mockedRunJsTests).toHaveBeenCalledTimes(1);
  });

  it('scores 0 with failed count and first error line when js tests fail', async () => {
    mockedRunJsTests.mockResolvedValue({
      passed: 1,
      failed: 2,
      error: 'assertEqual failed: expected 3 but got 4\nat foo (line 2)',
      timedOut: false,
    });
    const r = await codeExecScorer.score(
      input(jsSample(), '```js\nfunction add(a, b) { return a + b; }\n```'),
      {},
      ctx,
    );
    expect(r.value).toBe(0);
    expect(r.verdict).toBe('incorrect');
    expect(r.reason).toContain('2 failed');
    expect(r.reason).toContain('expected 3 but got 4');
    expect(r.reason).not.toContain('at foo');
  });

  it('maps a timed-out worker to an error verdict', async () => {
    mockedRunJsTests.mockResolvedValue({
      passed: 0,
      failed: 0,
      error: 'JS execution timed out after 50ms',
      timedOut: true,
    });
    const r = await codeExecScorer.score(
      input(jsSample(), '```js\nfunction add(a, b) { return a + b; }\n```'),
      {},
      ctx,
    );
    expect(r).toMatchObject({ value: 0, verdict: 'error' });
  });

  it('maps a missing entry point to no_answer without running', async () => {
    const r = await codeExecScorer.score(
      input(jsSample(), '```js\nfunction subtract(a, b) { return a - b; }\n```'),
      {},
      ctx,
    );
    expect(r).toMatchObject({ value: 0, verdict: 'no_answer' });
    expect(mockedRunJsTests).not.toHaveBeenCalled();
  });

  it('errors when the sample has no code spec', async () => {
    const r = await codeExecScorer.score(input({ id: 's' }, 'hello'), {}, ctx);
    expect(r).toMatchObject({ value: 0, verdict: 'error' });
  });
});

describe('canRunPython gate matrix', () => {
  const runtimesWithPython: EvalRuntimesInfo = {
    python: { path: '/usr/bin/python3', version: '3.12' },
    node: null,
  };
  const runtimesWithoutPython: EvalRuntimesInfo = { python: null, node: null };
  const fullConfirmations = confirmations();
  const noConfirmations = { ...fullConfirmations, codeExecution: null };

  it.each([
    { allow: true, conf: true, py: true, expected: true },
    { allow: false, conf: true, py: true, expected: false },
    { allow: true, conf: false, py: true, expected: false },
    { allow: true, conf: true, py: false, expected: false },
    { allow: false, conf: false, py: false, expected: false },
  ])(
    'allow=$allow conf=$conf python=$py -> $expected',
    ({ allow, conf, py, expected }) => {
      expect(
        canRunPython(
          { allowLocalCodeExecution: allow },
          conf ? fullConfirmations : noConfirmations,
          py ? runtimesWithPython : runtimesWithoutPython,
        ),
      ).toBe(expected);
    },
  );
});

describe('codeExec scorer (python)', () => {
  function pySample(): Partial<EvalSample> & { id: string } {
    return {
      id: 's',
      code: { entryPoint: 'add', tests: 'assertEqual(add(1, 2), 3)', language: 'python' },
    };
  }
  const output = '```python\ndef add(a, b):\n    return a + b\n```';

  it('runs python tests when the gate passes', async () => {
    mockedSettings.mockResolvedValue({
      masterEnabled: true,
      trustedLanHosts: [],
      allowLocalCodeExecution: true,
    });
    mockedDetect.mockResolvedValue({
      python: { path: '/usr/bin/python3', version: '3.12' },
      node: null,
    });
    mockedRunPythonTests.mockResolvedValue({
      passed: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    });
    const r = await codeExecScorer.score(
      input(pySample(), output, { confirmations: confirmations() }),
      {},
      ctx,
    );
    expect(r).toMatchObject({ value: 1, verdict: 'correct' });
    expect(mockedRunPythonTests).toHaveBeenCalledTimes(1);
  });

  it('throws when allowLocalCodeExecution is false', async () => {
    mockedSettings.mockResolvedValue({
      masterEnabled: true,
      trustedLanHosts: [],
      allowLocalCodeExecution: false,
    });
    mockedDetect.mockResolvedValue({
      python: { path: '/usr/bin/python3', version: '3.12' },
      node: null,
    });
    await expect(
      codeExecScorer.score(input(pySample(), output, { confirmations: confirmations() }), {}, ctx),
    ).rejects.toThrow('python execution not permitted');
    expect(mockedRunPythonTests).not.toHaveBeenCalled();
  });

  it('throws when code-execution confirmation is missing', async () => {
    mockedSettings.mockResolvedValue({
      masterEnabled: true,
      trustedLanHosts: [],
      allowLocalCodeExecution: true,
    });
    mockedDetect.mockResolvedValue({
      python: { path: '/usr/bin/python3', version: '3.12' },
      node: null,
    });
    await expect(codeExecScorer.score(input(pySample(), output, {}), {}, ctx)).rejects.toThrow(
      'python execution not permitted',
    );
    expect(mockedRunPythonTests).not.toHaveBeenCalled();
  });

  it('throws when no python runtime is detected', async () => {
    mockedSettings.mockResolvedValue({
      masterEnabled: true,
      trustedLanHosts: [],
      allowLocalCodeExecution: true,
    });
    mockedDetect.mockResolvedValue({ python: null, node: null });
    await expect(
      codeExecScorer.score(input(pySample(), output, { confirmations: confirmations() }), {}, ctx),
    ).rejects.toThrow('python execution not permitted');
    expect(mockedRunPythonTests).not.toHaveBeenCalled();
  });

  it('scores failing python output as incorrect with the first error line', async () => {
    mockedSettings.mockResolvedValue({
      masterEnabled: true,
      trustedLanHosts: [],
      allowLocalCodeExecution: true,
    });
    mockedDetect.mockResolvedValue({
      python: { path: '/usr/bin/python3', version: '3.12' },
      node: null,
    });
    mockedRunPythonTests.mockResolvedValue({
      passed: false,
      exitCode: 1,
      stdout: '',
      stderr: 'AssertionError: assertEqual failed\n  File "x", line 5',
      timedOut: false,
    });
    const r = await codeExecScorer.score(
      input(pySample(), output, { confirmations: confirmations() }),
      {},
      ctx,
    );
    expect(r.value).toBe(0);
    expect(r.verdict).toBe('incorrect');
    expect(r.reason).toContain('AssertionError');
    expect(r.reason).not.toContain('line 5');
  });
});
