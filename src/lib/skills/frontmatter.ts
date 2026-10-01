export interface FrontmatterResult {
  frontmatter: Record<string, string | boolean>;
  body: string;
  error?: string;
}

export function parseFrontmatter(text: string): FrontmatterResult {
  // 1. Strip UTF-8 BOM if present
  let cleanText = text;
  if (cleanText.charCodeAt(0) === 0xfeff) {
    cleanText = cleanText.slice(1);
  }

  // 2. Check for opening delimiter ---
  const match = cleanText.match(/^---\r?\n/);
  if (!match) {
    return {
      frontmatter: {},
      body: cleanText,
    };
  }

  const startIdx = match[0].length;
  // 3. Find closing delimiter \n---(\n or end)
  const rest = cleanText.slice(startIdx);
  const endMatch = rest.match(/\r?\n---\r?\n|\r?\n---$/);

  if (!endMatch || endMatch.index === undefined) {
    return {
      frontmatter: {},
      body: cleanText,
      error: 'Unclosed frontmatter delimiter: missing closing ---',
    };
  }

  const yamlBlock = rest.slice(0, endMatch.index);
  const body = rest.slice(endMatch.index + endMatch[0].length);

  const frontmatter: Record<string, string | boolean> = {};
  const lines = yamlBlock.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    let valueStr = trimmed.slice(colonIdx + 1).trim();

    if (valueStr === 'true') {
      frontmatter[key] = true;
    } else if (valueStr === 'false') {
      frontmatter[key] = false;
    } else {
      // Strip quotes if present
      if (
        (valueStr.startsWith('"') && valueStr.endsWith('"')) ||
        (valueStr.startsWith("'") && valueStr.endsWith("'"))
      ) {
        valueStr = valueStr.slice(1, -1);
      }
      frontmatter[key] = valueStr;
    }
  }

  return {
    frontmatter,
    body,
  };
}
