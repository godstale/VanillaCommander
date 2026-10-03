// P11-33: 문서 파서 계층. 우선순위: 사용자 지정 외부 파서(확장자별) →
// 내장 파서(pdfjs/mammoth/SheetJS/Rust office XML/텍스트) → 실패.
import type { ParserSettings } from '@/lib/db/repositories/settingsRepo';
import { parseBuiltinDocument, type ParsedDocument } from './builtin';
import { runExternalParser } from './external';
import { extOf } from '@/lib/commander/openFile';

export type { ParsedDocument };
export { EXTERNAL_PARSER_PRESETS } from './external';

export interface ParseDocumentOptions {
  /** settings.parsers. 지정된 확장자의 외부 파서를 먼저 시도한다. */
  parsers?: ParserSettings;
  /** file 모드 외부 파서의 작업 폴더. */
  cwd?: string;
  /** 스캔 PDF 판정 임계값 (기본 50자). */
  scannedThreshold?: number;
}

export type ParseFailureReason = 'unsupported' | 'scanned-pdf' | 'external-failed' | 'read-failed';

/** 파서 실패. `reason`으로 파이프라인이 다음 행동을 정한다. */
export class ParseError extends Error {
  readonly reason: ParseFailureReason;
  readonly method: string;
  constructor(reason: ParseFailureReason, message: string, method = 'none') {
    super(message);
    this.name = 'ParseError';
    this.reason = reason;
    this.method = method;
  }
}

const BUILTIN_EXTS = new Set(['pdf', 'docx', 'xlsx', 'xls', 'csv', 'pptx', 'txt', 'md', 'json', 'log']);

function extOfPath(path: string): string {
  return extOf(path.split(/[\\/]/).pop() ?? path);
}

/**
 * 문서 1개를 텍스트로 읽는다.
 * - 외부 파서 지정 시 먼저 실행하고, 실패하면 내장으로 폴백한다.
 * - 스캔 PDF(텍스트 레이어 없음)는 실패로 반환한다 — "외부 파서(OCR) 또는
 *   비전 에이전트 필요"가 실패 사유다.
 * - 내장이 모르는 확장자는 텍스트 디코딩을 시도하고, 바이너리면 실패한다.
 */
export async function parseDocument(
  path: string,
  opts: ParseDocumentOptions = {},
): Promise<ParsedDocument> {
  const ext = extOfPath(path);
  const override = opts.parsers?.overrides?.[ext] ?? opts.parsers?.overrides?.[`.${ext}`];
  if (override?.command?.trim()) {
    try {
      const out = await runExternalParser(path, override.command, override.outputMode, {
        cwd: opts.cwd,
      });
      return { text: out.text, truncated: out.text.length >= 200_000, method: out.method };
    } catch {
      // 외부 파서 실패는 내장으로 폴백한다 (사유는 로그에만 남긴다).
    }
  }

  let parsed: ParsedDocument;
  try {
    parsed = await parseBuiltinDocument(path);
  } catch (err) {
    throw new ParseError(
      'read-failed',
      err instanceof Error ? err.message : String(err),
      'builtin',
    );
  }

  // 스캔 PDF 판정: 페이지는 있는데 텍스트가 거의 없으면 OCR/비전이 필요하다.
  if (ext === 'pdf' && parsed.method === 'pdfjs') {
    const threshold = opts.scannedThreshold ?? 50;
    if ((parsed.pages ?? 1) > 0 && parsed.text.trim().length < threshold) {
      throw new ParseError(
        'scanned-pdf',
        '스캔 PDF로 보입니다 (텍스트 레이어 없음). 외부 파서(OCR) 또는 비전 에이전트가 필요합니다.',
        'pdfjs',
      );
    }
  }

  if (!BUILTIN_EXTS.has(ext) && parsed.method === 'text' && isLikelyBinary(parsed.text)) {
    throw new ParseError(
      'unsupported',
      `지원하지 않는 형식입니다: .${ext || '(없음)'}`,
      'text',
    );
  }
  return parsed;
}

/** NUL 바이트가 섞여 있으면 바이너리로 본다. */
function isLikelyBinary(text: string): boolean {
  return text.includes('\0');
}
