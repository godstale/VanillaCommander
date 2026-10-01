import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import type { AgentTool, AgentToolResult } from '@/lib/agent/types';

const WikiActionSchema = z.enum(['ingest', 'query', 'list', 'delete']);

const RawWikiParametersSchema = z.object({
  action: WikiActionSchema.describe(
    "Wiki operation: 'ingest' saves new knowledge, 'query' searches it, 'list' shows saved pages, 'delete' removes a page",
  ),
  slug: z
    .string()
    .optional()
    .describe("Page id in kebab-case (e.g. 'ollama-setup'). Required for 'delete'. Optional for 'ingest' (auto-generated from title)."),
  title: z
    .string()
    .optional()
    .describe("Page title. Required for 'ingest'."),
  content: z
    .string()
    .optional()
    .describe("Markdown body to save. Required for 'ingest'."),
  query: z
    .string()
    .optional()
    .describe("Search keywords. Required for 'query'."),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum results for query/list (default 20)'),
});

// 로컬 LLM이 action/slug/content를 다른 이름으로 보내는 경우를 흡수한다.
const WikiParametersSchema = z.preprocess((val) => {
  if (typeof val !== 'object' || val === null) return val;
  const v = val as Record<string, unknown>;
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (v[k] !== undefined) return v[k];
    }
    return undefined;
  };
  const str = (u: unknown): string | undefined =>
    typeof u === 'string' ? u : u !== undefined && u !== null ? String(u) : undefined;
  const num = (u: unknown): number | undefined => {
    if (typeof u === 'number' && Number.isFinite(u)) return Math.floor(u);
    if (typeof u === 'string' && u.trim() !== '') {
      const n = Number(u);
      if (Number.isFinite(n)) return Math.floor(n);
    }
    return undefined;
  };
  return {
    ...v,
    action: pick('action', 'op', 'operation', 'command'),
    slug: str(pick('slug', 'page', 'source', 'id', 'name')),
    title: str(pick('title', 'heading')),
    content: str(pick('content', 'body', 'text', 'markdown')),
    query: str(pick('query', 'question', 'q', 'pattern', 'keyword', 'keywords')),
    maxResults: num(pick('maxResults', 'max_results', 'limit', 'topK', 'top_k')),
  };
}, RawWikiParametersSchema);

export type WikiParams = z.infer<typeof WikiParametersSchema>;

const SOURCES_DIR = 'wiki/sources';
const INDEX_PATH = 'wiki/index.md';
const LOG_PATH = 'wiki/log.md';

const SLUG_PATTERN = /^[a-z0-9-]+$/;

export function slugifyWikiTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  if (!slug || !SLUG_PATTERN.test(slug)) {
    return `note-${Date.now().toString(36)}`;
  }
  return slug;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function escapeFrontmatterValue(value: string): string {
  return value.replace(/'/g, "''");
}

function buildSourceFile(title: string, body: string): string {
  return `---\ntitle: '${escapeFrontmatterValue(title)}'\ntype: source\ntags: []\nsources: []\nlast_updated: ${todayString()}\n---\n\n${body.trim()}\n`;
}

interface DirEntryItem {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

interface GrepMatch {
  file_path: string;
  line_number: number;
  line_content: string;
}

function slugFromFileName(name: string): string {
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

async function readOptionalText(
  path: string,
  workspaceRoot: string | undefined,
): Promise<string | null> {
  try {
    return await invoke<string>('read_text_file', { path, workspaceRoot });
  } catch {
    return null;
  }
}

async function appendLog(
  line: string,
  workspaceRoot: string | undefined,
): Promise<void> {
  const existing = await readOptionalText(LOG_PATH, workspaceRoot);
  const base = existing ?? '# Wiki Log\n';
  const next = `${base.endsWith('\n') ? base : `${base}\n`}${line}\n`;
  await invoke('write_text_file', { path: LOG_PATH, contents: next, workspaceRoot });
}

async function upsertIndex(
  slug: string,
  title: string,
  workspaceRoot: string | undefined,
): Promise<void> {
  const existing = await readOptionalText(INDEX_PATH, workspaceRoot);
  const entry = `- [${title}](sources/${slug}.md) — ${todayString()}`;
  if (!existing) {
    await invoke('write_text_file', {
      path: INDEX_PATH,
      contents: `# Wiki Index\n\n${entry}\n`,
      workspaceRoot,
    });
    return;
  }
  if (existing.includes(`sources/${slug}.md`)) return;
  const next = `${existing.endsWith('\n') ? existing : `${existing}\n`}${entry}\n`;
  await invoke('write_text_file', { path: INDEX_PATH, contents: next, workspaceRoot });
}

async function removeFromIndex(
  slug: string,
  workspaceRoot: string | undefined,
): Promise<void> {
  const existing = await readOptionalText(INDEX_PATH, workspaceRoot);
  if (!existing || !existing.includes(`sources/${slug}.md`)) return;
  const next = existing
    .split('\n')
    .filter((line) => !line.includes(`sources/${slug}.md`))
    .join('\n');
  await invoke('write_text_file', { path: INDEX_PATH, contents: next, workspaceRoot });
}

async function handleIngest(
  params: WikiParams,
  workspaceRoot: string | undefined,
): Promise<AgentToolResult> {
  const title = params.title?.trim();
  const body = params.content?.trim();
  if (!title) throw new Error("wiki ingest requires 'title'.");
  if (!body) throw new Error("wiki ingest requires 'content'.");
  const rawSlug = params.slug?.trim();
  const slug = rawSlug ? slugifyWikiTitle(rawSlug) : slugifyWikiTitle(title);
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid wiki slug '${rawSlug}'. Use kebab-case (a-z, 0-9, hyphen).`);
  }
  const filePath = `${SOURCES_DIR}/${slug}.md`;
  await invoke('write_text_file', {
    path: filePath,
    contents: buildSourceFile(title, body),
    workspaceRoot,
  });
  // 카탈로그/로그는 부가 기록이므로 실패해도 등록 자체는 성공으로 본다.
  try {
    await upsertIndex(slug, title, workspaceRoot);
  } catch {
    // ignore index bookkeeping failure
  }
  try {
    await appendLog(`- ${todayString()}: ingested ${slug} (${title})`, workspaceRoot);
  } catch {
    // ignore log bookkeeping failure
  }
  return {
    content: `Saved wiki page '${slug}' to ${filePath}. Use action 'query' to search it later.`,
    details: { action: 'ingest', slug, title, path: filePath, workspaceRoot },
  };
}

async function handleQuery(
  params: WikiParams,
  workspaceRoot: string | undefined,
): Promise<AgentToolResult> {
  const q = params.query?.trim();
  if (!q) throw new Error("wiki query requires 'query'.");
  const maxResults = params.maxResults ?? 20;
  let matches: GrepMatch[];
  try {
    matches = await invoke<GrepMatch[]>('grep_files', {
      pattern: escapeRegExp(q),
      path: 'wiki',
      glob: '*.md',
      maxResults,
      workspaceRoot,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Not a directory') || msg.includes('error')) {
      return {
        content: 'Wiki is empty. Use action \'ingest\' with title and content to save the first page.',
        details: { action: 'query', query: q, matches: [] },
      };
    }
    throw err;
  }
  if (matches.length === 0) {
    return {
      content: `No wiki pages matched '${q}'. Try simpler keywords or action 'list' to browse saved pages.`,
      details: { action: 'query', query: q, matches: [] },
    };
  }
  const lines = matches.map((m) => {
    const fileName = m.file_path.split(/[\\/]/).pop() ?? m.file_path;
    return `[${slugFromFileName(fileName)}] ${m.file_path}:${m.line_number}: ${m.line_content}`;
  });
  return {
    content: `${lines.join('\n')}\n\n[Tip: read the full page with the 'read' tool using its file path.]`,
    details: { action: 'query', query: q, totalMatches: matches.length, matches },
  };
}

async function handleList(
  params: WikiParams,
  workspaceRoot: string | undefined,
): Promise<AgentToolResult> {
  const maxResults = params.maxResults ?? 20;
  let entries: DirEntryItem[];
  try {
    entries = await invoke<DirEntryItem[]>('list_dir', {
      path: SOURCES_DIR,
      workspaceRoot,
    });
  } catch {
    return {
      content: 'Wiki is empty. Use action \'ingest\' with title and content to save the first page.',
      details: { action: 'list', count: 0, pages: [] },
    };
  }
  const pages = entries
    .filter((e) => !e.is_dir && e.name.endsWith('.md'))
    .map((e) => ({ slug: slugFromFileName(e.name), path: e.path, size: e.size }));
  if (pages.length === 0) {
    return {
      content: 'Wiki is empty. Use action \'ingest\' with title and content to save the first page.',
      details: { action: 'list', count: 0, pages: [] },
    };
  }
  const shown = pages.slice(0, maxResults);
  const lines = shown.map((p) => `- ${p.slug} (${p.size} B)`);
  const suffix = pages.length > shown.length ? `\n... and ${pages.length - shown.length} more` : '';
  return {
    content: `Wiki pages (${pages.length}):\n${lines.join('\n')}${suffix}`,
    details: { action: 'list', count: pages.length, pages: shown },
  };
}

async function handleDelete(
  params: WikiParams,
  workspaceRoot: string | undefined,
): Promise<AgentToolResult> {
  const rawSlug = params.slug?.trim();
  if (!rawSlug) throw new Error("wiki delete requires 'slug'.");
  const slug = slugifyWikiTitle(rawSlug);
  const filePath = `${SOURCES_DIR}/${slug}.md`;
  await invoke('delete_path', { path: filePath, workspaceRoot });
  try {
    await removeFromIndex(slug, workspaceRoot);
  } catch {
    // ignore index bookkeeping failure
  }
  try {
    await appendLog(`- ${todayString()}: deleted ${slug}`, workspaceRoot);
  } catch {
    // ignore log bookkeeping failure
  }
  return {
    content: `Deleted wiki page '${slug}'.`,
    details: { action: 'delete', slug, path: filePath, workspaceRoot },
  };
}

export function createWikiTool(
  ctx: { workspaceRoot?: string } = {},
): AgentTool<typeof WikiParametersSchema> {
  return {
    name: 'wiki',
    label: 'Wiki Knowledge Base',
    description:
      'Personal knowledge base in workspace wiki/. ingest saves {title, content} to wiki/sources/<slug>.md; query searches saved pages; list shows saved slugs; delete removes a page by slug. Full page text can be read with the read tool.',
    parameters: WikiParametersSchema,
    risk: 'low',
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: z.infer<typeof WikiParametersSchema>,
    ): Promise<AgentToolResult> {
      if (!ctx.workspaceRoot) {
        throw new Error('wiki tool needs an open project folder (workspaceRoot).');
      }
      switch (params.action) {
        case 'ingest':
          return handleIngest(params, ctx.workspaceRoot);
        case 'query':
          return handleQuery(params, ctx.workspaceRoot);
        case 'list':
          return handleList(params, ctx.workspaceRoot);
        case 'delete':
          return handleDelete(params, ctx.workspaceRoot);
      }
    },
  };
}

export const wikiTool = createWikiTool();
