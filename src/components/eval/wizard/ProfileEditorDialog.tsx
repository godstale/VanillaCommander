import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ANCHORS_V1, CONSTRAINT_METRICS } from '@/lib/eval/constants';
import type { EvalCategoryId, EvalDimension, EvalProfile } from '@/lib/eval/types';
import { EVAL_CATEGORIES, EVAL_DIMENSIONS } from '@/lib/eval/types';

interface ProfileEditorDialogProps {
  open: boolean;
  profile: EvalProfile;
  onClose: () => void;
  onSave: (profile: EvalProfile) => void;
}

const DIMS: EvalDimension[] = [...EVAL_DIMENSIONS];
const CATS: EvalCategoryId[] = [...EVAL_CATEGORIES];

export function ProfileEditorDialog({ open, profile, onClose, onSave }: ProfileEditorDialogProps) {
  const { t, locale } = useLanguage();
  const [draft, setDraft] = useState<EvalProfile>(profile);
  const [catToAdd, setCatToAdd] = useState<EvalCategoryId>('Q1');
  const [metricToAdd, setMetricToAdd] = useState<string>(CONSTRAINT_METRICS[0]);

  const anchorKeys = useMemo(() => Object.keys(ANCHORS_V1), []);
  // Reset draft whenever a different profile (or dialog reopen) is shown.
  const [lastId, setLastId] = useState<string | null>(null);
  if (open && lastId !== `${profile.id}:${open}`) {
    setLastId(`${profile.id}:${open}`);
    setDraft(profile);
  }

  function save(): void {
    const next: EvalProfile = profile.builtIn
      ? { ...draft, id: `${profile.id}-custom-${Date.now().toString(36)}`, builtIn: false }
      : { ...draft, id: profile.id, builtIn: false };
    onSave(next);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">{t('eval.wizard.editor.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-xs">
          <label className="block">
            <span className="font-semibold">{t('eval.wizard.editor.name')}</span>
            <Input
              value={locale === 'ko' ? draft.name.ko : draft.name.en}
              onChange={(e) => {
                const v = e.target.value;
                setDraft((d) => ({ ...d, name: { ...d.name, [locale]: v } }));
              }}
              className="mt-1"
            />
          </label>
          <div>
            <div className="font-semibold">{t('eval.wizard.editor.dimWeights')}</div>
            {DIMS.map((d) => (
              <label key={d} className="mt-1 flex items-center gap-2">
                <span className="w-6 font-mono">{d}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.dimensionWeights[d] ?? 0}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      dimensionWeights: { ...prev.dimensionWeights, [d]: Number(e.target.value) },
                    }))
                  }
                  className="flex-1"
                />
                <span className="w-10 text-right font-mono">{draft.dimensionWeights[d] ?? 0}</span>
              </label>
            ))}
          </div>
          <div>
            <div className="font-semibold">{t('eval.wizard.editor.catWeights')}</div>
            {Object.entries(draft.categoryWeights).map(([cat, w]) => (
              <div key={cat} className="mt-1 flex items-center gap-2">
                <span className="w-10 font-mono">{cat}</span>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={w}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      categoryWeights: { ...prev.categoryWeights, [cat]: Number(e.target.value) },
                    }))
                  }
                  className="h-7 w-24"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDraft((prev) => {
                      const next = { ...prev.categoryWeights };
                      delete next[cat];
                      return { ...prev, categoryWeights: next };
                    })
                  }
                >
                  ×
                </Button>
              </div>
            ))}
            <div className="mt-1 flex items-center gap-2">
              <select value={catToAdd} onChange={(e) => setCatToAdd(e.target.value as EvalCategoryId)} className="h-7 rounded border border-input bg-background px-1">
                {CATS.filter((c) => !(c in draft.categoryWeights)).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDraft((prev) => ({ ...prev, categoryWeights: { ...prev.categoryWeights, [catToAdd]: 1 } }))}
              >
                {t('eval.wizard.editor.addCat')}
              </Button>
            </div>
          </div>
          <div>
            <div className="font-semibold">{t('eval.wizard.editor.constraints')}</div>
            {draft.constraints.map((c, i) => (
              <div key={i} className="mt-1 flex items-center gap-2">
                <span className="font-mono">{c.metric} {c.op} {c.value}</span>
                <span className="text-muted-foreground">{c.label.ko}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft((prev) => ({ ...prev, constraints: prev.constraints.filter((_, j) => j !== i) }))}
                >
                  ×
                </Button>
              </div>
            ))}
            <div className="mt-1 flex items-center gap-2">
              <select value={metricToAdd} onChange={(e) => setMetricToAdd(e.target.value)} className="h-7 rounded border border-input bg-background px-1">
                {[...CONSTRAINT_METRICS, ...CATS].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    constraints: [
                      ...prev.constraints,
                      { metric: metricToAdd, op: '<=' as const, value: 0.1, label: { ko: `${metricToAdd} ≤ 0.1`, en: `${metricToAdd} ≤ 0.1` } },
                    ],
                  }))
                }
              >
                {t('eval.wizard.editor.addConstraint')}
              </Button>
            </div>
          </div>
          <div>
            <div className="font-semibold">{t('eval.wizard.editor.anchors')}</div>
            {anchorKeys.map((key) => {
              const over = draft.anchorOverrides[key];
              const base = ANCHORS_V1[key];
              return (
                <div key={key} className="mt-1 flex items-center gap-2">
                  <span className="w-32 font-mono">{key}</span>
                  <Input
                    type="number"
                    placeholder={String(base.zero)}
                    value={over?.zero ?? ''}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        anchorOverrides: {
                          ...prev.anchorOverrides,
                          [key]: { zero: Number(e.target.value), full: over?.full ?? base.full },
                        },
                      }))
                    }
                    className="h-7 w-24"
                  />
                  <Input
                    type="number"
                    placeholder={String(base.full)}
                    value={over?.full ?? ''}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        anchorOverrides: {
                          ...prev.anchorOverrides,
                          [key]: { zero: over?.zero ?? base.zero, full: Number(e.target.value) },
                        },
                      }))
                    }
                    className="h-7 w-24"
                  />
                  {over && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDraft((prev) => {
                          const next = { ...prev.anchorOverrides };
                          delete next[key];
                          return { ...prev, anchorOverrides: next };
                        })
                      }
                    >
                      ×
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            {t('eval.wizard.editor.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={save}>
            {t('eval.wizard.editor.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
