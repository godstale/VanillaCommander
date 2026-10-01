import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';

interface GrepMatch {
  file_path: string;
  line_number: number;
  line_content: string;
}

const GrepParametersSchema = z.object({
  pattern: z.string().describe('Regular expression pattern to search for'),
  path: z.string().describe('Directory or file path to search within'),
  glob: z
    .string()
    .optional()
    .describe('Optional glob pattern filter, e.g. "*.ts" or "!node_modules"'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Maximum number of matching lines to return (default 100)'),
});

export function createGrepTool(ctx: { workspaceRoot?: string } = {}): AgentTool<typeof GrepParametersSchema> {
  return {
    name: 'grep',
    label: 'Grep Search',
    description:
      'Searches for regex patterns in files while respecting .gitignore. Returns matching file paths, line numbers, and contents.',
    parameters: GrepParametersSchema,
    risk: 'low',
    executionMode: 'parallel',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof GrepParametersSchema>,
    ): Promise<AgentToolResult> {
      const matches = await invoke<GrepMatch[]>('grep_files', {
        pattern: params.pattern,
        path: params.path,
        glob: params.glob,
        maxResults: params.maxResults,
        workspaceRoot: ctx.workspaceRoot,
      });

      if (matches.length === 0) {
        return {
          content: 'No matches found.',
          details: { matches: [], workspaceRoot: ctx.workspaceRoot },
        };
      }

      const lines = matches.map(
        (m) => `${m.file_path}:${m.line_number}: ${m.line_content}`,
      );

      return {
        content: lines.join('\n'),
        details: {
          totalMatches: matches.length,
          matches,
          workspaceRoot: ctx.workspaceRoot,
        },
      };
    },
  };
}

export const grepTool = createGrepTool();
