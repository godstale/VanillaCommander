import { evalRunPython, type EvalRuntimesInfo } from '../ipc';

export interface PythonTestResult {
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export const PYTHON_TIMEOUT_MS = 10_000;

export function buildPythonScript(code: string, tests: string, entryPoint: string): string {
  return [
    'def assertEqual(actual, expected):',
    '    assert actual == expected, f"assertEqual failed: expected {expected!r} but got {actual!r}"',
    '',
    code,
    tests,
    `assert callable(${entryPoint}), "missing entry point '${entryPoint}'"`,
    '',
  ].join('\n');
}

export async function runPythonTests(
  code: string,
  tests: string,
  entryPoint: string,
): Promise<PythonTestResult> {
  const script = buildPythonScript(code, tests, entryPoint);
  const raw = await evalRunPython(script, PYTHON_TIMEOUT_MS);
  return {
    passed: raw.exit_code === 0 && !raw.timed_out,
    exitCode: raw.exit_code,
    stdout: raw.stdout,
    stderr: raw.stderr,
    timedOut: raw.timed_out,
  };
}

export function canRunPython(
  settings: { allowLocalCodeExecution: boolean },
  confirmations: { codeExecution: unknown } | null | undefined,
  runtimes: EvalRuntimesInfo,
): boolean {
  return (
    settings.allowLocalCodeExecution === true &&
    confirmations?.codeExecution != null &&
    (runtimes.python?.path ?? null) !== null
  );
}
