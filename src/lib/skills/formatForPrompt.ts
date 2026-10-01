export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface PromptSkillItem {
  name: string;
  description: string;
  filePath?: string;
  disableModelInvocation?: boolean;
}

function cleanLocationPath(pathStr: string): string {
  return pathStr
    .replace(/\\/g, '/')
    .replace(/^([/]{2}\?[/]|[/]{2}\.[^/]*[/]|[/]{2})/, '')
    .replace(/\/+$/, '');
}

/**
 * Formats skills list into <available_skills> XML section according to Architecture §6.2.
 * Excludes skills with disableModelInvocation: true.
 * Returns empty string if no skills are available.
 */
export function formatSkillsForPrompt(skills: PromptSkillItem[]): string {
  const activeSkills = skills.filter((s) => !s.disableModelInvocation);

  if (activeSkills.length === 0) {
    return '';
  }

  const skillBlocks = activeSkills
    .map((s) => {
      const name = escapeXml(s.name);
      const desc = escapeXml(s.description);
      const loc = escapeXml(s.filePath ? cleanLocationPath(s.filePath) : '');

      return `  <skill>\n    <name>${name}</name>\n    <description>${desc}</description>\n    <location>${loc}</location>\n  </skill>`;
    })
    .join('\n');

  return `The following skills provide specialized instructions and workflows for specific tasks:
- Skills are NOT built-in tools. Do NOT attempt to invoke skill names or slash commands (e.g. /wiki-ingest) directly as tools.
- When a task or user request matches a skill's description, triggers, or domain, you MUST immediately use the \`read\` tool to load and read the full skill instructions from its <location> path (SKILL.md).
- The file path in <location> is already verified and guaranteed to exist. Do NOT use the \`ls\` tool to check if the skill directory exists; directly call \`read\` on the <location> path.
- CRITICAL: Never stop at internal thinking or output a message saying "I will now read SKILL.md". You MUST immediately emit the \`read\` tool call in the same turn.
- NEVER guess procedures, file formats, or output directory structures (e.g. do not invent paths like .agents/wiki/); strictly adhere to the project layout and rules specified inside the skill file.
- IMPORTANT: Project workspace files vs Skill internal resources:
  1) All project data and target directories described in a skill (such as 'wiki/', 'src/', 'docs/', 'wiki/index.md', etc.) are located in the PROJECT ROOT (<cwd>), NOT inside the skill directory.
  2) NEVER search for or create project directories (e.g., 'wiki/') under '.agents/skills/...'. Always access them directly from the project root (<cwd>, e.g., 'wiki', 'wiki/index.md', or './wiki').
  3) Only the skill's own internal helper scripts (e.g. 'scripts/...') or reference docs (e.g. 'references/...') should be resolved relative to the skill's <location> directory.

<available_skills>
${skillBlocks}
</available_skills>`;
}
