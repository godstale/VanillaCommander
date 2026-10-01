import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { saveProfile } from '@/lib/db/repositories/evalRepo';
import type { EvalDimension, EvalProfile } from '@/lib/eval/types';
import { EVAL_DIMENSIONS } from '@/lib/eval/types';
import { ProfileEditorDialog } from './ProfileEditorDialog';
import { FieldInfo } from './FieldInfo';

interface StepProfileProps {
  profiles: EvalProfile[];
  selectedId: string;
  profile: EvalProfile;
  onSelect: (id: string) => void;
  onSaveCustom: (profile: EvalProfile) => void;
}

const DIMS: EvalDimension[] = [...EVAL_DIMENSIONS];

export function StepProfile({ profiles, selectedId, profile, onSelect, onSaveCustom }: StepProfileProps) {
  const { t } = useLanguage();
  const [editorOpen, setEditorOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const total = DIMS.reduce((a, d) => a + (profile.dimensionWeights[d] ?? 0), 0);

  async function handleSave(next: EvalProfile): Promise<void> {
    setSaveError(null);
    try {
      await saveProfile(next);
      onSaveCustom(next);
    } catch (err) {
      setSaveError(t('eval.wizard.profile.saveFailed', { err: err instanceof Error ? err.message : String(err) }));
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {t('eval.wizard.profile.select')}
          <FieldInfo label={t('eval.wizard.profile.select')} help={t('eval.wizard.guide.profile')} />
        </h3>
        <p className="text-xs text-muted-foreground">{t('eval.wizard.profile.desc')}</p>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {DIMS.map((d) => (
            <span key={d} className="inline-flex items-center gap-1">
              <span className="font-mono font-semibold">{d}</span> {t(`eval.common.dim.${d}`)}
              <FieldInfo label={`${d} ${t(`eval.common.dim.${d}`)}`} help={t(`eval.wizard.profile.dimHelp.${d}`)} />
            </span>
          ))}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {profiles.map((p) => {
          const active = p.id === selectedId;
          const sum = DIMS.reduce((a, d) => a + (p.dimensionWeights[d] ?? 0), 0);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className={`rounded-lg border p-3 text-left text-xs ${active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{p.name.ko}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {p.builtIn ? t('eval.wizard.profile.builtin') : t('eval.wizard.profile.custom')}
                </span>
                {p.builtIn && (
                  <FieldInfo label={p.name.ko} help={t(`eval.wizard.profile.use.${p.id}`)} />
                )}
              </div>
              <div className="mt-1 text-muted-foreground">{p.description.ko}</div>
              {p.builtIn && (
                <div className="mt-1 text-muted-foreground">{t(`eval.wizard.profile.use.${p.id}`)}</div>
              )}
              <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded">
                {DIMS.map((d) => (
                  <div
                    key={d}
                    className="bg-primary/60"
                    style={{ width: `${sum > 0 ? ((p.dimensionWeights[d] ?? 0) / sum) * 100 : 0}%` }}
                    title={`${d}: ${p.dimensionWeights[d] ?? 0}`}
                  />
                ))}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {DIMS.map((d) => `${d} ${p.dimensionWeights[d] ?? 0}`).join(' · ')}
                {' · '}
                {p.constraints.length > 0
                  ? t('eval.wizard.profile.constraints', { n: p.constraints.length })
                  : t('eval.wizard.profile.noConstraints')}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {DIMS.map((d) => `${d} ${profile.dimensionWeights[d] ?? 0}`).join(' · ')}
          {total !== 100 ? ` (합계 ${total})` : ''}
        </span>
        <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setEditorOpen(true)}>
          {t('eval.wizard.profile.cloneEdit')}
        </Button>
      </div>
      {saveError && <div className="text-xs text-destructive">{saveError}</div>}
      <ProfileEditorDialog
        open={editorOpen}
        profile={profile}
        onClose={() => setEditorOpen(false)}
        onSave={(next) => {
          setEditorOpen(false);
          void handleSave(next);
        }}
      />
    </div>
  );
}
