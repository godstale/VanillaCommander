import { z } from 'zod';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';
import { strArg } from './common';
import { requestExplorer } from './explorerBridge';

const RawParams = z.object({
  action: z.enum(['open', 'goto', 'select']).describe('Explorer tab action'),
  path: z.string().min(1).describe('Folder path to show'),
});

const Params = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null) return val;
  const v = val as Record<string, unknown>;
  return {
    action: strArg(v, 'action', 'op', 'command') ?? 'open',
    path: strArg(v, 'path', 'dir', 'folder', 'directory'),
  };
}, RawParams);

export function createExplorerTool(): AgentTool<typeof Params> {
  return {
    name: 'explorer',
    label: 'Control explorer',
    description:
      'Show results in the file explorer UI: open/goto a folder (opens a tab or focuses the existing one). Use after organizing files so the user sees the outcome. select behaves like goto (selection follows the next user click).',
    parameters: Params,
    risk: 'low',
    executionMode: 'parallel',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof Params>,
    ): Promise<AgentToolResult> {
      const handled = requestExplorer({ action: params.action, path: params.path });
      if (!handled) {
        throw new Error('Explorer UI is not available right now.');
      }
      const note =
        params.action === 'select'
          ? ' (focused the tab; selection follows the next user click)'
          : '';
      return {
        content: `Explorer is now showing ${params.path}${note}.`,
        details: { action: params.action, path: params.path },
      };
    },
  };
}

export const explorerTool = createExplorerTool();
