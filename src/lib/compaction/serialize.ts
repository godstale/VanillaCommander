import type { AgentMessage } from '@/lib/agent/types';

export const TOOL_RESULT_MAX_CHARS = 2000;

function formatToolCallArguments(args: unknown): string {
  if (typeof args !== 'object' || args === null) {
    return String(args);
  }
  const pairs = Object.entries(args).map(([k, v]) => {
    const valStr = typeof v === 'string' ? JSON.stringify(v) : String(v);
    return `${k}=${valStr}`;
  });
  return pairs.join(', ');
}

/**
 * Serializes a list of messages into structured text for LLM summarization.
 * Implements Architecture §9.4:
 * [User]: ...
 * [Assistant thinking]: ...
 * [Assistant]: ...
 * [Assistant tool calls]: name(arg="value", ...); ...
 * [Tool result]: ... (truncated to 2000 chars)
 */
export function serializeMessagesForSummary(messages: AgentMessage[]): string {
  const blocks: string[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'user': {
        blocks.push(`[User]:\n${msg.content.trim()}`);
        break;
      }
      case 'assistant': {
        if (msg.thinking && msg.thinking.trim()) {
          blocks.push(`[Assistant thinking]:\n${msg.thinking.trim()}`);
        }
        if (msg.content && msg.content.trim()) {
          blocks.push(`[Assistant]:\n${msg.content.trim()}`);
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const callsText = msg.toolCalls
            .map((tc) => `${tc.name}(${formatToolCallArguments(tc.arguments)})`)
            .join('; ');
          blocks.push(`[Assistant tool calls]:\n${callsText}`);
        }
        break;
      }
      case 'toolResult': {
        let content = msg.content;
        if (content.length > TOOL_RESULT_MAX_CHARS) {
          const omitted = content.length - TOOL_RESULT_MAX_CHARS;
          content = `${content.slice(0, TOOL_RESULT_MAX_CHARS)}\n[... ${omitted} characters truncated ...]`;
        }
        blocks.push(`[Tool result (${msg.toolName})]:\n${content.trim()}`);
        break;
      }
      case 'system': {
        blocks.push(`[System instructions]:\n${msg.content.trim()}`);
        break;
      }
    }
  }

  return blocks.join('\n\n');
}

export interface FileOps {
  readFiles: string[];
  modifiedFiles: string[];
}

/**
 * Extracts read/modified file paths from tool calls across messages,
 * taking the union with previousDetails if provided.
 */
export function extractFileOps(
  messages: AgentMessage[],
  previousDetails?: { readFiles?: string[]; modifiedFiles?: string[] },
): FileOps {
  const readSet = new Set<string>(previousDetails?.readFiles ?? []);
  const modifiedSet = new Set<string>(previousDetails?.modifiedFiles ?? []);

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        const args = (tc.arguments && typeof tc.arguments === 'object'
          ? tc.arguments
          : {}) as Record<string, unknown>;

        const targetPath =
          typeof args.path === 'string'
            ? args.path
            : typeof args.targetFile === 'string'
              ? args.targetFile
              : typeof args.filePath === 'string'
                ? args.filePath
                : undefined;

        if (!targetPath) continue;

        if (['read', 'ls', 'grep', 'find'].includes(tc.name)) {
          readSet.add(targetPath);
        } else if (['write', 'edit'].includes(tc.name)) {
          modifiedSet.add(targetPath);
        }
      }
    }
  }

  return {
    readFiles: Array.from(readSet).sort(),
    modifiedFiles: Array.from(modifiedSet).sort(),
  };
}
