import { invoke } from '@tauri-apps/api/core';
import type { SkillManifest } from '@/lib/types/skill';
import { parseFrontmatter } from '@/lib/skills/frontmatter';

export type ReadFileFn = (path: string) => Promise<string>;

const defaultReadFile: ReadFileFn = async (path: string) => {
  return invoke<string>('read_text_file', { path });
};

export interface ParsedSkillCommand {
  skillName: string;
  args?: string;
}

/**
 * Parses `/skill:<name> [args]` syntax.
 * Returns { skillName, args } or null if not a /skill command.
 */
export function parseSkillCommand(text: string): ParsedSkillCommand | null {
  const match = text.trim().match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return {
    skillName: match[1],
    args: match[2]?.trim() || undefined,
  };
}

/**
 * Formats skill markdown body and optional user arguments into the prompt injected as a user message.
 */
export function formatSkillPrompt(body: string, args?: string): string {
  const cleanBody = body.trim();
  const cleanArgs = args?.trim();
  if (!cleanArgs) {
    return cleanBody;
  }
  return `${cleanBody}\n\nUser: ${cleanArgs}`;
}

/**
 * Resolves a skill command and returns the user message content to send.
 * If text is not a /skill command, returns null.
 * If the skill is not found, throws an Error.
 */
export async function resolveSkillInvocation(
  text: string,
  skills: SkillManifest[],
  readFileFn: ReadFileFn = defaultReadFile,
): Promise<string | null> {
  const parsed = parseSkillCommand(text);
  if (!parsed) return null;

  const target = skills.find(
    (s) => s.name.toLowerCase() === parsed.skillName.toLowerCase(),
  );
  if (!target) {
    throw new Error(`스킬 "${parsed.skillName}"을(를) 찾을 수 없습니다.`);
  }

  const rawContent = await readFileFn(target.filePath);
  const { body } = parseFrontmatter(rawContent);
  return formatSkillPrompt(body, parsed.args);
}
