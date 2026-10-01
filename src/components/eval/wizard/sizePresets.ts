import { CATEGORY_META } from '@/lib/eval/constants';
import type { LoadedPackRef } from '@/lib/eval/packs/packLoader';
import type { EvalProfile } from '@/lib/eval/types';
import { isZeroWeightCategory, type WizardPackSelection } from './buildRunConfig';

// 마법사 평가셋 단계의 크기 선택. tier 버튼이 아니라 "시간 예산" 단위다.
// smoke-all도 팩 20종 합산 약 290샘플 + agentic/long_context라 3시간+가 걸렸던 것이
// 크기 프리셋 도입 이유다.
export type EvalSize = 'quick' | 'standard' | 'full';

export const EVAL_SIZES: EvalSize[] = ['quick', 'standard', 'full'];

// quick에서 제외하는 무거운 팩 종류. Q8(logprob_trace)은 양자화 비교 토글이
// 켜졌을 때만 별도로 포함된다.
export const QUICK_EXCLUDED_KINDS: ReadonlySet<string> = new Set([
  'long_context',
  'agentic',
  'logprob_trace',
]);

export const QUICK_PACK_LIMIT = 6;

export const QUANT_PROBE_PACK_ID = 'fab-quant-probe';

function smokeCount(ref: LoadedPackRef): number {
  const n = ref.manifest.tiers.smoke;
  return typeof n === 'number' ? n : Number.MAX_SAFE_INTEGER;
}

function dimensionWeightOf(profile: EvalProfile, ref: LoadedPackRef): number {
  const dim = CATEGORY_META[ref.manifest.category].dimension;
  return profile.dimensionWeights[dim] ?? 0;
}

function selectionFor(ref: LoadedPackRef, tier: WizardPackSelection['tier'], epochs: number | null): WizardPackSelection {
  return {
    scope: ref.scope,
    packId: ref.manifest.id,
    tier,
    epochs: epochs ?? ref.manifest.defaults.epochs,
    circular: ref.manifest.defaults.circular,
  };
}

// 프로파일 가중치 + 팩 tier 실측으로 실행할 팩과 설정을 자동 조합한다.
// quick: 가중치가 0이 아닌 카테고리마다 대표 1팩(가벼운 kind, smoke 적은 순),
//   프로파일 차원 가중치가 높은 순으로 최대 6팩, tier=smoke, epochs=1.
// standard: 가중치 0 제외 전 팩, tier=standard, epochs=기본값.
// full: 전 팩, tier=full, epochs=기본값.
export function applyEvalSizePreset(
  packs: LoadedPackRef[],
  profile: EvalProfile,
  size: EvalSize,
): WizardPackSelection[] {
  if (size === 'full') {
    return packs.map((r) => selectionFor(r, 'full', null));
  }
  const eligible = packs.filter(
    (r) => !isZeroWeightCategory(profile, r.manifest.category)
      && (size === 'standard' || !QUICK_EXCLUDED_KINDS.has(r.manifest.kind)),
  );
  if (size === 'standard') {
    return eligible.map((r) => selectionFor(r, 'standard', null));
  }
  const byCategory = new Map<string, LoadedPackRef[]>();
  for (const r of eligible) {
    const arr = byCategory.get(r.manifest.category) ?? [];
    arr.push(r);
    byCategory.set(r.manifest.category, arr);
  }
  const representatives: LoadedPackRef[] = [];
  for (const refs of byCategory.values()) {
    const sorted = [...refs].sort((a, b) => smokeCount(a) - smokeCount(b));
    const first = sorted[0];
    if (first) representatives.push(first);
  }
  representatives.sort(
    (a, b) => dimensionWeightOf(profile, b) - dimensionWeightOf(profile, a)
      || smokeCount(a) - smokeCount(b),
  );
  return representatives
    .slice(0, QUICK_PACK_LIMIT)
    .map((r) => selectionFor(r, 'smoke', 1));
}
