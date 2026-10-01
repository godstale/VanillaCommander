export interface JsonlLine {
  line: number;
  value: unknown;
}

export interface JsonlParseResult {
  lines: JsonlLine[];
  diagnostics: Array<{ line: number; message: string }>;
}

export function parseJsonl(text: string): JsonlParseResult {
  const lines: JsonlLine[] = [];
  const diagnostics: Array<{ line: number; message: string }> = [];
  const rawLines = text.split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const trimmed = rawLines[i].trim();
    if (trimmed === '') continue;
    try {
      lines.push({ line: lineNo, value: JSON.parse(trimmed) as unknown });
    } catch (err) {
      diagnostics.push({
        line: lineNo,
        message: err instanceof Error ? err.message : 'invalid JSON',
      });
    }
  }
  return { lines, diagnostics };
}
