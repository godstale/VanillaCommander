import { invoke } from '@tauri-apps/api/core';
import type { SkillManifest, SkillDiagnostic, SkillSource } from '@/lib/types/skill';
import { parseFrontmatter } from './frontmatter';

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface SkillScannerFs {
  readDir: (dir: string) => Promise<DirEntry[]>;
  readFile: (path: string) => Promise<string>;
}

const defaultFs: SkillScannerFs = {
  readDir: async (dir: string) => {
    return invoke<DirEntry[]>('list_dir', { path: dir });
  },
  readFile: async (path: string) => {
    return invoke<string>('read_text_file', { path });
  },
};

function normalizePath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^([/]{2}\?[/]|[/]{2}\.[^/]*[/]|[/]{2})/, '')
    .replace(/\/+$/, '');
}

/**
 * Validates skill name according to Agent Skills standard:
 * 1-64 characters, lowercase alphanumeric and single hyphens, no consecutive hyphens, no leading/trailing hyphen.
 */
export function isValidSkillName(name: string): boolean {
  if (!name || name.length > 64) return false;
  if (name.startsWith('-') || name.endsWith('-')) return false;
  if (name.includes('--')) return false;
  return /^[a-z0-9-]+$/.test(name);
}

export interface ScanSkillsOptions {
  workspaceRoot?: string;
  globalDir?: string;
  fs?: SkillScannerFs;
}

export interface ScanSkillsResult {
  skills: SkillManifest[];
  diagnostics: SkillDiagnostic[];
}

export async function scanSkills(
  options: ScanSkillsOptions,
): Promise<ScanSkillsResult> {
  const fs = options.fs ?? defaultFs;
  const skills: SkillManifest[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  const registeredNames = new Map<string, string>(); // name -> first found path

  async function scanDirectory(
    dir: string,
    source: SkillSource,
  ): Promise<void> {
    let entries: DirEntry[];
    try {
      entries = await fs.readDir(dir);
    } catch {
      // Directory may not exist
      return;
    }

    // Check if this directory contains SKILL.md
    const skillFile = entries.find(
      (e) => !e.is_dir && e.name.toLowerCase() === 'skill.md',
    );

    if (skillFile) {
      const normSkillPath = normalizePath(skillFile.path);
      const normBaseDir = normalizePath(dir);

      let content: string;
      try {
        content = await fs.readFile(normSkillPath);
      } catch (err) {
        diagnostics.push({
          level: 'warning',
          message: `Failed to read SKILL.md: ${err instanceof Error ? err.message : String(err)}`,
          path: normSkillPath,
        });
        return;
      }

      const { frontmatter, error } = parseFrontmatter(content);
      if (error) {
        diagnostics.push({
          level: 'warning',
          message: `Frontmatter parse error: ${error}`,
          path: normSkillPath,
        });
      }

      // Determine name (frontmatter name or directory name)
      const dirName = normBaseDir.split('/').pop() || 'unnamed-skill';
      const rawName =
        typeof frontmatter['name'] === 'string'
          ? frontmatter['name'].trim()
          : dirName;

      // Validate name
      if (!isValidSkillName(rawName)) {
        diagnostics.push({
          level: 'warning',
          message: `Skill name '${rawName}' does not strictly adhere to [a-z0-9-] format (1-64 chars, no consecutive/leading/trailing hyphens). Loaded anyway.`,
          path: normSkillPath,
        });
      }

      // Validate description (MANDATORY, max 1024 chars)
      const rawDesc = frontmatter['description'];
      if (typeof rawDesc !== 'string' || !rawDesc.trim()) {
        diagnostics.push({
          level: 'warning',
          message: `Skill in '${normSkillPath}' is missing required 'description' frontmatter. Skipped.`,
          path: normSkillPath,
        });
        // Do not load skill without description
        return;
      }

      const description =
        rawDesc.length > 1024 ? rawDesc.slice(0, 1024) : rawDesc.trim();

      const disableModelInvocation = Boolean(
        frontmatter['disable-model-invocation'] ??
          frontmatter['disableModelInvocation'] ??
          false,
      );

      // Check collision
      if (registeredNames.has(rawName)) {
        diagnostics.push({
          level: 'collision',
          message: `Duplicate skill name '${rawName}' found at '${normSkillPath}'. Keeping previously loaded skill from '${registeredNames.get(rawName)}'.`,
          path: normSkillPath,
        });
        return;
      }

      registeredNames.set(rawName, normSkillPath);
      skills.push({
        name: rawName,
        description,
        filePath: normSkillPath,
        baseDir: normBaseDir,
        source,
        disableModelInvocation,
      });

      // Do NOT descend into subdirectories if SKILL.md is present
      return;
    }

    // No SKILL.md in this directory, recursively scan subdirectories
    for (const entry of entries) {
      if (entry.is_dir) {
        const name = entry.name;
        if (name.startsWith('.') || name === 'node_modules') {
          continue;
        }
        await scanDirectory(normalizePath(entry.path), source);
      }
    }
  }

  // 1. Scan global skills first (so global skills take priority on collision if scanned first)
  if (options.globalDir) {
    await scanDirectory(normalizePath(options.globalDir), 'global');
  }

  // 2. Scan workspace skills (.agents/skills/)
  if (options.workspaceRoot) {
    const workspaceSkillsDir = `${normalizePath(options.workspaceRoot)}/.agents/skills`;
    await scanDirectory(workspaceSkillsDir, 'workspace');
  }

  return { skills, diagnostics };
}
