import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';
import { strArg } from './common';

const RawParams = z.object({
  path: z.string().min(1).describe('Directory path to create'),
});

const Params = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null) return val;
  const v = val as Record<string, unknown>;
  return {
    path: strArg(v, 'path', 'dir', 'directory', 'folder'),
  };
}, RawParams);

export function createFsMkdirTool(): AgentTool<typeof Params> {
  return {
    name: 'fs_mkdir',
    label: 'Create folder',
    description: 'Create a directory (parents included). Fails if it already exists.',
    parameters: Params,
    risk: 'high',
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof Params>,
    ): Promise<AgentToolResult> {
      const res = await invoke<{ warning: boolean }>('fc_mkdir', { path: params.path });
      const lines = [`Created folder ${params.path}.`];
      if (res.warning) lines.push('Warning: path is under a system folder.');
      return {
        content: lines.join('\n'),
        details: { path: params.path, warning: res.warning },
      };
    },
  };
}

export const fsMkdirTool = createFsMkdirTool();
