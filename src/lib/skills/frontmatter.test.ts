import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from './frontmatter';

describe('parseFrontmatter', () => {
  it('(1) handles text without frontmatter', () => {
    const raw = '# Title\nJust markdown content here.';
    const result = parseFrontmatter(raw);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(raw);
    expect(result.error).toBeUndefined();
  });

  it('(2) parses normal frontmatter with string values and stripped quotes', () => {
    const raw = `---
name: my-skill
description: "A great skill for tasks"
category: 'utilities'
---
# Main Content
Here is the body.`;

    const result = parseFrontmatter(raw);
    expect(result.error).toBeUndefined();
    expect(result.frontmatter).toEqual({
      name: 'my-skill',
      description: 'A great skill for tasks',
      category: 'utilities',
    });
    expect(result.body.trim()).toBe('# Main Content\nHere is the body.');
  });

  it('(3) handles broken/unclosed delimiter gracefully without throwing', () => {
    const raw = `---
name: unclosed
description: no closing dashes
Here is where content starts`;

    const result = parseFrontmatter(raw);
    expect(result.error).toBeDefined();
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(raw);
  });

  it('(4) removes UTF-8 BOM if present at the beginning', () => {
    const raw = `\uFEFF---
name: bom-skill
description: tested with BOM
---
Body text`;

    const result = parseFrontmatter(raw);
    expect(result.error).toBeUndefined();
    expect(result.frontmatter).toEqual({
      name: 'bom-skill',
      description: 'tested with BOM',
    });
    expect(result.body.trim()).toBe('Body text');
  });

  it('(5) parses boolean values true and false', () => {
    const raw = `---
disable-model-invocation: true
is-active: false
label: "true-value"
---
Markdown content`;

    const result = parseFrontmatter(raw);
    expect(result.error).toBeUndefined();
    expect(result.frontmatter).toEqual({
      'disable-model-invocation': true,
      'is-active': false,
      label: 'true-value',
    });
  });
});
