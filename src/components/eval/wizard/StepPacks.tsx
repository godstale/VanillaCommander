import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CATEGORY_META } from '@/lib/eval/constants';
import type { LoadedPackRef } from '@/lib/eval/packs/packLoader';
import type { EvalProfile, PackScope, TierName } from '@/lib/eval/types';
import { isZeroWeightCategory, type WizardPackSelection } from './buildRunConfig';
import { FieldInfo } from './FieldInfo';
import { EVAL_SIZES, QUANT_PROBE_PACK_ID, applyEvalSizePreset, type EvalSize } from './sizePresets';

interface StepPacksProps {
  packs: LoadedPackRef[];
  errors: Array<{ scope: PackScope; packId: string; error: string }>;
  selections: WizardPackSelection[];
  profile: EvalProfile;
  loading?: boolean;
  onRetry?: () => void;
  onChange: (selections: WizardPackSelection[]) => void;
  quantEnabled: boolean;
}

const SIZE_TIER: Record<EvalSize, TierName> = { quick: 'smoke', standard: 'standard', full: 'full' };

function selKey(scope: PackScope, packId: string): string {
  return `${scope}:${packId}`;
}

export function StepPacks({ packs, errors, selections, profile, loading, onRetry, onChange, quantEnabled }: StepPacksProps) {
  const { t, locale } = useLanguage();
  const byKey = useMemo(() => new Map(selections.map((s) => [selKey(s.scope, s.packId), s])), [selections]);
  // 팩 선택이 비어 있으면 크기 프리셋으로 자동 채운다. 프로파일이 바뀌면
  // 사용자 지정(custom)이 아닐 때만 다시 조합한다.
  const [size, setSize] = useState<EvalSize | 'custom'>(() => (selections.length > 0 ? 'custom' : 'quick'));
  const appliedProfile = useRef<string | null>(selections.length > 0 ? profile.id : null);
  // 사용자가 마지막 팩까지 직접 해제했으면 비운 채로 둔다(차단 사유 표시용).
  const userEmptied = useRef(false);

  function withQuantProbe(next: WizardPackSelection[]): WizardPackSelection[] {
    if (!quantEnabled || next.some((s) => s.packId === QUANT_PROBE_PACK_ID)) return next;
    const ref = packs.find((r) => r.manifest.id === QUANT_PROBE_PACK_ID);
    if (!ref) return next;
    return [...next, { scope: ref.scope, packId: ref.manifest.id, tier: 'smoke', epochs: 1, circular: false }];
  }

  useEffect(() => {
    if (packs.length === 0 || userEmptied.current) return;
    if (selections.length > 0 && (appliedProfile.current === profile.id || size === 'custom')) return;
    onChange(withQuantProbe(applyEvalSizePreset(packs, profile, size === 'custom' ? 'quick' : size)));
    appliedProfile.current = profile.id;
    // packs/profile/size가 바뀔 때만 자동 조합한다. 콜백·선택목록은 의도적으로 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packs, profile.id, size, quantEnabled]);

  function chooseSize(next: EvalSize): void {
    setSize(next);
    userEmptied.current = false;
    appliedProfile.current = profile.id;
    onChange(applyEvalSizePreset(packs, profile, next));
  }

  function markCustom(next: WizardPackSelection[]): void {
    setSize('custom');
    userEmptied.current = next.length === 0;
    onChange(next);
  }

  function toggle(ref: LoadedPackRef): void {
    const key = selKey(ref.scope, ref.manifest.id);
    if (byKey.has(key)) {
      markCustom(selections.filter((s) => selKey(s.scope, s.packId) !== key));
    } else {
      markCustom([...selections, { scope: ref.scope, packId: ref.manifest.id, tier: 'smoke', epochs: ref.manifest.defaults.epochs, circular: ref.manifest.defaults.circular }]);
    }
  }

  function patch(ref: LoadedPackRef, p: Partial<WizardPackSelection>): void {
    const key = selKey(ref.scope, ref.manifest.id);
    markCustom(selections.map((s) => (selKey(s.scope, s.packId) === key ? { ...s, ...p } : s)));
  }

  const sizeCounts = useMemo(() => {
    const m = new Map<EvalSize, number>();
    for (const s of EVAL_SIZES) {
      try {
        m.set(s, applyEvalSizePreset(packs, profile, s).length);
      } catch {
        m.set(s, 0);
      }
    }
    return m;
  }, [packs, profile]);

  const groups = useMemo(() => {
    const map = new Map<LoadedPackRef['manifest']['category'], LoadedPackRef[]>();
    for (const r of packs) {
      const arr = map.get(r.manifest.category) ?? [];
      arr.push(r);
      map.set(r.manifest.category, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [packs]);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {t('eval.wizard.size.title')}
          <FieldInfo label={t('eval.wizard.size.title')} help={t('eval.wizard.guide.packs')} />
        </h3>
        <p className="text-xs text-muted-foreground">{t('eval.wizard.packs.desc')}</p>
      </div>
      <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label={t('eval.wizard.size.title')}>
        {EVAL_SIZES.map((s) => {
          const active = size === s;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => chooseSize(s)}
              title={t(`eval.wizard.size.${s}Desc`)}
              className={`rounded-lg border p-3 text-left text-xs ${active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold">{t(`eval.wizard.size.${s}`)}</span>
                <FieldInfo label={t(`eval.wizard.size.${s}`)} help={t(`eval.wizard.size.${s}Desc`)} />
              </div>
              <div className="mt-1 text-muted-foreground">
                {t('eval.wizard.size.packs', { n: sizeCounts.get(s) ?? 0, tier: SIZE_TIER[s] })}
              </div>
            </button>
          );
        })}
      </div>
      {size === 'custom' && (
        <div className="text-xs text-muted-foreground">{t('eval.wizard.size.customNote')}</div>
      )}
      {loading && <div className="text-xs text-muted-foreground">{t('eval.wizard.packs.loading')}</div>}
      {packs.length === 0 && !loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t('eval.wizard.packs.none')}</span>
          {onRetry && (
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              {t('eval.wizard.packs.retry')}
            </Button>
          )}
        </div>
      )}
      {errors.map((e, i) => (
        <div key={i} className="text-xs text-destructive">
          {t('eval.wizard.packs.loadError', { err: `${e.scope}/${e.packId}: ${e.error}` })}
        </div>
      ))}
      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">
          {t('eval.wizard.size.advanced')}
        </summary>
        <div className="space-y-3 border-t border-border p-3">
          {groups.map(([cat, refs]) => (
            <div key={cat} className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground">
                {cat} · {t(CATEGORY_META[cat].labelKey)}
              </div>
              {refs.map((ref) => {
                const m = ref.manifest;
                const sel = byKey.get(selKey(ref.scope, m.id));
                const dimmed = isZeroWeightCategory(profile, m.category);
                const tierCount = m.tiers[sel?.tier ?? 'smoke'];
                return (
                  <div
                    key={`${ref.scope}:${m.id}`}
                    className={`rounded-lg border p-2.5 text-xs ${sel ? 'border-primary bg-primary/5' : 'border-border'} ${dimmed ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={!!sel} onChange={() => toggle(ref)} aria-label={m.id} />
                      <span className="font-mono font-semibold">{m.id}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{ref.scope}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{m.kind}</span>
                      {dimmed && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{t('eval.wizard.packs.zeroWeight')}</span>}
                      <span className="ml-auto text-muted-foreground">{locale === 'ko' ? m.title.ko : m.title.en}</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      license: {m.license.id}
                      {ref.diagnostics.length > 0 && ` · ⚠ ${ref.diagnostics[0].message}`}
                    </div>
                    {sel && (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-1">
                          {t('eval.wizard.packs.tier')}
                          <select
                            value={sel.tier}
                            onChange={(e) => patch(ref, { tier: e.target.value as TierName })}
                            className="h-7 rounded border border-input bg-background px-1"
                          >
                            {(['smoke', 'standard', 'full'] as TierName[]).map((tier) => <option key={tier} value={tier}>{tier}</option>)}
                          </select>
                        </label>
                        <label className="flex items-center gap-1">
                          {t('eval.wizard.packs.epochs')}
                          <Input
                            type="number"
                            min={1}
                            max={10}
                            value={sel.epochs}
                            onChange={(e) => patch(ref, { epochs: Math.max(1, Number(e.target.value)) })}
                            className="h-7 w-16"
                          />
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" checked={sel.circular} onChange={(e) => patch(ref, { circular: e.target.checked })} />
                          {t('eval.wizard.packs.circular')}
                        </label>
                        <span className="text-muted-foreground">
                          {t('eval.wizard.packs.samples', { n: tierCount === 'all' ? '∞' : tierCount })}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </details>
      {selections.length === 0 && <div className="text-xs text-destructive">{t('eval.wizard.packs.requireSelect')}</div>}
    </div>
  );
}
