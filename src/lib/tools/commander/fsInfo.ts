import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';
import { awaitJobCompletion, strArrayArg } from './common';
import { isFcStatResult } from '@/lib/commander/ipc';

const RawParams = z.object({
  paths: z.array(z.string()).min(1).describe('Paths to inspect'),
});

const Params = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null) return val;
  const v = val as Record<string, unknown>;
  return {
    paths: strArrayArg(v, 'paths', 'path', 'files', 'targets'),
  };
}, RawParams);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
}

export function createFsInfoTool(): AgentTool<typeof Params> {
  return {
    name: 'fs_info',
    label: 'File info',
    description:
      'Inspect paths: recursive byte size and file/folder counts (folders included). Use before planning moves or estimating work.',
    parameters: Params,
    risk: 'low',
    executionMode: 'parallel',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof Params>,
    ): Promise<AgentToolResult> {
      const jobId = await invoke<string>('fc_stat', { paths: params.paths });
      const done = await awaitJobCompletion(jobId);
      if (!done.ok) {
        throw new Error(done.error ?? 'fs_info failed');
      }
      if (!isFcStatResult(done.result)) {
        throw new Error('fs_info returned an unexpected result');
      }
      const r = done.result;
      return {
        content: [
          `files=${r.file_count} dirs=${r.dir_count} total=${formatBytes(r.total_bytes)}`,
          `paths: ${r.paths.join(', ')}`,
        ].join('\n'),
        details: r,
      };
    },
  };
}

export const fsInfoTool = createFsInfoTool();
