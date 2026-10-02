import { z } from 'zod';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';
import { strArg, strArrayArg } from './common';
import { parseConflict, runTransfer } from './transfer';

const RawParams = z.object({
  sources: z.array(z.string()).min(1).describe('Source file/folder paths'),
  destDir: z.string().min(1).describe('Destination directory'),
  conflict: z.string().optional().describe("Conflict policy: 'rename' (default), 'overwrite', 'skip'"),
});

// 로컬 소형 모델의 별칭 흡수 (wiki.ts preprocess 패턴).
const Params = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null) return val;
  const v = val as Record<string, unknown>;
  return {
    sources: strArrayArg(v, 'sources', 'source', 'paths', 'files'),
    destDir: strArg(v, 'destDir', 'dest_dir', 'destination', 'dest', 'dir', 'to'),
    conflict: strArg(v, 'conflict', 'onConflict', 'ifExists') ?? 'rename',
  };
}, RawParams);

export function createFsMoveTool(
  ctx: { workspaceRoot?: string; workFolder?: string } = {},
): AgentTool<typeof Params> {
  return {
    name: 'fs_move',
    label: 'Move files',
    description:
      'Move files/folders into a destination directory (sources are snapshotted to backup/ first). sources: path array. destDir: target directory. conflict: rename (default), overwrite, or skip. Announce destructive moves in one line before acting.',
    parameters: Params,
    risk: 'high',
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof Params>,
    ): Promise<AgentToolResult> {
      const conflict = parseConflict(params.conflict);
      const r = await runTransfer('move', params.sources, params.destDir, conflict, ctx.workFolder);
      return { content: r.content, details: r.details };
    },
  };
}

export const fsMoveTool = createFsMoveTool();
