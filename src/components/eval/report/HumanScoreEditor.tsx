import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { saveHumanScore } from '@/lib/eval/scorers/human';
import type { Verdict } from '@/lib/eval/types';
import { Button } from '@/components/ui/button';

export interface HumanScoreEditorProps {
  trialId: string;
  scorerKey?: string;
  onSaved?: () => void;
}

export function HumanScoreEditor({ trialId, scorerKey = 'human', onSaved }: HumanScoreEditorProps) {
  const { t } = useLanguage();
  const [pass, setPass] = useState(true);
  const [score, setScore] = useState('1');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const v = Math.max(0, Math.min(1, Number(score)));
    if (!Number.isFinite(v)) return;
    const verdict: Verdict = pass ? 'correct' : 'incorrect';
    setSaving(true);
    try {
      await saveHumanScore(trialId, scorerKey, v, verdict, note || undefined);
      setSaved(true);
      onSaved?.();
    } catch (err) {
      console.error('Failed to save human score:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border p-2.5 text-xs">
      <div className="font-semibold text-foreground">{t('eval.report.human.title')}</div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1">
          <input type="radio" checked={pass} onChange={() => setPass(true)} aria-label={t('eval.report.human.pass')} />
          {t('eval.report.human.pass')}
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={!pass} onChange={() => setPass(false)} aria-label={t('eval.report.human.fail')} />
          {t('eval.report.human.fail')}
        </label>
        <label className="flex items-center gap-1">
          {t('eval.report.human.score')}
          <input
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            className="w-16 rounded border border-border bg-background px-1.5 py-0.5"
          />
        </label>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('eval.report.human.note')}
        className="w-full rounded border border-border bg-background px-1.5 py-1"
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" className="h-6 px-2 text-[11px]" disabled={saving} onClick={() => void handleSave()}>
          {saving ? t('eval.report.human.saving') : t('eval.report.human.save')}
        </Button>
        {saved && <span className="text-[11px] text-success">{t('eval.report.human.saved')}</span>}
      </div>
    </div>
  );
}
