import { isChartDsl, parseAndNormalizeChartDsl } from '../types/chartDsl';

export interface VisualBlock {
  type: 'mermaid' | 'recharts';
  content: string;
  raw: string;
  startIndex: number;
  endIndex: number;
  parsedJson?: unknown;
  parseError?: string;
}

export interface MarkdownSegment {
  type: 'text' | 'mermaid' | 'recharts';
  content: string;
  raw?: string;
  startIndex: number;
  endIndex: number;
  parsedJson?: unknown;
  parseError?: string;
}

const VISUAL_FENCE_REGEX = /```(mermaid|recharts)[ \t]*\r?\n([\s\S]*?)```/g;

/**
 * Finds all ```mermaid and ```recharts code blocks in markdown text,
 * extracting their position and content. Recharts blocks attempt JSON parsing.
 */
export function parseVisualBlocks(markdown: string): VisualBlock[] {
  if (!markdown) return [];

  const blocks: VisualBlock[] = [];
  const regex = new RegExp(VISUAL_FENCE_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    const raw = match[0];
    let type = match[1].toLowerCase() as 'mermaid' | 'recharts';
    const content = match[2];
    const startIndex = match.index;
    const endIndex = startIndex + raw.length;

    let parsedJson: unknown | undefined;
    let parseError: string | undefined;

    if (type === 'mermaid' && isChartDsl(content)) {
      type = 'recharts';
    }

    if (type === 'recharts') {
      try {
        parsedJson = JSON.parse(content.trim());
      } catch {
        try {
          parsedJson = parseAndNormalizeChartDsl(content.trim());
        } catch (err) {
          parseError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    blocks.push({
      type,
      content,
      raw,
      startIndex,
      endIndex,
      parsedJson,
      parseError,
    });
  }

  return blocks;
}

/**
 * Splits markdown into contiguous segments of text, mermaid, and recharts blocks.
 */
export function splitMarkdownByVisualBlocks(markdown: string): MarkdownSegment[] {
  if (!markdown) return [];

  const blocks = parseVisualBlocks(markdown);
  if (blocks.length === 0) {
    return [
      {
        type: 'text',
        content: markdown,
        startIndex: 0,
        endIndex: markdown.length,
      },
    ];
  }

  const segments: MarkdownSegment[] = [];
  let cursor = 0;

  for (const block of blocks) {
    if (block.startIndex > cursor) {
      segments.push({
        type: 'text',
        content: markdown.slice(cursor, block.startIndex),
        startIndex: cursor,
        endIndex: block.startIndex,
      });
    }

    segments.push({
      type: block.type,
      content: block.content,
      raw: block.raw,
      startIndex: block.startIndex,
      endIndex: block.endIndex,
      parsedJson: block.parsedJson,
      parseError: block.parseError,
    });

    cursor = block.endIndex;
  }

  if (cursor < markdown.length) {
    segments.push({
      type: 'text',
      content: markdown.slice(cursor),
      startIndex: cursor,
      endIndex: markdown.length,
    });
  }

  return segments;
}
