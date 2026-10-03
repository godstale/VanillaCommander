// P11-33: 외부 문서 파서 (CLI 템플릿). 로컬 실행이므로 외부 전송 동의 대상이
// 아니며, 실행 파일 검증·타임아웃은 `integration_run_cli` 규칙을 재사용한다.
import { invoke } from '@tauri-apps/api/core';
import { runIntegrationCli } from '@/lib/integrations/cliRunner';
import { fcReadFileBytes } from '@/lib/commander/ipc';

export type ExternalOutputMode = 'stdout' | 'file';

export interface ExternalParserPreset {
  id: string;
  label: string;
  command: string;
  outputMode: ExternalOutputMode;
  hint: string;
}

/**
 * CLI 템플릿 토큰: `{input}` 입력 문서, `{output}` 임시 출력 파일 경로,
 * `{outputDir}` 그 부모 디렉터리. LibreOffice처럼 출력 파일을 직접 지정할 수
 * 없는 도구는 `{outputDir}`에 `<입력베이스>.txt`를 찾는다.
 */
export const EXTERNAL_PARSER_PRESETS: ExternalParserPreset[] = [
  {
    id: 'markitdown',
    label: 'MarkItDown',
    command: 'markitdown "{input}"',
    outputMode: 'stdout',
    hint: 'markitdown {input} — stdout으로 Markdown 출력',
  },
  {
    id: 'docling',
    label: 'Docling',
    command: 'docling "{input}"',
    outputMode: 'stdout',
    hint: 'docling {input} — stdout으로 Markdown 출력',
  },
  {
    id: 'pandoc',
    label: 'Pandoc',
    command: 'pandoc "{input}" -t markdown',
    outputMode: 'stdout',
    hint: 'pandoc {input} -t markdown — 주로 텍스트 계열 변환용',
  },
  {
    id: 'libreoffice',
    label: 'LibreOffice',
    command: 'soffice --headless --convert-to "txt:Text (encoded):UTF8" --outdir "{outputDir}" "{input}"',
    outputMode: 'file',
    hint: '출력 디렉터리에 <입력파일명>.txt 생성 후 읽는다',
  },
];

export const EXTERNAL_PARSER_TIMEOUT_MS = 120_000;
const MAX_EXTERNAL_CHARS = 200_000;

/** 따옴표 안 공백을 보존하는 최소 명령 분리. 셸은 거치지 않는다. */
export function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** `{input}`·`{output}`·`{outputDir}` 토큰을 실제 경로로 치환한다. */
export function substituteTokens(
  args: string[],
  tokens: { input: string; output: string; outputDir: string },
): string[] {
  return args.map((a) =>
    a
      .split('{input}').join(tokens.input)
      .split('{output}').join(tokens.output)
      .split('{outputDir}').join(tokens.outputDir),
  );
}

export interface ExternalParseResult {
  text: string;
  method: string;
}

export interface ExternalRunOptions {
  /**
   * file 모드 출력물의 기준 디렉터리. 백엔드는 실행용 임시 cwd를 실행 후
   * 지우므로, 파일로 받는 출력은 반드시 유지되는 cwd 아래 절대 경로로 둔다.
   * 미지정 시 file 모드는 실패한다 (내장 파서로 폴백).
   */
  cwd?: string;
}

/**
 * 외부 파서 1회 실행. stdout 모드는 표준 출력을, file 모드는 `{output}`
 * 절대 경로(또는 `{outputDir}/<입력베이스>.txt`)를 읽는다. 실패하면 throw 한다.
 */
export async function runExternalParser(
  inputPath: string,
  command: string,
  outputMode: ExternalOutputMode,
  opts: ExternalRunOptions = {},
): Promise<ExternalParseResult> {
  const parts = splitCommand(command);
  const exeName = parts[0]?.trim();
  if (!exeName) throw new Error('Empty parser command.');
  // 베어 이름이면 PATH에서 찾아 절대 경로로 확정한다 (백엔드 검증 규칙).
  const executablePath = await invoke<string>('find_executable', { name: exeName });

  if (outputMode === 'stdout') {
    const args = substituteTokens(parts.slice(1), {
      input: inputPath,
      output: '',
      outputDir: '',
    });
    const result = await runIntegrationCli({
      executablePath,
      args,
      timeoutMs: EXTERNAL_PARSER_TIMEOUT_MS,
    });
    if (result.timedOut) throw new Error(`Parser timed out: ${exeName}`);
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();
      throw new Error(
        `Parser failed (exit ${result.exitCode}): ${detail.slice(0, 300)}`,
      );
    }
    const text = result.stdout.trim();
    if (!text) throw new Error('Parser produced no output.');
    return { text: text.slice(0, MAX_EXTERNAL_CHARS), method: `external:${exeName}` };
  }

  // file 모드: 유지되는 cwd가 필요하다.
  const cwd = opts.cwd?.trim();
  if (!cwd) throw new Error('File-mode parser needs a working folder (cwd).');
  const sep = cwd.includes('\\') ? '\\' : '/';
  const outputAbs = `${cwd.replace(/[\\/]+$/, '')}${sep}parser-output-${Date.now().toString(36)}.txt`;
  const args = substituteTokens(parts.slice(1), {
    input: inputPath,
    output: outputAbs,
    outputDir: cwd,
  });
  const result = await runIntegrationCli({
    executablePath,
    args,
    timeoutMs: EXTERNAL_PARSER_TIMEOUT_MS,
    cwd,
  });
  if (result.timedOut) throw new Error(`Parser timed out: ${exeName}`);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `Parser failed (exit ${result.exitCode}): ${detail.slice(0, 300)}`,
    );
  }
  const candidates = [outputAbs, `${cwd.replace(/[\\/]+$/, '')}${sep}${stemOf(baseNameOf(inputPath))}.txt`];
  for (const name of candidates) {
    try {
      const bytes = await fcReadFileBytes(name, MAX_EXTERNAL_CHARS * 4);
      const raw = Uint8Array.from(atob(bytes.base64), (c) => c.charCodeAt(0));
      const text = new TextDecoder('utf-8', { fatal: false }).decode(raw).trim();
      if (text) {
        return { text: text.slice(0, MAX_EXTERNAL_CHARS), method: `external:${exeName}` };
      }
    } catch {
      // 다음 후보를 시도한다.
    }
  }
  throw new Error('Parser produced no output file.');
}
