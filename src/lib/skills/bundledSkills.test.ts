import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = new Map<string, string>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: { path: string; contents?: string }) => {
    if (cmd === 'read_text_file') {
      if (!files.has(args.path)) throw new Error('not found');
      return files.get(args.path);
    }
    if (cmd === 'write_text_file') {
      files.set(args.path, args.contents ?? '');
      return undefined;
    }
    throw new Error(`unexpected ${cmd}`);
  }),
}));

import { BUNDLED_SKILLS, installBundledSkills } from './bundledSkills';

const SKILL_PATH = '.agents/skills/basic-llm-wiki/SKILL.md';

describe('bundledSkills', () => {
  beforeEach(() => files.clear());

  it('bundles basic-llm-wiki with valid frontmatter', () => {
    const skill = BUNDLED_SKILLS.find((s) => s.name === 'basic-llm-wiki');
    expect(skill?.files['SKILL.md']).toMatch(/^---\s*\nname: basic-llm-wiki\n/);
  });

  it('copies an enabled bundled skill into the workspace', async () => {
    const installed = await installBundledSkills('/ws', ['basic-llm-wiki', 'other']);
    expect(installed).toEqual(['basic-llm-wiki']);
    expect(files.get(SKILL_PATH)).toContain('# Basic LLM Wiki');
  });

  it('does not overwrite an existing workspace copy', async () => {
    files.set(SKILL_PATH, 'user edited');
    const installed = await installBundledSkills('/ws', ['basic-llm-wiki']);
    expect(installed).toEqual([]);
    expect(files.get(SKILL_PATH)).toBe('user edited');
  });
});
