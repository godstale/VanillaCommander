import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { buildSystemPromptSections, formatSystemPrompt } from '@/lib/prompt/buildSystemPrompt';
import { diffSections } from '@/lib/prompt/diffSections';
import type { AgentTool } from '@/lib/agent/types';

describe('buildSystemPromptSections and diffSections', () => {
  const dummyTool: AgentTool = {
    name: 'test_tool',
    label: 'Test Tool',
    description: 'A test tool description',
    parameters: z.object({}),
    risk: 'low',
    execute: async () => ({ content: 'done' }),
  };

  it('preserves section order and formats tags correctly', () => {
    const sections = buildSystemPromptSections({
      agent: {
        systemPrompt: 'Core preamble instructions.',
        rules: 'Rule 1: Always be helpful.',
        addendum: 'Extra instructions.',
      },
      tools: [dummyTool],
      contextFiles: [
        { path: 'AGENTS.md', content: 'Agent workspace documentation' },
      ],
      skills: [
        { name: 'pdf-parser', description: 'Parses PDF documents', filePath: '/skills/pdf/SKILL.md' },
      ],
      visualization: 'Use mermaid for diagrams.',
      cwd: '/workspace/project',
    });

    const keys = Object.keys(sections);
    const expectedOrder = [
      'preamble',
      'tools',
      'rules',
      'addendum',
      'project_context',
      'skills',
      'visualization',
      'cwd',
    ];

    expect(keys).toEqual(expectedOrder);

    // Verify preamble is NOT wrapped in tags
    expect(sections['preamble']).toBe('Core preamble instructions.');
    expect(sections['preamble']).not.toContain('<preamble>');

    // Verify other sections are wrapped in XML tags
    expect(sections['tools']).toContain('<tools>');
    expect(sections['tools']).toContain('</tools>');
    expect(sections['tools']).toContain('- test_tool: A test tool description');

    expect(sections['rules']).toContain('<rules>');
    expect(sections['rules']).toContain('</rules>');

    expect(sections['project_context']).toContain('<project_context>');
    expect(sections['project_context']).toContain('AGENTS.md');

    expect(sections['skills']).toContain('<skills>');
    expect(sections['skills']).toContain('pdf-parser');

    expect(sections['visualization']).toContain('<visualization>');
    expect(sections['cwd']).toContain('<cwd>');
    expect(sections['cwd']).toContain('/workspace/project');

    // Check formatSystemPrompt
    const fullText = formatSystemPrompt(sections);
    expect(fullText).toContain('Core preamble instructions.');
    expect(fullText).toContain('<tools>');
    expect(fullText).toContain('</cwd>');
  });

  it('filters out disabled skills', () => {
    const sections = buildSystemPromptSections({
      agent: { systemPrompt: 'Test' },
      skills: [
        { name: 'enabled-skill', description: 'Visible' },
        { name: 'hidden-skill', description: 'Hidden', disableModelInvocation: true },
      ],
    });

    expect(sections['skills']).toContain('enabled-skill');
    expect(sections['skills']).not.toContain('hidden-skill');
  });

  it('handles diffSections correctly for addition, modification, and deletion', () => {
    const prev: Record<string, string> = {
      preamble: 'Original preamble',
      rules: '<rules>Original rules</rules>',
      skills: '<skills>Skill A</skills>',
    };

    const current: Record<string, string> = {
      preamble: 'Original preamble', // Unchanged
      rules: '<rules>Updated rules</rules>', // Modified
      cwd: '<cwd>/new/path</cwd>', // Added
      // skills was deleted
    };

    const diff = diffSections(prev, current);

    // Unchanged should not appear
    expect(diff['preamble']).toBeUndefined();

    // Modified should show new value
    expect(diff['rules']).toBe('<rules>Updated rules</rules>');

    // Added should show new value
    expect(diff['cwd']).toBe('<cwd>/new/path</cwd>');

    // Deleted should show null
    expect(diff['skills']).toBeNull();
  });
});
