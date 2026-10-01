import { invoke } from '@tauri-apps/api/core';

export const CANDIDATE_FILENAMES = [
  'AGENTS.override.md',
  'AGENTS.md',
  'AGENTS.MD',
  'CLAUDE.md',
  'CLAUDE.MD',
] as const;

export interface ContextFileItem {
  path: string;
  content: string;
}

export type ReadFileFn = (path: string) => Promise<string>;

const defaultReadFile: ReadFileFn = async (path: string) => {
  return invoke<string>('read_text_file', { path });
};

function normalizePath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^([/]{2}\?[/]|[/]{2}\.[^/]*[/]|[/]{2})/, '')
    .replace(/\/+$/, '');
}

/**
 * Gets ancestor directories ordered from root down to the workspaceRoot.
 * Example: "C:/a/b/c" -> ["C:", "C:/a", "C:/a/b", "C:/a/b/c"]
 */
export function getAncestorDirectories(targetDir: string): string[] {
  const norm = normalizePath(targetDir);
  if (!norm) return [];

  const parts = norm.split('/');
  const dirs: string[] = [];

  let current = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) {
      current = part || '/';
    } else {
      current = current === '/' ? `/${part}` : `${current}/${part}`;
    }
    dirs.push(current);
  }

  return dirs;
}

/**
 * Checks candidate filenames in candidate priority order:
 * AGENTS.override.md -> AGENTS.md -> AGENTS.MD -> CLAUDE.md -> CLAUDE.MD
 * Returns the first existing file's content, or null if none exist.
 */
export async function loadContextFileFromDir(
  dir: string,
  readFileFn: ReadFileFn = defaultReadFile,
): Promise<ContextFileItem | null> {
  const normDir = normalizePath(dir);

  for (const filename of CANDIDATE_FILENAMES) {
    const filePath = `${normDir}/${filename}`;
    try {
      const content = await readFileFn(filePath);
      if (content !== undefined && content !== null) {
        return {
          path: filePath,
          content,
        };
      }
    } catch {
      // File not found or unreadable, continue to next candidate
    }
  }

  return null;
}

export interface LoadProjectContextFilesOptions {
  workspaceRoot: string;
  globalDir?: string;
  readFileFn?: ReadFileFn;
}

/**
 * Collects context files in order:
 * Global dir (if present) -> Filesystem root down to workspace root.
 * Deduplicates by canonical/normalized path.
 */
export async function loadProjectContextFiles(
  options: LoadProjectContextFilesOptions,
): Promise<ContextFileItem[]> {
  const readFileFn = options.readFileFn ?? defaultReadFile;
  const result: ContextFileItem[] = [];
  const seenPaths = new Set<string>();

  // 1. Check global directory first
  if (options.globalDir) {
    const globalContext = await loadContextFileFromDir(options.globalDir, readFileFn);
    if (globalContext) {
      const norm = normalizePath(globalContext.path).toLowerCase();
      if (!seenPaths.has(norm)) {
        seenPaths.add(norm);
        result.push(globalContext);
      }
    }
  }

  // 2. Ancestors from root down to workspaceRoot
  const ancestors = getAncestorDirectories(options.workspaceRoot);
  for (const dir of ancestors) {
    const contextItem = await loadContextFileFromDir(dir, readFileFn);
    if (contextItem) {
      const norm = normalizePath(contextItem.path).toLowerCase();
      if (!seenPaths.has(norm)) {
        seenPaths.add(norm);
        result.push(contextItem);
      }
    }
  }

  return result;
}
