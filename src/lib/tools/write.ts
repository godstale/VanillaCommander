import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';

const RawWriteParametersSchema = z.object({
  path: z.string().describe('Absolute or workspace-relative path of the file to write'),
  content: z.string().describe('Complete text content to write into the file'),
});

const WriteParametersSchema = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null) return val;
  const v = val as Record<string, unknown>;
  const path = v.path ?? v.filePath ?? v.file_path ?? v.filename ?? v.file;
  const content =
    v.content ?? v.contents ?? v.text ?? v.code ?? v.body ?? v.file_content ?? v.data;
  return {
    ...v,
    path: typeof path === 'string' ? path : path !== undefined ? String(path) : undefined,
    content: typeof content === 'string' ? content : content !== undefined ? String(content) : undefined,
  };
}, RawWriteParametersSchema);

export function createWriteTool(ctx: { workspaceRoot?: string } = {}): AgentTool<typeof WriteParametersSchema> {
  return {
    name: 'write',
    label: 'Write File',
    description:
      'Writes or overwrites content to a specified file. Parent directories are created automatically if they do not exist.',
    parameters: WriteParametersSchema,
    risk: 'high',
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof WriteParametersSchema>,
    ): Promise<AgentToolResult> {
      await invoke('write_text_file', {
        path: params.path,
        contents: params.content,
        workspaceRoot: ctx.workspaceRoot,
      });

      const byteLength = new TextEncoder().encode(params.content).length;
      return {
        content: `Successfully wrote ${byteLength} bytes to ${params.path}`,
        details: {
          path: params.path,
          bytesWritten: byteLength,
          workspaceRoot: ctx.workspaceRoot,
        },
      };
    },
  };
}

export const writeTool = createWriteTool();
