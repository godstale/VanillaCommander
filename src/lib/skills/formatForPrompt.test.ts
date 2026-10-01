import { describe, it, expect } from 'vitest';
import { formatSkillsForPrompt, escapeXml } from './formatForPrompt';
import type { SkillManifest } from '@/lib/types/skill';

describe('formatSkillsForPrompt', () => {
  it('returns empty string when skills array is empty or all disabled', () => {
    expect(formatSkillsForPrompt([])).toBe('');

    const disabledSkills: SkillManifest[] = [
      {
        name: 'hidden',
        description: 'Hidden skill',
        filePath: '/path/SKILL.md',
        baseDir: '/path',
        source: 'workspace',
        disableModelInvocation: true,
      },
    ];
    expect(formatSkillsForPrompt(disabledSkills)).toBe('');
  });

  it('escapes XML special characters in skill fields', () => {
    const raw = `Tom & Jerry <cartoon> says "It's fine"`;
    expect(escapeXml(raw)).toBe(
      'Tom &amp; Jerry &lt;cartoon&gt; says &quot;It&apos;s fine&quot;',
    );
  });

  it('formats active skills into <available_skills> XML and skips disabled ones', () => {
    const skills: SkillManifest[] = [
      {
        name: 'data-analysis',
        description: 'Analyzes A & B with <tables>',
        filePath: '/workspace/skills/data/SKILL.md',
        baseDir: '/workspace/skills/data',
        source: 'workspace',
        disableModelInvocation: false,
      },
      {
        name: 'secret-skill',
        description: 'Manual invocation only',
        filePath: '/workspace/skills/secret/SKILL.md',
        baseDir: '/workspace/skills/secret',
        source: 'global',
        disableModelInvocation: true,
      },
    ];

    const xml = formatSkillsForPrompt(skills);

    expect(xml).toContain('<available_skills>');
    expect(xml).toContain('</available_skills>');
    expect(xml).toContain('<name>data-analysis</name>');
    expect(xml).toContain('<description>Analyzes A &amp; B with &lt;tables&gt;</description>');
    expect(xml).toContain('<location>/workspace/skills/data/SKILL.md</location>');
    expect(xml).toContain('`read` tool');

    // Disabled skill must be omitted
    expect(xml).not.toContain('secret-skill');
  });
});
