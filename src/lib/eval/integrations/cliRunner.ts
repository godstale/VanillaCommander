import { invoke } from '@tauri-apps/api/core';

/** CLI JSON 출력에서 dot-path (`a.b.0.c`) 로 값을 꺼낸다. 빈 경로는 전체 값. */
export function extractJsonPath(value: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed) return value;
  let current: unknown = value;
  for (const seg of trimmed.split('.')) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) return undefined;
      current = current[idx];
      continue;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[seg];
      continue;
    }
    return undefined;
  }
  return current;
}

export interface CliMessage {
  role: string;
  content: string | null;
}

/** CLI stdin/file 전달용 프롬프트 텍스트로 변환한다. */
export function formatMessagesAsPrompt(messages: CliMessage[]): string {
  return messages
    .map((m) => `${m.role}: ${m.content ?? ''}`)
    .join('\n\n');
}

export interface CliRunParams {
  executablePath: string;
  args: string[];
  stdinText?: string;
  /** `{promptFile}` 토큰 치환용 프롬프트 파일 내용 */
  promptFileText?: string;
  timeoutMs: number;
}

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Rust `integration_run_cli` 래퍼. `{promptFile}` 치환·임시 cwd·타임아웃·
 * 셸 미사용 실행 등 안전 처리는 백엔드가 담당한다.
 */
export async function runIntegrationCli(params: CliRunParams): Promise<CliRunResult> {
  return invoke<CliRunResult>('integration_run_cli', {
    executablePath: params.executablePath,
    args: params.args,
    stdinText: params.stdinText ?? null,
    promptFileText: params.promptFileText ?? null,
    timeoutMs: params.timeoutMs,
  });
}
