import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('csv parser', () => {
  it('parses quoted commas and embedded newlines', () => {
    const { rows, diagnostics } = parseCsv('a,b,c\n"1,2","x\ny",3\n');
    expect(diagnostics).toHaveLength(0);
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1,2', 'x\ny', '3'],
    ]);
  });

  it('handles escaped quotes and CRLF', () => {
    const { rows } = parseCsv('a\r\n"say ""hi""",b\r\n');
    expect(rows).toEqual([['a'], ['say "hi"', 'b']]);
  });

  it('strips BOM and skips blank lines handling', () => {
    const { rows } = parseCsv('\uFEFFa,b\n1,2\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reports unterminated quotes', () => {
    const { diagnostics } = parseCsv('a\n"oops\n');
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
