import { z } from 'zod';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';
import { strArg } from './common';
// P11-33: 외부 오버라이드 → 내장 우선순위 디스패치를 쓴다.
import { parseDocument, ParseError } from '@/lib/parsers/index';

const RawParams = z.object({
  path: z.string().min(1).describe('Document path (pdf/docx/xlsx/csv/pptx/text)'),
  maxChars: z.number().int().min(1000).max(200000).optional().describe('Max output chars (default 20000)'),
});

const Params = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null) return val;
  const v = val as Record<string, unknown>;
  const num = (u: unknown): number | undefined => {
    if (typeof u === 'number' && Number.isFinite(u)) return Math.floor(u);
    if (typeof u === 'string' && u.trim() !== '') {
      const n = Number(u);
      if (Number.isFinite(n)) return Math.floor(n);
    }
    return undefined;
  };
  return {
    path: strArg(v, 'path', 'file', 'filePath', 'document'),
    maxChars: num(v.maxChars ?? v.max_chars ?? v.limit) ?? 20000,
  };
}, RawParams);

export function createDocReadTool(): AgentTool<typeof Params> {
  return {
    name: 'doc_read',
    label: 'Read document',
    description:
      'Extract text from documents (pdf/docx/xlsx/csv/pptx/text) for reading. Prefer over read for binary office formats. Returns capped plain text.',
    parameters: Params,
    risk: 'low',
    executionMode: 'parallel',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof Params>,
    ): Promise<AgentToolResult> {
      let parsed;
      try {
        parsed = await parseDocument(params.path);
      } catch (err) {
        // 스캔 PDF 등은 실패 사유를 그대로 돌려준다 (OCR·비전 안내 포함).
        const message = err instanceof ParseError ? err.message : err instanceof Error ? err.message : String(err);
        return {
          content: `[${params.path}] parse failed: ${message}`,
          details: {
            path: params.path,
            reason: err instanceof ParseError ? err.reason : 'read-failed',
          },
          isError: true,
        };
      }
      const text =
        parsed.text.length > (params.maxChars ?? 20000)
          ? parsed.text.slice(0, params.maxChars ?? 20000)
          : parsed.text;
      const lines = [`[${params.path}] (${parsed.method}${parsed.truncated ? ', truncated' : ''})`, text];
      return {
        content: lines.join('\n'),
        details: { path: params.path, method: parsed.method, truncated: parsed.truncated },
      };
    },
  };
}

export const docReadTool = createDocReadTool();
