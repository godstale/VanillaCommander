import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { useEval } from '@/lib/context/EvalContext';
import { BUILTIN_PROFILES, DEFAULT_RUN_OPTIONS } from '@/lib/eval/constants';
import type { CandidateSnapshot, EvalProfile, JudgeConfig } from '@/lib/eval/types';
import { StepProfile } from './StepProfile';
import { StepPacks } from './StepPacks';
import { StepCandidates, type QuantCompare } from './StepCandidates';
import { StepReview } from './StepReview';
import { needsJudge, type WizardDraft, type WizardPackSelection, type WizardRunOptions } from './buildRunConfig';
import { QUANT_PROBE_PACK_ID } from './sizePresets';
import { FieldInfo } from './FieldInfo';

const STEPS = [0, 1, 2, 3] as const;
const STEP_KEYS = ['profile', 'packs', 'candidates', 'review'] as const;

function cloneProfile(p: EvalProfile): EvalProfile {
  return JSON.parse(JSON.stringify(p)) as EvalProfile;
}

function suggestRunName(candidates: CandidateSnapshot[], profile: EvalProfile): string {
  const date = new Date().toISOString().slice(0, 10);
  const head = candidates[0]?.label.split(' · ')[0]?.trim() || 'eval';
  return `${head}_${profile.id}_${date}`;
}

export function EvalRunWizard() {
  const { t } = useLanguage();
  const { packs, packErrors, packsLoading, refreshPacks, profiles } = useEval();
  const [step, setStep] = useState(0);
  const [extraProfiles, setExtraProfiles] = useState<EvalProfile[]>([]);
  const [profileId, setProfileId] = useState(BUILTIN_PROFILES[0].id);
  const [runNameTouched, setRunNameTouched] = useState(false);
  const [draft, setDraft] = useState<WizardDraft>(() => ({
    runName: `eval-${new Date().toISOString().slice(0, 10)}`,
    profile: cloneProfile(BUILTIN_PROFILES[0]),
    packSelections: [],
    candidates: [],
    judge: null,
    options: {
      deterministicMode: DEFAULT_RUN_OPTIONS.deterministicMode,
      reliabilityEpochs: DEFAULT_RUN_OPTIONS.reliabilityEpochs,
      timeoutMultiplier: DEFAULT_RUN_OPTIONS.timeoutMultiplier,
      perfRepeats: DEFAULT_RUN_OPTIONS.perfRepeats,
      unloadBetweenCandidates: DEFAULT_RUN_OPTIONS.unloadBetweenCandidates,
    },
    sampleOrderSeed: 42,
    weightsConfirmedAt: '',
    externalTransfers: [],
    externalConfirmedAt: null,
    codeExecution: null,
    proceedWithoutExternal: false,
  }));
  const [quant, setQuant] = useState<QuantCompare>({ enabled: false, baseIndex: 0 });

  const allProfiles = useMemo(() => [...profiles, ...extraProfiles.filter((e) => !profiles.some((p) => p.id === e.id))], [profiles, extraProfiles]);

  function patch(p: Partial<WizardDraft>): void {
    if (p.runName !== undefined) setRunNameTouched(true);
    setDraft((prev) => ({ ...prev, ...p }));
  }

  function selectProfile(id: string): void {
    const found = allProfiles.find((p) => p.id === id);
    if (!found) return;
    const cloned = cloneProfile(found);
    setProfileId(id);
    // 프로파일이 바뀌면 팩 조합을 처음부터 다시 맞춘다(자동 조합).
    // 직접 수정한 실행명은 유지한다.
    setDraft((prev) => ({
      ...prev,
      profile: cloned,
      weightsConfirmedAt: '',
      packSelections: prev.profile.id === id ? prev.packSelections : [],
      runName: runNameTouched ? prev.runName : suggestRunName(prev.candidates, cloned),
    }));
  }

  function saveCustomProfile(p: EvalProfile): void {
    setExtraProfiles((prev) => [...prev.filter((x) => x.id !== p.id), p]);
    setProfileId(p.id);
    patch({ profile: cloneProfile(p), weightsConfirmedAt: '' });
  }

  function handleCandidatesChange(candidates: CandidateSnapshot[]): void {
    setDraft((prev) => ({
      ...prev,
      candidates,
      runName: runNameTouched ? prev.runName : suggestRunName(candidates, prev.profile),
    }));
  }

  function handleQuantChange(next: QuantCompare): void {
    setQuant(next);
    // Q8 비교를 켜면 양자화 프로브 팩을 평가셋에 자동 포함한다.
    // 이전에는 토글이 실행 설정에 반영되지 않았다.
    if (!next.enabled) return;
    const ref = packs.find((r) => r.manifest.id === QUANT_PROBE_PACK_ID);
    if (!ref) return;
    setDraft((prev) => (
      prev.packSelections.some((s) => s.packId === QUANT_PROBE_PACK_ID)
        ? prev
        : {
          ...prev,
          packSelections: [
            ...prev.packSelections,
            { scope: ref.scope, packId: ref.manifest.id, tier: 'smoke', epochs: 1, circular: false },
          ],
        }
    ));
  }

  const quantPackExists = useMemo(
    () => packs.some((r) => r.manifest.id === QUANT_PROBE_PACK_ID),
    [packs],
  );
  const quantPackIncluded = useMemo(
    () => draft.packSelections.some((s) => s.packId === QUANT_PROBE_PACK_ID),
    [draft.packSelections],
  );

  const selectedRefs = useMemo(() => {
    const byKey = new Map(packs.map((r) => [`${r.scope}:${r.manifest.id}`, r]));
    return draft.packSelections
      .map((s) => byKey.get(`${s.scope}:${s.packId}`))
      .filter((r): r is (typeof packs)[number] => r !== undefined);
  }, [packs, draft.packSelections]);

  const judgeRequired = useMemo(
    () => needsJudge(selectedRefs.map((r) => r.manifest)),
    [selectedRefs],
  );

  const stepComplete: boolean[] = [
    true,
    draft.packSelections.length > 0,
    draft.candidates.length > 0 && (!judgeRequired || draft.judge !== null),
    false,
  ];

  // n단계가 끝나야 n+1 헤더로 갈 수 있다. 이전 단계는 항상 돌아갈 수 있다.
  function isReachable(s: number): boolean {
    for (let i = 0; i < s; i += 1) {
      if (!stepComplete[i]) return false;
    }
    return true;
  }

  const blockReason =
    step === 1 && draft.packSelections.length === 0
      ? t('eval.wizard.packs.requireSelect')
      : step === 2 && draft.candidates.length === 0
        ? t('eval.wizard.candidates.requireSelect')
        : step === 2 && judgeRequired && draft.judge === null
          ? t('eval.wizard.judge.required')
          : null;

  const canNext = isReachable(step + 1) && step < 3;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h2 className="text-base font-semibold">{t('eval.wizard.title')}</h2>
      <ol className="flex gap-1 text-xs">
        {STEPS.map((s) => (
          <li key={s} className="flex flex-1 items-center gap-1">
            <button
              type="button"
              onClick={() => setStep(s)}
              disabled={!isReachable(s)}
              title={!isReachable(s) && blockReason && s === step + 1 ? blockReason : undefined}
              className={`flex-1 rounded px-2 py-1.5 text-center disabled:cursor-not-allowed disabled:opacity-40 ${s === step ? 'bg-primary text-primary-foreground' : s < step ? 'bg-primary/15' : 'bg-muted text-muted-foreground'}`}
            >
              {t(`eval.wizard.step.${STEP_KEYS[s]}`)}
            </button>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{t('eval.wizard.stepOf', { a: step + 1, b: 4 })}</span>
        <FieldInfo label={t(`eval.wizard.step.${STEP_KEYS[step]}`)} help={t(`eval.wizard.guide.${STEP_KEYS[step]}`)} />
        <span>{t(`eval.wizard.guide.${STEP_KEYS[step]}`)}</span>
      </div>

      {step === 0 && (
        <StepProfile
          profiles={allProfiles}
          selectedId={profileId}
          profile={draft.profile}
          onSelect={selectProfile}
          onSaveCustom={saveCustomProfile}
        />
      )}
      {step === 1 && (
        <StepPacks
          packs={packs}
          errors={packErrors}
          loading={packsLoading}
          onRetry={() => void refreshPacks()}
          selections={draft.packSelections}
          profile={draft.profile}
          onChange={(packSelections: WizardPackSelection[]) => patch({ packSelections })}
          quantEnabled={quant.enabled}
        />
      )}
      {step === 2 && (
        <StepCandidates
          candidates={draft.candidates}
          onChange={handleCandidatesChange}
          judge={draft.judge}
          onJudgeChange={(judge: JudgeConfig | null) => patch({ judge })}
          judgeRequired={judgeRequired}
          packManifests={selectedRefs.map((r) => r.manifest)}
          options={draft.options}
          onOptionsChange={(options: WizardRunOptions) => patch({ options })}
          sampleOrderSeed={draft.sampleOrderSeed}
          onSeedChange={(sampleOrderSeed: number) => patch({ sampleOrderSeed })}
          quant={quant}
          onQuantChange={handleQuantChange}
          quantPackExists={quantPackExists}
          quantPackIncluded={quantPackIncluded}
        />
      )}
      {step === 3 && (
        <StepReview draft={draft} onUpdate={patch} refs={selectedRefs} onProfileSaved={saveCustomProfile} />
      )}

      {step < 3 && (
        <div className="space-y-1">
          <div className="flex justify-between">
            <Button type="button" size="sm" variant="outline" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
              {t('eval.wizard.prev')}
            </Button>
            <Button type="button" size="sm" disabled={!canNext} onClick={() => setStep((s) => Math.min(3, s + 1))}>
              {t('eval.wizard.next')}
            </Button>
          </div>
          {blockReason && (
            <div data-testid="next-blocked" className="text-right text-xs text-destructive">
              {blockReason}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default EvalRunWizard;
