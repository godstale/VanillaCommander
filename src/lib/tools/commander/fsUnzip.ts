import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';
import { awaitJobCompletion, snapshotForBackup, strArg } from './common';
import { fcArchiveList } from '@/lib/commander/ipc';

const RawParams = z.object({
  archive: z.string().min(1).describe('Archive (.zip) path'),
  destDir: z.string().min(1).describe('Directory to extract into'),
});

const Params = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null) return val;
  const v = val as Record<string, unknown>;
  return {
    archive: strArg(v, 'archive', 'path', 'zip', 'zipPath', 'file'),
    destDir: strArg(v, 'destDir', 'dest_dir', 'destination', 'dest', 'dir', 'to'),
  };
}, RawParams);

export function createFsUnzipTool(
  ctx: { workspaceRoot?: string; workFolder?: string } = {},
): AgentTool<typeof Params> {
  return {
    name: 'fs_unzip',
    label: 'Extract zip',
    description:
      'Extract a .zip archive into a directory (files that would be overwritten are snapshotted first). archive: zip path. destDir: target directory.',
    parameters: Params,
    risk: 'high',
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof Params>,
    ): Promise<AgentToolResult> {
      // 덮어쓸 기존 파일을 미리 백업한다.
      let backupTargets: string[];
      try {
        const entries = await fcArchiveList(params.archive);
        const sep = params.destDir.includes('\\') ? '\\' : '/';
        backupTargets = entries
          .filter((e) => !e.is_dir)
          .map((e) => `${params.destDir.replace(/[\\/]+$/, '')}${sep}${e.name.replace(/\//g, sep)}`);
      } catch {
        backupTargets = [];
      }
      const backup = await snapshotForBackup(backupTargets, ctx.workFolder);
      const jobId = await invoke<string>('fc_unzip', {
        archive: params.archive,
        destDir: params.destDir,
      });
      const done = await awaitJobCompletion(jobId);
      if (!done.ok) {
        throw new Error(done.error ?? 'fs_unzip failed');
      }
      const r = (done.result ?? {}) as { files?: number; warning?: boolean };
      const lines = [`Extracted ${params.archive} to ${params.destDir} (files=${r.files ?? 0}).`];
      if (backup.length > 0) lines.push(`Backup snapshots: ${backup.length} item(s) under backup/.`);
      if (r.warning === true) lines.push('Warning: destination is under a system folder.');
      return {
        content: lines.join('\n'),
        details: { archive: params.archive, destDir: params.destDir, warning: r.warning ?? false, backup },
      };
    },
  };
}

export const fsUnzipTool = createFsUnzipTool();
