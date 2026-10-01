import { describe, it, expect } from 'vitest';
import { parseVisualBlocks, splitMarkdownByVisualBlocks } from './parseVisualBlocks';

describe('parseVisualBlocks', () => {
  it('returns empty array for text without visual blocks', () => {
    const text = 'Hello world!\n```typescript\nconst x = 1;\n```\nPlain text.';
    expect(parseVisualBlocks(text)).toEqual([]);
  });

  it('extracts mermaid block correctly', () => {
    const text = `
Here is a flowchart:
\`\`\`mermaid
flowchart TD
  A[Start] --> B[Stop]
\`\`\`
Done.
`;
    const blocks = parseVisualBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('mermaid');
    expect(blocks[0].content).toContain('flowchart TD');
    expect(blocks[0].parsedJson).toBeUndefined();
    expect(blocks[0].parseError).toBeUndefined();
  });

  it('extracts valid recharts block and parses JSON', () => {
    const rechartsJson = JSON.stringify(
      {
        type: 'bar',
        data: [{ month: 'Jan', sales: 100 }],
        series: [{ key: 'sales', label: 'Sales' }],
      },
      null,
      2,
    );
    const text = `
Summary chart:
\`\`\`recharts
${rechartsJson}
\`\`\`
End.
`;
    const blocks = parseVisualBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('recharts');
    expect(blocks[0].parsedJson).toEqual({
      type: 'bar',
      data: [{ month: 'Jan', sales: 100 }],
      series: [{ key: 'sales', label: 'Sales' }],
    });
    expect(blocks[0].parseError).toBeUndefined();
  });

  it('handles invalid recharts JSON with error fallback without throwing', () => {
    const text = `
\`\`\`recharts
{ invalid json syntax here, missing quotes: 123 }
\`\`\`
`;
    const blocks = parseVisualBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('recharts');
    expect(blocks[0].parsedJson).toBeUndefined();
    expect(blocks[0].parseError).toBeDefined();
    expect(blocks[0].content).toContain('invalid json syntax');
  });

  it('extracts multiple visual blocks intermixed with regular content', () => {
    const text = `
Intro text.
\`\`\`mermaid
graph LR
  A --> B
\`\`\`
Middle text with code:
\`\`\`python
print("hi")
\`\`\`
\`\`\`recharts
{"type": "line", "data": []}
\`\`\`
Ending.
`;
    const blocks = parseVisualBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('mermaid');
    expect(blocks[1].type).toBe('recharts');
  });

  it('splitMarkdownByVisualBlocks splits content into contiguous segments', () => {
    const text = `Header
\`\`\`mermaid
graph TD
A --> B
\`\`\`
Footer`;
    const segments = splitMarkdownByVisualBlocks(text);
    expect(segments).toHaveLength(3);
    expect(segments[0].type).toBe('text');
    expect(segments[0].content).toBe('Header\n');
    expect(segments[1].type).toBe('mermaid');
    expect(segments[1].content).toContain('graph TD');
    expect(segments[2].type).toBe('text');
    expect(segments[2].content).toBe('\nFooter');
  });

  it('converts mermaid block containing chart DSL to recharts type and parses it', () => {
    const text = `\`\`\`mermaid
line chart title="Trend"
xKey: "date"
series: []
\`\`\``;
    const blocks = parseVisualBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('recharts');
    expect(blocks[0].parsedJson).toBeDefined();
  });
});
