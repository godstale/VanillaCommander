import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';

interface FindMatch {
  path: string;
  is_dir: boolean;
}

const FindParametersSchema = z.object({
  pattern: z.string().describe('Glob pattern to match file or directory names, e.g. "*.md" or "App.*"'),
  path: z.string().describe('Root directory to search within'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Maximum number of results to return (default 100)'),
});

export function createFindTool(ctx: { workspaceRoot?: string } = {}): AgentTool<typeof FindParametersSchema> {
  return {
    name: 'find',
    label: 'Find Files',
    description:
      'Finds files and directories matching a glob pattern while respecting .gitignore.',
    parameters: FindParametersSchema,
    risk: 'low',
    executionMode: 'parallel',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof FindParametersSchema>,
    ): Promise<AgentToolResult> {
      const matches = await invoke<FindMatch[]>('find_files', {
        pattern: params.pattern,
        path: params.path,
        maxResults: params.maxResults,
        workspaceRoot: ctx.workspaceRoot,
      });

      if (matches.length === 0) {
        return {
          content: 'No matching files or directories found.',
          details: { matches: [], workspaceRoot: ctx.workspaceRoot },
        };
      }

      const lines = matches.map((m) => `${m.path}${m.is_dir ? '/' : ''}`);

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

export const findTool = createFindTool();
