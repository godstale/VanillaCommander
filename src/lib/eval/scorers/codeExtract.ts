export type CodeLanguage = 'js' | 'python';

export interface ExtractedCode {
  code: string | null;
  reason: string;
}

const LANGUAGE_TAGS: Record<CodeLanguage, string[]> = {
  js: ['js', 'javascript'],
  python: ['python', 'py'],
};

interface FencedBlock {
  tag: string;
  body: string;
}

const FENCE_RE = /```([A-Za-z0-9_+-]*)\s*\n([\s\S]*?)```/g;

function listFencedBlocks(response: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(response)) !== null) {
    blocks.push({ tag: match[1].trim().toLowerCase(), body: match[2] });
  }
  return blocks;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function definesEntryPoint(code: string, language: CodeLanguage, entryPoint: string): boolean {
  const id = escapeRegExp(entryPoint);
  if (language === 'python') {
    return new RegExp(`(^|\\n)\\s*(?:def|class)\\s+${id}\\b|^\\s*${id}\\s*=`, 'm').test(code);
  }
  return new RegExp(
    `function\\s+${id}\\b|(?:const|let|var)\\s+${id}\\b|class\\s+${id}\\b|^\\s*${id}\\s*=`,
    'm',
  ).test(code);
}

export function extractCode(
  response: string,
  language: CodeLanguage,
  entryPoint?: string,
): ExtractedCode {
  const blocks = listFencedBlocks(response);
  let code: string;
  let reason: string;
  const tags = LANGUAGE_TAGS[language];
  const matching = blocks.filter((b) => tags.includes(b.tag));
  if (matching.length > 0) {
    code = matching[matching.length - 1].body.trim();
    reason = `last fenced ${language} block`;
  } else if (blocks.length > 0) {
    code = blocks[0].body.trim();
    reason = 'first fenced block (no language tag match)';
  } else if (response.trim().length > 0) {
    code = response.trim();
    reason = 'whole response (no fenced block)';
  } else {
    return { code: null, reason: 'empty response' };
  }
  if (code.length === 0) {
    return { code: null, reason: 'empty code block' };
  }
  if (entryPoint && !definesEntryPoint(code, language, entryPoint)) {
    return { code: null, reason: `missing entry point '${entryPoint}'` };
  }
  return { code, reason };
}
