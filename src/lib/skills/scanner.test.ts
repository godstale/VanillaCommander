import { describe, it, expect } from 'vitest';
import { scanSkills, type SkillScannerFs, type DirEntry } from './scanner';

describe('scanSkills', () => {
  it('covers all 5 cases: normal skill, missing description, name rule violation, nested SKILL.md stop, and name collision', async () => {
    // Virtual directory tree for testing
    const dirMap: Record<string, DirEntry[]> = {
      '/global': [
        { name: 'skill-alpha', path: '/global/skill-alpha', is_dir: true },
      ],
      '/global/skill-alpha': [
        { name: 'SKILL.md', path: '/global/skill-alpha/SKILL.md', is_dir: false },
        { name: 'child', path: '/global/skill-alpha/child', is_dir: true },
      ],
      '/global/skill-alpha/child': [
        { name: 'SKILL.md', path: '/global/skill-alpha/child/SKILL.md', is_dir: false },
      ],
      '/workspace/.agents/skills': [
        { name: 'skill-alpha', path: '/workspace/.agents/skills/skill-alpha', is_dir: true },
        { name: 'bad-name-skill', path: '/workspace/.agents/skills/bad-name-skill', is_dir: true },
        { name: 'no-desc-skill', path: '/workspace/.agents/skills/no-desc-skill', is_dir: true },
        { name: 'normal-skill', path: '/workspace/.agents/skills/normal-skill', is_dir: true },
      ],
      '/workspace/.agents/skills/skill-alpha': [
        { name: 'SKILL.md', path: '/workspace/.agents/skills/skill-alpha/SKILL.md', is_dir: false },
      ],
      '/workspace/.agents/skills/bad-name-skill': [
        { name: 'SKILL.md', path: '/workspace/.agents/skills/bad-name-skill/SKILL.md', is_dir: false },
      ],
      '/workspace/.agents/skills/no-desc-skill': [
        { name: 'SKILL.md', path: '/workspace/.agents/skills/no-desc-skill/SKILL.md', is_dir: false },
      ],
      '/workspace/.agents/skills/normal-skill': [
        { name: 'SKILL.md', path: '/workspace/.agents/skills/normal-skill/SKILL.md', is_dir: false },
      ],
    };

    const fileMap: Record<string, string> = {
      // 1. Global skill-alpha (valid, normal)
      '/global/skill-alpha/SKILL.md': `---
name: skill-alpha
description: "Global Alpha Skill"
---
# Alpha instructions`,

      // 2. Child inside skill-alpha (should NEVER be reached because parent has SKILL.md)
      '/global/skill-alpha/child/SKILL.md': `---
name: child-skill
description: "Should not be discovered"
---`,

      // 3. Duplicate skill-alpha in workspace (Collision!)
      '/workspace/.agents/skills/skill-alpha/SKILL.md': `---
name: skill-alpha
description: "Workspace Alpha Duplicate"
---`,

      // 4. Invalid name format (e.g. UPPERCASE and double hyphens --)
      '/workspace/.agents/skills/bad-name-skill/SKILL.md': `---
name: BAD--NAME
description: "Skill with invalid name format"
---`,

      // 5. Missing description (should NOT be loaded!)
      '/workspace/.agents/skills/no-desc-skill/SKILL.md': `---
name: no-desc
---
Content without description frontmatter`,

      // 6. Normal workspace skill
      '/workspace/.agents/skills/normal-skill/SKILL.md': `---
name: normal-skill
description: "A normal workspace skill"
---`,
    };

    const mockFs: SkillScannerFs = {
      readDir: async (dir: string) => {
        const entries = dirMap[dir];
        if (!entries) throw new Error(`Dir not found: ${dir}`);
        return entries;
      },
      readFile: async (path: string) => {
        const content = fileMap[path];
        if (!content) throw new Error(`File not found: ${path}`);
        return content;
      },
    };

    const { skills, diagnostics } = await scanSkills({
      globalDir: '/global',
      workspaceRoot: '/workspace',
      fs: mockFs,
    });

    const skillNames = skills.map((s) => s.name);

    // Case 1: normal skill loaded
    expect(skillNames).toContain('skill-alpha');
    expect(skillNames).toContain('normal-skill');

    // Case 2: nested child SKILL.md is NOT visited
    expect(skillNames).not.toContain('child-skill');

    // Case 3: collision diagnostic recorded, global one preserved
    const alphaSkill = skills.find((s) => s.name === 'skill-alpha');
    expect(alphaSkill?.source).toBe('global');
    expect(alphaSkill?.description).toBe('Global Alpha Skill');
    expect(diagnostics.some((d) => d.level === 'collision' && d.message.includes('skill-alpha'))).toBe(true);

    // Case 4: invalid name warning recorded, but STILL LOADED
    expect(skillNames).toContain('BAD--NAME');
    expect(diagnostics.some((d) => d.level === 'warning' && d.message.includes('BAD--NAME'))).toBe(true);

    // Case 5: missing description is NOT LOADED, warning recorded
    expect(skillNames).not.toContain('no-desc');
    expect(diagnostics.some((d) => d.level === 'warning' && d.message.includes('missing required \'description\''))).toBe(true);
  });
});
