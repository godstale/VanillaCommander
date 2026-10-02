import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';
import { snapshotForBackup, strArrayArg } from './common';

const RawParams = z.object({
  paths: z.array(z.string()).min(1).describe('Paths to move to the OS trash'),
});

const Params = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null) return val;
  const v = val as Record<string, unknown>;
  return {
    paths: strArrayArg(v, 'paths', 'path', 'files', 'targets'),
  };
}, RawParams);

export function createFsTrashTool(
  ctx: { workspaceRoot?: string; workFolder?: string } = {},
): AgentTool<typeof Params> {
  return {
    name: 'fs_trash',
    label: 'Trash files',
    description:
      'Move files/folders to the OS trash (recoverable, snapshotted to backup/ first). Prefer over permanent deletion. Announce deletions in one line before acting.',
    parameters: Params,
    risk: 'high',
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof Params>,
    ): Promise<AgentToolResult> {
      const backup = await snapshotForBackup(params.paths, ctx.workFolder);
      await invoke('fc_trash', { paths: params.paths });
      const lines = [`Moved ${params.paths.length} item(s) to trash.`];
      if (backup.length > 0) {
        lines.push(`Backup snapshots: ${backup.length} item(s) under backup/.`);
      } else if (!ctx.workFolder) {
        lines.push('No work folder: backup skipped.');
      }
      return {
        content: lines.join('\n'),
        details: { paths: params.paths, backup },
      };
    },
  };
}

export const fsTrashTool = createFsTrashTool();
