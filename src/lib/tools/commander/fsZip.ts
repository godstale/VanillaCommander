import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';
import { awaitJobCompletion, snapshotForBackup, strArg, strArrayArg } from './common';

const RawParams = z.object({
  sources: z.array(z.string()).min(1).describe('Files/folders to compress'),
  dest: z.string().min(1).describe('Destination .zip path'),
});

const Params = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null) return val;
  const v = val as Record<string, unknown>;
  return {
    sources: strArrayArg(v, 'sources', 'source', 'paths', 'files'),
    dest: strArg(v, 'dest', 'output', 'to', 'archive', 'zipPath'),
  };
}, RawParams);

export function createFsZipTool(
  ctx: { workspaceRoot?: string; workFolder?: string } = {},
): AgentTool<typeof Params> {
  return {
    name: 'fs_zip',
    label: 'Compress to zip',
    description:
      'Compress files/folders into a .zip archive (existing archive is snapshotted first). sources: path array. dest: archive path.',
    parameters: Params,
    risk: 'high',
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof Params>,
    ): Promise<AgentToolResult> {
      const backup = await snapshotForBackup([params.dest], ctx.workFolder);
      const jobId = await invoke<string>('fc_zip', { sources: params.sources, dest: params.dest });
      const done = await awaitJobCompletion(jobId);
      if (!done.ok) {
        throw new Error(done.error ?? 'fs_zip failed');
      }
      const r = (done.result ?? {}) as { files?: number; bytes?: number; warning?: boolean };
      const lines = [`Created ${params.dest} (files=${r.files ?? 0}, bytes=${r.bytes ?? 0}).`];
      if (backup.length > 0) lines.push(`Backup snapshot: ${backup[0]}.`);
      if (r.warning === true) lines.push('Warning: destination is under a system folder.');
      return {
        content: lines.join('\n'),
        details: { sources: params.sources, dest: params.dest, warning: r.warning ?? false, backup },
      };
    },
  };
}

export const fsZipTool = createFsZipTool();
