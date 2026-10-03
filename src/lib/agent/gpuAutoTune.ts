import type { SystemGpuInfo } from '@/lib/types/monitoring';
import { defaultKeepForContext, defaultReserveForContext } from '@/lib/compaction/settings';

export interface ContextBudgetRecommendation {
  contextSize: number;
  reserveTokens: number;
  keepRecentTokens: number;
}

/** VRAM(MB) 하한 → 권장 컨텍스트. 가중치가 VRAM 대부분을 차지하므로 보수적으로 잡는다. */
const VRAM_TIERS: ReadonlyArray<readonly [minVramMb: number, contextSize: number]> = [
  [80 * 1024, 131072],
  [48 * 1024, 98304],
  [32 * 1024, 65536],
  [24 * 1024, 49152],
  [16 * 1024, 32768],
  [12 * 1024, 24576],
  [8 * 1024, 16384],
  [6 * 1024, 12288],
];
const FALLBACK_CONTEXT = 8192;

function reserveFor(contextSize: number): number {
  return contextSize <= 24576 ? defaultReserveForContext(contextSize) : contextSize <= 65536 ? 8192 : 16384;
}

function keepFor(contextSize: number): number {
  return contextSize <= 24576 ? defaultKeepForContext(contextSize) : contextSize <= 65536 ? 8192 : 16384;
}

/**
 * GPU VRAM 크기로 컨텍스트 크기·압축 여유분·최근 보존량의 권장값을 계산한다.
 * VRAM을 알 수 없으면(iGPU·감지 실패) 시스템 메모리의 절반을 VRAM으로 간주하고,
 * 그것도 없으면 가장 보수적인 8K를 돌려준다.
 */
export function recommendContextBudget(
  gpu: Pick<SystemGpuInfo, 'vramTotalMb' | 'systemMemoryTotalMb'> | null | undefined,
): ContextBudgetRecommendation {
  const vramMb = gpu?.vramTotalMb && gpu.vramTotalMb > 0 ? gpu.vramTotalMb : (gpu?.systemMemoryTotalMb ?? 0) / 2;
  const tier = VRAM_TIERS.find(([min]) => vramMb >= min);
  const contextSize = tier ? tier[1] : FALLBACK_CONTEXT;
  return { contextSize, reserveTokens: reserveFor(contextSize), keepRecentTokens: keepFor(contextSize) };
}
