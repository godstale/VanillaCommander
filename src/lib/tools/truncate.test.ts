import { describe, it, expect } from 'vitest';
import { truncateOutput } from '@/lib/tools/truncate';

describe('truncateOutput', () => {
  it('returns content unmodified when within line and byte limits', () => {
    const text = 'Line 1\nLine 2\nLine 3';
    const result = truncateOutput(text, { maxLines: 10, maxBytes: 1000 });
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(text);
    expect(result.totalLines).toBe(3);
    expect(result.outputLines).toBe(3);
  });

  it('truncates when line count exceeds maxLines and does not return partial lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
    const text = lines.join('\n');
    const result = truncateOutput(text, { maxLines: 4, maxBytes: 10000 });

    expect(result.truncated).toBe(true);
    expect(result.outputLines).toBe(4);
    expect(result.totalLines).toBe(10);
    expect(result.content).toContain('Line 1\nLine 2\nLine 3\nLine 4');
    expect(result.content).not.toContain('Line 5');
    expect(result.content).toContain('총 10줄');
    expect(result.content).toContain('4줄');
    expect(result.content).toContain('6줄 생략됨');
  });

  it('truncates when byte size exceeds maxBytes without breaking mid-line', () => {
    // 5 lines of 20 bytes each: "1234567890123456789\n" -> 20 bytes per line
    const lines = [
      '1234567890123456789',
      'abcdefghijklmnopqrst',
      'ABCDEFGHIJKLMNOPQRST',
      '09876543210987654321',
      'zyxwvutsrqponmlkjihg',
    ];
    const text = lines.join('\n');
    // Limit to 45 bytes (should fit first 2 lines only)
    const result = truncateOutput(text, { maxLines: 100, maxBytes: 45 });

    expect(result.truncated).toBe(true);
    expect(result.outputLines).toBe(2);
    expect(result.content).toContain(lines[0]);
    expect(result.content).toContain(lines[1]);
    expect(result.content).not.toContain(lines[2]);
    expect(result.content).toContain('생략됨');
  });
});
