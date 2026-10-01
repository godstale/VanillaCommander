import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';

const WebFetchParametersSchema = z.object({
  url: z.string().describe('The URL of the webpage to fetch and read content from'),
});

export const webFetchTool: AgentTool<typeof WebFetchParametersSchema> = {
  name: 'web_fetch',
  label: 'Web Fetch',
  description:
    'Fetches the readable text and markdown content of a specific webpage URL. Use this to read the full content of pages found via web_search when snippets are insufficient.',
  parameters: WebFetchParametersSchema,
  risk: 'low',
  executionMode: 'parallel',
  async execute(
    _toolCallId: string,
    params: z.infer<typeof WebFetchParametersSchema>,
  ): Promise<AgentToolResult> {
    try {
      const content = await invoke<string>('web_fetch', {
        url: params.url,
      });

      if (!content || !content.trim()) {
        return {
          content: '웹페이지에서 본문 내용을 추출하지 못했습니다.',
          details: { url: params.url },
        };
      }

      return {
        content: `--- Webpage Content (${params.url}) ---\n\n${content}`,
        details: {
          url: params.url,
          length: content.length,
        },
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: `웹페이지 접속 실패: ${errMsg}`,
        isError: true,
        details: { url: params.url, error: errMsg },
      };
    }
  },
};
