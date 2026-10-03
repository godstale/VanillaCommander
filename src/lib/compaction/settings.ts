import type { Agent } from '@/lib/types/agent';
import type { AppSettings } from '@/lib/types/chat';

export interface CompactionSettings {
  contextSize: number;
  reserveTokens: number;
  keepRecentTokens: number;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(val), min), max);
}

/**
 * 컨텍스트 크기별 기본 압축 예산 (토큰).
 * reserve는 트리거 여유분(-management overhead + 도구 호출 버스트 + 응답 길이)으로
 * 전 구간 25%를 유지하고, keep은 요약 후 verbatim으로 남길 최근 대화량이다.
 * 작은 컨텍스트의 keep(8K→1K)은 도구형 작업에 빠듯할 수 있어 요약 품질에
 * 의존한다 — 도구 위주면 앱 기본값(defaults.ts)이나 에이전트별 설정에서 상향 조정할 것.
 */
export function defaultReserveForContext(contextSize: number): number {
  if (contextSize <= 8192) return 2048;
  if (contextSize <= 16384) return 4096;
  if (contextSize <= 24576) return 6144;
  return 8192;
}

export function defaultKeepForContext(contextSize: number): number {
  if (contextSize <= 8192) return 1024;
  if (contextSize <= 16384) return 2048;
  if (contextSize <= 24576) return 4096;
  return 8192;
}

/**
 * Resolves compaction budget parameters:
 * - contextSize defaults to global defaultContextSize (or 8192).
 * - reserveTokens: explicit agent value > global default > stepwise table above.
 * - keepRecentTokens: explicit agent value > global default > stepwise table above.
 * - 0/undefined means "auto" at every level.
 */
export function resolveCompactionSettings(
  agent?: Partial<Agent>,
  globalDefaults?: Partial<AppSettings>,
): CompactionSettings {
  const fallbackContextSize = globalDefaults?.defaultContextSize ?? 8192;
  const contextSize =
    agent?.contextSize && agent.contextSize > 0
      ? agent.contextSize
      : fallbackContextSize;

  const globalReserve =
    globalDefaults?.defaultReserveTokens && globalDefaults.defaultReserveTokens > 0
      ? globalDefaults.defaultReserveTokens
      : 0;
  const globalKeep =
    globalDefaults?.defaultKeepRecentTokens && globalDefaults.defaultKeepRecentTokens > 0
      ? globalDefaults.defaultKeepRecentTokens
      : 0;

  const reserveTokens =
    agent?.reserveTokens && agent.reserveTokens > 0
      ? agent.reserveTokens
      : globalReserve > 0
        ? globalReserve
        : defaultReserveForContext(contextSize);

  const keepRecentTokens =
    agent?.keepRecentTokens && agent.keepRecentTokens > 0
      ? agent.keepRecentTokens
      : globalKeep > 0
        ? globalKeep
        : defaultKeepForContext(contextSize);

  return {
    contextSize,
    reserveTokens,
    keepRecentTokens,
  };
}
