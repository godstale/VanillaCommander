import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';

export function countOccurrences(source: string, sub: string): number {
  if (!sub) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = source.indexOf(sub, pos)) !== -1) {
    count++;
    pos += sub.length;
  }
  return count;
}

const RawEditParametersSchema = z.object({
  path: z.string().describe('Absolute or workspace-relative path of the file to edit'),
  oldText: z
    .string()
    .describe('Exact string in the file to replace. Must be unique in the file.'),
  newText: z.string().describe('New replacement string'),
});

const EditParametersSchema = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null) return val;
  const v = val as Record<string, unknown>;
  const path = v.path ?? v.filePath ?? v.file_path ?? v.filename ?? v.file;
  const oldText = v.oldText ?? v.old_text ?? v.search ?? v.find ?? v.target;
  const newText = v.newText ?? v.new_text ?? v.replace ?? v.replacement;
  return {
    ...v,
    path: typeof path === 'string' ? path : path !== undefined ? String(path) : undefined,
    oldText: typeof oldText === 'string' ? oldText : oldText !== undefined ? String(oldText) : undefined,
    newText: typeof newText === 'string' ? newText : newText !== undefined ? String(newText) : undefined,
  };
}, RawEditParametersSchema);

export function createEditTool(ctx: { workspaceRoot?: string } = {}): AgentTool<typeof EditParametersSchema> {
  return {
    name: 'edit',
    label: 'Edit File',
    description:
      'Replaces an exact, unique text block with new text in the specified file. If oldText matches 0 or multiple times, the edit fails.',
    parameters: EditParametersSchema,
    risk: 'high',
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof EditParametersSchema>,
    ): Promise<AgentToolResult> {
      const rawContent = await invoke<string>('read_text_file', {
        path: params.path,
        workspaceRoot: ctx.workspaceRoot,
      });

      const matches = countOccurrences(rawContent, params.oldText);

      if (matches === 0) {
        throw new Error(
          `치환 대상(oldText)을 파일 '${params.path}'에서 찾을 수 없습니다. 더 긴 고유 문맥을 포함해 다시 시도하십시오.`,
        );
      }

      if (matches > 1) {
        throw new Error(
          `치환 대상(oldText)이 파일 '${params.path}'에 ${matches}건 존재하여 고유하지 않습니다. 더 긴 고유 문맥을 포함해 다시 시도하십시오.`,
        );
      }

      const updatedContent = rawContent.replace(params.oldText, params.newText);

      await invoke('write_text_file', {
        path: params.path,
        contents: updatedContent,
        workspaceRoot: ctx.workspaceRoot,
      });

      return {
        content: `Successfully replaced text in ${params.path}`,
        details: {
          path: params.path,
          oldTextLength: params.oldText.length,
          newTextLength: params.newText.length,
          workspaceRoot: ctx.workspaceRoot,
        },
      };
    },
  };
}

export const editTool = createEditTool();
