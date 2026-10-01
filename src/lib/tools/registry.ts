import type { AgentTool } from '@/lib/agent/types';
import type { BuiltinToolId } from '@/lib/types/agent';
import { registerHooks } from '@/lib/agent/hookRegistry';
import { truncateOutput } from './truncate';
import { createReadTool, readTool } from './read';
import { createLsTool, lsTool } from './ls';
import { createGrepTool, grepTool } from './grep';
import { createFindTool, findTool } from './find';
import { createWriteTool, writeTool } from './write';
import { createEditTool, editTool } from './edit';
import { createShellTool, shellTool } from './shell';
import { createWikiTool, wikiTool } from './wiki';
import { webSearchTool } from './webSearch';
import { webFetchTool } from './webFetch';

export interface ToolContext {
  workspaceRoot?: string;
}

export const DEFAULT_ACTIVE_TOOLS: BuiltinToolId[] = [
  'read',
  'ls',
  'grep',
  'find',
  'write',
  'edit',
];

const toolRegistry = new Map<string, (ctx: ToolContext) => AgentTool>();

export function registerToolFactory(
  id: BuiltinToolId,
  factory: (ctx: ToolContext) => AgentTool,
): void {
  toolRegistry.set(id, factory);
}

// Register all 10 built-in tools (wiki stays registered for backward
// compatibility with stored agents, but is hidden from the editor UI.
// Use the basic-llm-wiki skill instead.)
registerToolFactory('read', (ctx) => createReadTool(ctx));
registerToolFactory('ls', (ctx) => createLsTool(ctx));
registerToolFactory('grep', (ctx) => createGrepTool(ctx));
registerToolFactory('find', (ctx) => createFindTool(ctx));
registerToolFactory('write', (ctx) => createWriteTool(ctx));
registerToolFactory('edit', (ctx) => createEditTool(ctx));
registerToolFactory('shell', (ctx) => createShellTool(ctx));
registerToolFactory('wiki', (ctx) => createWikiTool(ctx));
registerToolFactory('web_search', () => webSearchTool);
registerToolFactory('web_fetch', () => webFetchTool);

export function getBuiltinTools(
  ids: BuiltinToolId[],
  ctx: ToolContext = {},
): AgentTool[] {
  const tools: AgentTool[] = [];
  for (const id of ids) {
    const factory = toolRegistry.get(id);
    if (factory) {
      tools.push(factory(ctx));
    }
  }
  return tools;
}

// Register default afterToolCall truncation hook
registerHooks('builtin:truncate', {
  async afterToolCall(ctx) {
    if (!ctx.result.content) return undefined;
    const res = truncateOutput(ctx.result.content);
    if (res.truncated) {
      return {
        content: res.content,
      };
    }
    return undefined;
  },
});

export { readTool, lsTool, grepTool, findTool, writeTool, editTool, shellTool, wikiTool, webSearchTool };
