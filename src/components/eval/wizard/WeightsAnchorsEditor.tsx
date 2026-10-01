import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ANCHORS_V1 } from '@/lib/eval/constants';
import { saveProfile } from '@/lib/db/repositories/evalRepo';
import type { EvalCategoryId, EvalDimension, EvalProfile } from '@/lib/eval/types';
import { EVAL_CATEGORIES, EVAL_DIMENSIONS } from '@/lib/eval/types';

interface WeightsAnchorsEditorProps {
  profile: EvalProfile;
  onChange: (profile: EvalProfile) => void;
  confirmed: boolean;
  onConfirmChange: (confirmed: boolean, at: string | null) => void;
  onProfileSaved?: (profile: EvalProfile) => void;
}

const DIMS: EvalDimension[] = [...EVAL_DIMENSIONS];
const CATS: EvalCategoryId[] = [...EVAL_CATEGORIES];

export function WeightsAnchorsEditor({ profile, onChange, confirmed, onConfirmChange, onProfileSaved }: WeightsAnchorsEditorProps) {
  const { t } = useLanguage();
  const [saveName, setSaveName] = useState('');

  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <div className="font-semibold">{t('eval.wizard.weights.title')}</div>
      <p className="text-muted-foreground">{t('eval.wizard.weights.desc')}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          {DIMS.map((d) => (
            <label key={d} className="mt-1 flex items-center gap-2">
              <span className="w-20">{d} · {t(`eval.common.dim.${d}`)}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={profile.dimensionWeights[d] ?? 0}
                onChange={(e) =>
                  onChange({ ...profile, dimensionWeights: { ...profile.dimensionWeights, [d]: Number(e.target.value) } })
                }
                className="flex-1"
              />
              <span className="w-8 text-right font-mono">{profile.dimensionWeights[d] ?? 0}</span>
            </label>
          ))}
        </div>
        <div>
          {CATS.map((c) => (
            <label key={c} className="mt-1 flex items-center gap-2">
              <span className="w-28 truncate" title={t(`eval.common.cat.${c}`)}>{c} · {t(`eval.common.cat.${c}`)}</span>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={profile.categoryWeights[c] ?? 1}
                onChange={(e) =>
                  onChange({ ...profile, categoryWeights: { ...profile.categoryWeights, [c]: Number(e.target.value) } })
                }
                className="h-6 w-20"
              />
            </label>
          ))}
        </div>
      </div>
      <div>
        {Object.keys(ANCHORS_V1).map((key) => {
          const over = profile.anchorOverrides[key];
          const base = ANCHORS_V1[key];
          const zero = over?.zero ?? base.zero;
          const full = over?.full ?? base.full;
          return (
            <div key={key} className="mt-1 flex flex-wrap items-center gap-2">
              <span className="w-32 font-mono">{key}</span>
              <Input
                type="number"
                value={zero}
                onChange={(e) =>
                  onChange({ ...profile, anchorOverrides: { ...profile.anchorOverrides, [key]: { zero: Number(e.target.value), full } } })
                }
                className="h-6 w-24"
              />
              <Input
                type="number"
                value={full}
                onChange={(e) =>
                  onChange({ ...profile, anchorOverrides: { ...profile.anchorOverrides, [key]: { zero, full: Number(e.target.value) } } })
                }
                className="h-6 w-24"
              />
              <span className="text-muted-foreground">{t(`eval.wizard.anchor.${key}`, { zero, full })}</span>
            </div>
          );
        })}
      </div>
      <label className="flex items-center gap-2 font-semibold">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmChange(e.target.checked, e.target.checked ? new Date().toISOString() : null)}
        />
        {t('eval.wizard.weights.confirmed')}
      </label>
      <div className="flex items-center gap-2">
        <Input
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder={t('eval.wizard.weights.profileName')}
          className="h-7 w-48"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saveName.trim().length === 0}
          onClick={() => {
            const next: EvalProfile = {
              ...profile,
              id: `custom-${Date.now().toString(36)}`,
              builtIn: false,
              name: { ko: saveName.trim(), en: saveName.trim() },
            };
            void saveProfile(next).then(() => onProfileSaved?.(next));
          }}
        >
          {t('eval.wizard.weights.saveAs')}
        </Button>
      </div>
    </div>
  );
}
