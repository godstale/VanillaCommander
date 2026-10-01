import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from './hash';

describe('pack hash', () => {
  it('produces stable hashes regardless of key order', async () => {
    const a = await sha256Hex(`${canonicalJson({ b: 1, a: { y: 2, x: 1 } })}\nbody`);
    const b = await sha256Hex(`${canonicalJson({ a: { x: 1, y: 2 }, b: 1 })}\nbody`);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes hash when content changes', async () => {
    const a = await sha256Hex('x\n1');
    const b = await sha256Hex('x\n2');
    expect(a).not.toBe(b);
  });
});
