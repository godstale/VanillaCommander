import { describe, it, expect } from 'vitest';
import {
  parseSkillCommand,
  formatSkillPrompt,
  resolveSkillInvocation,
} from './invokeSkill';
import type { SkillManifest } from '@/lib/types/skill';

describe('invokeSkill', () => {
  describe('parseSkillCommand', () => {
    it('parses /skill:name with no arguments', () => {
      const res = parseSkillCommand('/skill:pdf-tools');
      expect(res).toEqual({
        skillName: 'pdf-tools',
        args: undefined,
      });
    });

    it('parses /skill:name with arguments', () => {
      const res = parseSkillCommand('/skill:pdf-tools extract file.pdf --all');
      expect(res).toEqual({
        skillName: 'pdf-tools',
        args: 'extract file.pdf --all',
      });
    });

    it('handles surrounding whitespace', () => {
      const res = parseSkillCommand('   /skill:formatter   indent=2   ');
      expect(res).toEqual({
        skillName: 'formatter',
        args: 'indent=2',
      });
    });

    it('returns null for regular messages or other slash commands', () => {
      expect(parseSkillCommand('hello world')).toBeNull();
      expect(parseSkillCommand('/help')).toBeNull();
      expect(parseSkillCommand('/skills')).toBeNull();
      expect(parseSkillCommand('')).toBeNull();
    });
  });

  describe('formatSkillPrompt', () => {
    it('returns trimmed body when no args are provided', () => {
      const body = '  # PDF Tool\nInstructions here.  ';
      expect(formatSkillPrompt(body)).toBe('# PDF Tool\nInstructions here.');
      expect(formatSkillPrompt(body, '   ')).toBe('# PDF Tool\nInstructions here.');
    });

    it('appends User: <args> when args are provided', () => {
      const body = '# PDF Tool\nInstructions here.';
      const res = formatSkillPrompt(body, 'extract table from invoice.pdf');
      expect(res).toBe('# PDF Tool\nInstructions here.\n\nUser: extract table from invoice.pdf');
    });
  });

  describe('resolveSkillInvocation', () => {
    const mockSkills: SkillManifest[] = [
      {
        name: 'pdf-tools',
        description: 'Extract text and tables from PDFs',
        filePath: 'C:/proj/.agents/skills/pdf-tools/SKILL.md',
        baseDir: 'C:/proj/.agents/skills/pdf-tools',
        source: 'workspace',
        disableModelInvocation: false,
      },
      {
        name: 'secret-skill',
        description: 'Internal hidden skill',
        filePath: 'C:/proj/.agents/skills/secret/SKILL.md',
        baseDir: 'C:/proj/.agents/skills/secret',
        source: 'global',
        disableModelInvocation: true,
      },
    ];

    const mockFileContents: Record<string, string> = {
      'C:/proj/.agents/skills/pdf-tools/SKILL.md': `---
name: pdf-tools
description: Extract text and tables
---
# PDF Tools Guide
Use the python script in ./scripts/extract.py to extract text.`,
      'C:/proj/.agents/skills/secret/SKILL.md': `---
name: secret-skill
description: Internal hidden skill
disable-model-invocation: true
---
Secret operational instructions.`,
    };

    const mockReadFile = async (path: string) => {
      const content = mockFileContents[path];
      if (content === undefined) {
        throw new Error(`File not found: ${path}`);
      }
      return content;
    };

    it('resolves skill command and injects body with args', async () => {
      const result = await resolveSkillInvocation(
        '/skill:pdf-tools doc.pdf',
        mockSkills,
        mockReadFile,
      );

      expect(result).toBe(
        '# PDF Tools Guide\nUse the python script in ./scripts/extract.py to extract text.\n\nUser: doc.pdf',
      );
    });

    it('can resolve skills with disableModelInvocation: true', async () => {
      const result = await resolveSkillInvocation(
        '/skill:secret-skill',
        mockSkills,
        mockReadFile,
      );

      expect(result).toBe('Secret operational instructions.');
    });

    it('is case-insensitive for skill name matching', async () => {
      const result = await resolveSkillInvocation(
        '/skill:PDF-TOOLS',
        mockSkills,
        mockReadFile,
      );

      expect(result).toContain('# PDF Tools Guide');
    });

    it('returns null if text is not a /skill command', async () => {
      const result = await resolveSkillInvocation('just chatting', mockSkills, mockReadFile);
      expect(result).toBeNull();
    });

    it('throws an error if skill is not found', async () => {
      await expect(
        resolveSkillInvocation('/skill:non-existent', mockSkills, mockReadFile),
      ).rejects.toThrow('스킬 "non-existent"을(를) 찾을 수 없습니다.');
    });
  });
});
