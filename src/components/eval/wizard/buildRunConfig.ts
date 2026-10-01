import { selectSampleIds } from '@/lib/eval/packs/sampling';
import type { LoadedPack } from '@/lib/eval/packs/packLoader';
import type {
  CandidateSnapshot,
  EvalCategoryId,
  EvalPackManifest,
  EvalProfile,
  EvalRunConfig,
  ExternalTransferPlan,
  JudgeConfig,
  PackScope,
  TierName,
} from '@/lib/eval/types';
import { CATEGORY_META } from '@/lib/eval/constants';

export interface WizardPackSelection {
  scope: PackScope;
  packId: string;
  tier: TierName;
  epochs: number;
  circular: boolean;
}

export interface WizardRunOptions {
  deterministicMode: boolean;
  reliabilityEpochs: number;
  timeoutMultiplier: number;
  perfRepeats: number;
  unloadBetweenCandidates: boolean;
}

export interface WizardDraft {
  runName: string;
  profile: EvalProfile;
  packSelections: WizardPackSelection[];
  candidates: CandidateSnapshot[];
  judge: JudgeConfig | null;
  options: WizardRunOptions;
  sampleOrderSeed: number;
  weightsConfirmedAt: string;
  externalTransfers: ExternalTransferPlan[];
  externalConfirmedAt: string | null;
  codeExecution: EvalRunConfig['confirmations']['codeExecution'];
  proceedWithoutExternal: boolean;
}

function keyOf(scope: PackScope, packId: string): string {
  return `${scope}:${packId}`;
}

export function buildRunConfig(
  draft: WizardDraft,
  loadedPacks: LoadedPack[],
  seed: number,
): EvalRunConfig {
  const byKey = new Map(loadedPacks.map((p) => [keyOf(p.scope, p.manifest.id), p]));
  const packs = draft.packSelections.map((sel) => {
    const pack = byKey.get(keyOf(sel.scope, sel.packId));
    if (!pack) throw new Error(`pack not loaded: ${keyOf(sel.scope, sel.packId)}`);
    return {
      scope: sel.scope,
      packId: sel.packId,
      version: pack.manifest.version,
      contentHash: pack.contentHash,
      tier: sel.tier,
      epochs: sel.epochs,
      circular: sel.circular,
      sampleIds: selectSampleIds(pack.samples, sel.tier, pack.manifest, seed),
    };
  });
  return {
    name: draft.runName,
    profile: draft.profile,
    packs,
    candidates: draft.candidates,
    judge: draft.judge,
    options: { ...draft.options, sampleOrderSeed: seed },
    confirmations: {
      weightsConfirmedAt: draft.weightsConfirmedAt,
      externalTransfers: draft.proceedWithoutExternal ? [] : draft.externalTransfers,
      externalConfirmedAt: draft.externalConfirmedAt,
      codeExecution: draft.codeExecution,
    },
  };
}

export const JUDGE_SCORER_TYPES = ['llm_judge_rubric', 'llm_judge_pairwise'];

export function needsJudge(manifests: EvalPackManifest[]): boolean {
  return manifests.some((m) => m.scorers.some((s) => JUDGE_SCORER_TYPES.includes(s.type)));
}

export function isZeroWeightCategory(profile: EvalProfile, category: EvalCategoryId): boolean {
  if (profile.categoryWeights[category] === 0) return true;
  const dim = CATEGORY_META[category].dimension;
  return (profile.dimensionWeights[dim] ?? 0) === 0;
}
