import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';
import { truncateOutput } from '@/lib/tools/truncate';

interface ShellOutput {
  stdout: string;
  stderr: string;
  exit_code: i32;
}

type i32 = number;

const ShellParametersSchema = z.object({
  command: z.string().describe('The command line string to execute in shell'),
  cwd: z.string().optional().describe('Optional working directory (must be inside workspace)'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .optional()
    .describe('Timeout in milliseconds (default 120,000 ms)'),
});

export function createShellTool(ctx: { workspaceRoot?: string } = {}): AgentTool<typeof ShellParametersSchema> {
  return {
    name: 'shell',
    label: 'Run Shell Command',
    description:
      'Executes a command line instruction in the workspace shell. Always requires approval.',
    parameters: ShellParametersSchema,
    risk: 'critical',
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof ShellParametersSchema>,
    ): Promise<AgentToolResult> {
      const output = await invoke<ShellOutput>('run_shell', {
        command: params.command,
        cwd: params.cwd,
        timeoutMs: params.timeoutMs,
        workspaceRoot: ctx.workspaceRoot,
      });

      const isError = output.exit_code !== 0;
      const combinedOutput = [
        output.stdout ? `STDOUT:\n${output.stdout}` : '',
        output.stderr ? `STDERR:\n${output.stderr}` : '',
        `Exit Code: ${output.exit_code}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const truncated = truncateOutput(combinedOutput);

      return {
        content: truncated.content,
        isError,
        details: {
          command: params.command,
          exitCode: output.exit_code,
          rawStdout: output.stdout,
          rawStderr: output.stderr,
          workspaceRoot: ctx.workspaceRoot,
        },
      };
    },
  };
}

export const shellTool = createShellTool();
