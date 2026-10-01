import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';

interface DirEntryItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

const LsParametersSchema = z.object({
  path: z.string().describe('Directory path to list'),
});

export function createLsTool(ctx: { workspaceRoot?: string } = {}): AgentTool<typeof LsParametersSchema> {
  return {
    name: 'ls',
    label: 'List Directory',
    description: 'Lists files and folders inside a specified directory.',
    parameters: LsParametersSchema,
    risk: 'low',
    executionMode: 'parallel',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof LsParametersSchema>,
    ): Promise<AgentToolResult> {
      const entries = await invoke<DirEntryItem[]>('list_dir', {
        path: params.path,
        workspaceRoot: ctx.workspaceRoot,
      });

      if (entries.length === 0) {
        return {
          content: '(empty directory)',
          details: { path: params.path, count: 0, entries: [], workspaceRoot: ctx.workspaceRoot },
        };
      }

      const formattedLines = entries.map((entry) => {
        if (entry.is_dir) {
          return `[DIR]  ${entry.name}/`;
        }
        return `[FILE] ${entry.name} (${entry.size} B)`;
      });

      return {
        content: formattedLines.join('\n'),
        details: {
          path: params.path,
          count: entries.length,
          entries,
          workspaceRoot: ctx.workspaceRoot,
        },
      };
    },
  };
}

export const lsTool = createLsTool();
