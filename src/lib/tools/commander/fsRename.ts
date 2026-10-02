import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';
import { strArg } from './common';
import { snapshotForBackup } from './common';

const RawParams = z.object({
  path: z.string().min(1).describe('File or folder path to rename'),
  newName: z.string().min(1).describe('New name (not a path)'),
});

const Params = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null) return val;
  const v = val as Record<string, unknown>;
  return {
    path: strArg(v, 'path', 'file', 'target', 'from'),
    newName: strArg(v, 'newName', 'new_name', 'name', 'to'),
  };
}, RawParams);

export function createFsRenameTool(
  ctx: { workspaceRoot?: string; workFolder?: string } = {},
): AgentTool<typeof Params> {
  return {
    name: 'fs_rename',
    label: 'Rename file',
    description:
      'Rename a file or folder in place (snapshotted to backup/ first). path: existing path. newName: new name only, slashes are rejected.',
    parameters: Params,
    risk: 'high',
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof Params>,
    ): Promise<AgentToolResult> {
      const backup = await snapshotForBackup([params.path], ctx.workFolder);
      const res = await invoke<{ warning: boolean }>('fc_rename', {
        path: params.path,
        newName: params.newName,
      });
      const lines = [`Renamed to ${params.newName}.`];
      if (backup.length > 0) lines.push(`Backup snapshot: ${backup[0]}.`);
      else if (!ctx.workFolder) lines.push('No work folder: backup skipped.');
      if (res.warning) lines.push('Warning: path is under a system folder.');
      return {
        content: lines.join('\n'),
        details: { path: params.path, newName: params.newName, warning: res.warning, backup },
      };
    },
  };
}

export const fsRenameTool = createFsRenameTool();
