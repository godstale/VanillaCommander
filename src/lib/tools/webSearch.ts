import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';

interface SearchResultItem {
  title: string;
  link: string;
  snippet: string;
}

const WebSearchParametersSchema = z.object({
  query: z.string().describe('Search query terms'),
});

export const webSearchTool: AgentTool<typeof WebSearchParametersSchema> = {
  name: 'web_search',
  label: 'Web Search',
  description:
    'Searches the web for up-to-date documentation, error solutions, or information.',
  parameters: WebSearchParametersSchema,
  risk: 'low',
  executionMode: 'parallel',
  async execute(
    _toolCallId: string,
    params: z.infer<typeof WebSearchParametersSchema>,
  ): Promise<AgentToolResult> {
    try {
      const results = await invoke<SearchResultItem[]>('web_search', {
        query: params.query,
      });

      if (!results || results.length === 0) {
        return {
          content: '검색 결과가 없습니다. 검색 키워드를 더 단순하거나 다른 단어로 변경하여 다시 검색을 시도하세요.',
          details: { query: params.query, results: [] },
        };
      }

      const formatted = results
        .map(
          (r, idx) =>
            `${idx + 1}. [${r.title}](${r.link})\n   ${r.snippet}`,
        )
        .join('\n\n');

      const content = `${formatted}\n\n[안내: 위 스니펫에 구체적인 세부 정보가 부족하다면 관련 링크 URL을 'web_fetch' 도구로 조회하여 본문 전체를 확인하거나, 다른 검색어로 추가 검색을 수행하세요.]`;

      return {
        content,
        details: {
          query: params.query,
          total: results.length,
          results,
        },
      };
    } catch {
      return {
        content: '검색 중 오류가 발생했습니다. 검색어를 다르게 하여 다시 시도하세요.',
        details: { query: params.query, results: [] },
      };
    }
  },
};
