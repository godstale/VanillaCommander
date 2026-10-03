import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AgentMessage, AgentTool } from '@/lib/agent/types';
import type { OllamaChatRequest, OllamaToolCall } from '@/lib/llm/ollamaClient';
import type { OpenAiChatRequest } from '@/lib/llm/openAiCompatibleClient';
import { fcReadFileBytes } from '@/lib/commander/ipc';

export function cleanThinkingText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<\/?(?:think|thinking)>/gi, '')
    .trim();
}

export interface MapMessageOptions {
  /**
   * Strip <think>...</think> blocks from assistant messages to prevent
   * previous internal scratchpads from consuming prompt tokens in subsequent turns.
   * Default: true.
   */
  stripThinking?: boolean;
  /**
   * Compact older tool results that exceed pastToolResultMaxChars
   * so working memory remains focused on the latest sub-step.
   * Default: true.
   */
  prunePastToolResults?: boolean;
  /**
   * Maximum characters to retain for older tool results (default 3000).
   */
  pastToolResultMaxChars?: number;
  /**
   * Number of recent tool results to preserve completely unpruned (default 3).
   */
  keepRecentToolCount?: number;
}

export function mapAgentMessagesToOllama(
  messages: AgentMessage[],
  options: MapMessageOptions = {},
): OllamaChatRequest['messages'] {
  const {
    stripThinking = true,
    prunePastToolResults = true,
    pastToolResultMaxChars = 3000,
    keepRecentToolCount = 3,
  } = options;

  // Find all indices of toolResult messages
  const toolResultIndices: number[] = [];
  messages.forEach((msg, idx) => {
    if (msg.role === 'toolResult') {
      toolResultIndices.push(idx);
    }
  });

  // Retain recent tool results completely unpruned (at least keepRecentToolCount)
  const pruneCutoffIndex =
    toolResultIndices.length > keepRecentToolCount
      ? toolResultIndices[toolResultIndices.length - keepRecentToolCount]
      : -1;

  return messages.map((msg, index) => {
    switch (msg.role) {
      case 'system':
        return {
          role: 'system',
          content: msg.content,
        };
      case 'user':
        return {
          role: 'user',
          content: msg.content,
          images: msg.images && msg.images.length > 0 ? [...msg.images] : undefined,
        };
      case 'assistant': {
        const ollamaToolCalls: OllamaToolCall[] | undefined = msg.toolCalls?.map((tc) => ({
          function: {
            name: tc.name,
            arguments: (typeof tc.arguments === 'object' && tc.arguments !== null
              ? tc.arguments
              : {}) as Record<string, unknown>,
          },
        }));

        let content = msg.content ?? '';
        if (stripThinking) {
          content = cleanThinkingText(content);
          content = content || (ollamaToolCalls && ollamaToolCalls.length > 0 ? '' : (msg.content ?? ''));
        }

        return {
          role: 'assistant',
          content,
          tool_calls: ollamaToolCalls && ollamaToolCalls.length > 0 ? ollamaToolCalls : undefined,
        };
      }
      case 'toolResult': {
        let content = msg.content;
        // If this is an older tool result and exceeds the limit, compact it to preserve context
        if (
          prunePastToolResults &&
          pruneCutoffIndex >= 0 &&
          index < pruneCutoffIndex &&
          content &&
          content.length > pastToolResultMaxChars
        ) {
          const truncated = content.slice(0, pastToolResultMaxChars);
          content = `${truncated}\n\n... [과거 단계 도구 결과 (${msg.content.length}자) - 최신 문맥 공간 확보를 위해 이전 내용 축약됨]`;
        }

        return {
          role: 'tool',
          content,
        };
      }
      default: {
        const exhaustCheck: never = msg;
        throw new Error(`Unhandled message role in mapping: ${JSON.stringify(exhaustCheck)}`);
      }
    }
  });
}

export function mapAgentToolsToOllama(tools: AgentTool[]): unknown[] {
  return mapAgentToolsToOpenAi(tools);
}

/** 메시지 images 배열(경로 또는 data URL)을 LLM 전송용 data URL로 변환한다. */
export async function resolveImageDataUrls(images: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const img of images) {
    if (img.startsWith('data:')) {
      out.push(img);
      continue;
    }
    const bytes = await fcReadFileBytes(img);
    const lower = img.toLowerCase();
    const mime = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.gif')
        ? 'image/gif'
        : lower.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg';
    out.push(`data:${mime};base64,${bytes.base64}`);
  }
  return out;
}

/**
 * 전송 직전 사용자 메시지의 이미지 경로를 data URL로 바꾼다.
 * 읽기에 실패한 이미지는 빼고 진행한다 (전체 전송을 막지 않는다).
 */
export async function resolveMessageImages(messages: AgentMessage[]): Promise<AgentMessage[]> {
  return Promise.all(
    messages.map(async (msg) => {
      if (msg.role !== 'user' || !msg.images || msg.images.length === 0) return msg;
      try {
        const urls = await resolveImageDataUrls(msg.images);
        return { ...msg, images: urls };
      } catch {
        const rest = { ...msg };
        delete rest.images;
        return rest;
      }
    }),
  );
}

/** 요청 메시지(매핑済)의 images를 data URL로 바꾼다. 클라이언트 전송 직전용. */
export async function resolveRequestImages<T>(messages: T[]): Promise<T[]> {
  return Promise.all(
    messages.map(async (m) => {
      const maybeImages = (m as { images?: unknown }).images;
      if (!Array.isArray(maybeImages) || maybeImages.length === 0) return m;
      try {
        return { ...m, images: await resolveImageDataUrls(maybeImages as string[]) };
      } catch {
        const rest = { ...(m as Record<string, unknown>) };
        delete rest.images;
        return rest as T;
      }
    }),
  );
}

/**
 * AgentTool → OpenAI 호환 tools (Ollama 규격과 동일한 function 스키마).
 * Ollama /api/chat과 OpenAI /v1/chat/completions가 같은 형태를 사용하므로
 * 두 Provider가 이 함수를 공유한다.
 */
export function mapAgentToolsToOpenAi(tools: AgentTool[]): unknown[] {
  return tools.map((tool) => {
    const rawSchema = zodToJsonSchema(tool.parameters, {
      target: 'openApi3',
    }) as Record<string, unknown>;

    // If schema has definitions (e.g. from sub-schemas), ensure root parameters object is clean
    const defs =
      rawSchema.definitions && typeof rawSchema.definitions === 'object'
        ? (rawSchema.definitions as Record<string, unknown>)
        : undefined;
    const parameters = defs?.[tool.name] || rawSchema;

    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters,
      },
    };
  });
}

/**
 * AgentMessage → OpenAI 호환 메시지.
 * - assistant tool_calls는 id/type/function(arguments는 JSON 문자열) 형태
 * - toolResult는 role:'tool' + tool_call_id로 상관관계를 유지
 * - 과거 toolResult 축약(pruning) 규칙은 Ollama 매퍼와 동일
 */
export function mapAgentMessagesToOpenAi(
  messages: AgentMessage[],
  options: MapMessageOptions = {},
): OpenAiChatRequest['messages'] {
  const {
    stripThinking = true,
    prunePastToolResults = true,
    pastToolResultMaxChars = 3000,
    keepRecentToolCount = 3,
  } = options;

  const toolResultIndices: number[] = [];
  messages.forEach((msg, idx) => {
    if (msg.role === 'toolResult') {
      toolResultIndices.push(idx);
    }
  });

  const pruneCutoffIndex =
    toolResultIndices.length > keepRecentToolCount
      ? toolResultIndices[toolResultIndices.length - keepRecentToolCount]
      : -1;

  return messages.map((msg, index) => {
    switch (msg.role) {
      case 'system':
        return { role: 'system', content: msg.content };
      case 'user': {
        if (msg.images && msg.images.length > 0) {
          return {
            role: 'user',
            content: [
              ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
              ...msg.images.map((url) => ({
                type: 'image_url' as const,
                image_url: { url },
              })),
            ],
          };
        }
        return { role: 'user', content: msg.content };
      }
      case 'assistant': {
        let content = msg.content ?? '';
        if (stripThinking) {
          const cleaned = cleanThinkingText(content);
          content = cleaned || (msg.toolCalls && msg.toolCalls.length > 0 ? '' : (msg.content ?? ''));
        }
        const tool_calls =
          msg.toolCalls && msg.toolCalls.length > 0
            ? msg.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(
                    typeof tc.arguments === 'object' && tc.arguments !== null
                      ? tc.arguments
                      : {},
                  ),
                },
              }))
            : undefined;
        return { role: 'assistant', content, tool_calls };
      }
      case 'toolResult': {
        let content = msg.content;
        if (
          prunePastToolResults &&
          pruneCutoffIndex >= 0 &&
          index < pruneCutoffIndex &&
          content &&
          content.length > pastToolResultMaxChars
        ) {
          const truncated = content.slice(0, pastToolResultMaxChars);
          content = `${truncated}\n\n... [과거 단계 도구 결과 (${msg.content.length}자) - 최신 문맥 공간 확보를 위해 이전 내용 축약됨]`;
        }
        return { role: 'tool', content, tool_call_id: msg.toolCallId };
      }
      default: {
        const exhaustCheck: never = msg;
        throw new Error(`Unhandled message role in mapping: ${JSON.stringify(exhaustCheck)}`);
      }
    }
  });
}
