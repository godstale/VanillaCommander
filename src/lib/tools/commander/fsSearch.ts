import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';
import { awaitJobCompletion, strArg } from './common';

const RawParams = z.object({
  root: z.string().min(1).describe('Directory to search under'),
  namePattern: z.string().optional().describe('File name glob (e.g. "*.pdf")'),
  contentQuery: z.string().optional().describe('Regex searched inside text files'),
  maxResults: z.number().int().min(1).max(500).optional().describe('Max matches (default 50)'),
});

const Params = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null) return val;
  const v = val as Record<string, unknown>;
  const num = (u: unknown): number | undefined => {
    if (typeof u === 'number' && Number.isFinite(u)) return Math.floor(u);
    if (typeof u === 'string' && u.trim() !== '') {
      const n = Number(u);
      if (Number.isFinite(n)) return Math.floor(n);
    }
    return undefined;
  };
  return {
    root: strArg(v, 'root', 'dir', 'path', 'directory'),
    namePattern: strArg(v, 'namePattern', 'name_pattern', 'pattern', 'glob', 'name'),
    contentQuery: strArg(v, 'contentQuery', 'content_query', 'content', 'query', 'text'),
    maxResults: num(v.maxResults ?? v.max_results ?? v.limit) ?? 50,
  };
}, RawParams);

export function createFsSearchTool(): AgentTool<typeof Params> {
  return {
    name: 'fs_search',
    label: 'Search files',
    description:
      'Search file names (glob) and optionally file contents (regex) under root. Respects .gitignore. Use when ls/find/grep scope is unclear or a broad sweep is needed.',
    parameters: Params,
    risk: 'low',
    executionMode: 'parallel',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof Params>,
    ): Promise<AgentToolResult> {
      const jobId = await invoke<string>('fc_search', {
        root: params.root,
        namePattern: params.namePattern ?? null,
        contentQuery: params.contentQuery ?? null,
        maxResults: params.maxResults ?? 50,
        useGitignore: true,
      });
      const done = await awaitJobCompletion(jobId);
      if (!done.ok) {
        throw new Error(done.error ?? 'fs_search failed');
      }
      const matches = done.matches ?? [];
      if (matches.length === 0) {
        return {
          content: 'No matches.',
          details: { root: params.root, count: 0, matches: [] },
        };
      }
      const lines = matches.map((m) =>
        m.line_number !== null && m.line_number !== undefined
          ? `${m.path}:${m.line_number}: ${m.line_content ?? ''}`
          : m.path,
      );
      return {
        content: `${matches.length} match(es):\n${lines.join('\n')}`,
        details: { root: params.root, count: matches.length, matches },
      };
    },
  };
}

export const fsSearchTool = createFsSearchTool();
