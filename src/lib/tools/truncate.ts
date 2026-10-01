export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

export interface TruncationOptions {
  maxLines?: number;
  maxBytes?: number;
}

export interface TruncationResult {
  content: string;
  truncated: boolean;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function truncateOutput(
  content: string,
  options?: TruncationOptions,
): TruncationResult {
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;

  const totalBytes = new TextEncoder().encode(content).length;
  const lines = content.split('\n');
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
    };
  }

  const keptLines: string[] = [];
  let currentBytes = 0;

  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const line = lines[i];
    const lineByteLength = new TextEncoder().encode(line).length + (i > 0 ? 1 : 0);
    if (currentBytes + lineByteLength > maxBytes) {
      break;
    }
    keptLines.push(line);
    currentBytes += lineByteLength;
  }

  const outputLines = keptLines.length;
  const omittedLines = totalLines - outputLines;
  const outputBytes = currentBytes;

  const marker = `\n[출력 절단: 총 ${totalLines}줄 (${formatBytes(totalBytes)}) 중 ${outputLines}줄 (${formatBytes(outputBytes)}) 표시, ${omittedLines}줄 생략됨]`;

  return {
    content: keptLines.join('\n') + marker,
    truncated: true,
    totalLines,
    totalBytes,
    outputLines,
    outputBytes,
  };
}
