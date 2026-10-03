import { describe, expect, it } from 'vitest';
import { recommendContextBudget } from './gpuAutoTune';

const gpu = (vramGb: number, sysGb = 0) => ({
  vramTotalMb: vramGb * 1024,
  systemMemoryTotalMb: sysGb * 1024,
});

describe('recommendContextBudget', () => {
  it('scales context with VRAM', () => {
    expect(recommendContextBudget(gpu(4)).contextSize).toBe(8192);
    expect(recommendContextBudget(gpu(8)).contextSize).toBe(16384);
    expect(recommendContextBudget(gpu(12)).contextSize).toBe(24576);
    expect(recommendContextBudget(gpu(24)).contextSize).toBe(49152);
    expect(recommendContextBudget(gpu(96)).contextSize).toBe(131072);
  });

  it('keeps reserve and keep below the context size', () => {
    for (const gb of [2, 6, 8, 12, 16, 24, 32, 48, 80]) {
      const r = recommendContextBudget(gpu(gb));
      expect(r.reserveTokens + r.keepRecentTokens).toBeLessThan(r.contextSize);
    }
  });

  it('falls back to half of system memory without VRAM, then to 8K', () => {
    expect(recommendContextBudget(gpu(0, 32)).contextSize).toBe(32768);
    expect(recommendContextBudget(gpu(0, 0)).contextSize).toBe(8192);
    expect(recommendContextBudget(null).contextSize).toBe(8192);
  });
});
