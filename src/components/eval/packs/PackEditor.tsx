import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { tauriPackFs } from '@/lib/eval/packs/packFs';
import {
  EVAL_CATEGORIES,
  EvalPackManifestSchema,
  EvalSampleSchema,
  type EvalCategoryId,
  type EvalPackManifest,
  type EvalSample,
  type MetricSpec,
  type PackScope,
} from '@/lib/eval/types';

interface PackEditorProps {
  scope: Exclude<PackScope, 'builtin'>;
  /** Immutable once set; empty string = new pack (id editable until first save). */
  packId: string;
  initialManifest?: EvalPackManifest | null;
  initialSamplesText?: string;
  onSaved?: (packId: string) => void;
  onClose?: () => void;
}

interface LineError {
  line: number;
  message: string;
}

const DEFAULT_METRICS: MetricSpec[] = [
  {
    id: 'accuracy',
    description: { ko: '정확도', en: 'Accuracy' },
    source: 'score',
    aggregation: 'mean',
    lowerIsBetter: false,
    scoreType: 'binary',
    range: { min: 0, max: 1 },
    normalization: { kind: 'baseline', baseline: 0, ceiling: 1 },
    countsTowardComposite: true,
  },
];

function validateSamplesJsonl(text: string): { samples: EvalSample[]; errors: LineError[] } {  const samples: EvalSample[] = [];
  const errors: LineError[] = [];
  if (text.trim().length === 0) return { samples, errors };
  text.split('\n').forEach((raw, idx) => {
    const lineNo = idx + 1;
    if (raw.trim().length === 0) return;
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch (err) {
      errors.push({ line: lineNo, message: err instanceof Error ? err.message : 'invalid JSON' });
      return;
    }
    const parsed = EvalSampleSchema.safeParse(value);
    if (!parsed.success) {
      errors.push({
        line: lineNo,
        message: parsed.error.issues[0]?.message ?? 'invalid sample',
      });
      return;
    }
    samples.push(parsed.data);
  });
  return { samples, errors };
}

export function PackEditor({
  scope,
  packId: fixedPackId,
  initialManifest,
  initialSamplesText,
  onSaved,
  onClose,
}: PackEditorProps) {
  const { t } = useLanguage();
  const workspace = useSafeWorkspace();
  const workspaceRoot = workspace?.workspaceRoot ?? undefined;
  const isNew = fixedPackId.length === 0;

  const [packId, setPackId] = useState(fixedPackId);
  const [titleKo, setTitleKo] = useState(initialManifest?.title.ko ?? '');
  const [titleEn, setTitleEn] = useState(initialManifest?.title.en ?? '');
  const [descKo, setDescKo] = useState(initialManifest?.description.ko ?? '');
  const [descEn, setDescEn] = useState(initialManifest?.description.en ?? '');
  const [category, setCategory] = useState<EvalCategoryId>(initialManifest?.category ?? 'Q9');
  const [smoke, setSmoke] = useState(String(initialManifest?.tiers.smoke ?? 5));
  const [standard, setStandard] = useState(String(initialManifest?.tiers.standard ?? 20));
  const [full, setFull] = useState(
    initialManifest?.tiers.full === 'all' ? 'all' : String(initialManifest?.tiers.full ?? 'all'),
  );
  const [samplesText, setSamplesText] = useState(initialSamplesText ?? '');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { errors: lineErrors, samples } = useMemo(
    () => validateSamplesJsonl(samplesText),
    [samplesText],
  );

  async function handleSave(): Promise<void> {
    setFormError(null);
    setSaved(false);
    const id = packId.trim();
    const smokeN = Number(smoke);
    const standardN = Number(standard);
    const fullV = full.trim() === 'all' ? 'all' : Number(full);
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) {
      setFormError(t('eval.editor.invalidManifest'));
      return;
    }
    if (
      titleKo.trim().length === 0 ||
      titleEn.trim().length === 0 ||
      !Number.isInteger(smokeN) ||
      smokeN <= 0 ||
      !Number.isInteger(standardN) ||
      standardN <= 0 ||
      !(fullV === 'all' || (Number.isInteger(fullV) && fullV > 0))
    ) {
      setFormError(t('eval.editor.invalidManifest'));
      return;
    }
    const manifest: EvalPackManifest = {
      ...(initialManifest as EvalPackManifest),
      schemaVersion: '1.0',
      id,
      version: initialManifest?.version ?? '0.1.0',
      title: { ko: titleKo.trim(), en: titleEn.trim() },
      description: {
        ko: descKo.trim().length > 0 ? descKo.trim() : titleKo.trim(),
        en: descEn.trim().length > 0 ? descEn.trim() : titleEn.trim(),
      },
      category,
      lang: initialManifest?.lang ?? ['ko'],
      license: initialManifest?.license ?? { id: 'personal' },
      kind: initialManifest?.kind ?? 'single_turn',
      source: { type: 'jsonl', file: 'samples.jsonl' },
      scorers: initialManifest?.scorers ?? [],
      metrics: initialManifest?.metrics ?? DEFAULT_METRICS,
      tiers: { smoke: smokeN, standard: standardN, full: fullV },
      defaults: {
        timeoutSec: initialManifest?.defaults.timeoutSec ?? 180,
        maxTurns: initialManifest?.defaults.maxTurns ?? 12,
        epochs: initialManifest?.defaults.epochs ?? 1,
        circular: initialManifest?.defaults.circular ?? false,
      },
      requires: {
        toolCalling: initialManifest?.requires.toolCalling ?? false,
        logprobs: initialManifest?.requires.logprobs ?? false,
        codeRuntime: initialManifest?.requires.codeRuntime,
        minContextTokens: initialManifest?.requires.minContextTokens,
      },
      trusted: false,
    };
    const parsed = EvalPackManifestSchema.safeParse(manifest);
    if (!parsed.success) {
      setFormError(t('eval.editor.invalidManifest'));
      return;
    }
    setSaving(true);
    try {
      await tauriPackFs.write(scope, id, [
        { relPath: 'manifest.json', content: JSON.stringify(parsed.data, null, 2) },
        { relPath: 'samples.jsonl', content: samplesText },
      ], workspaceRoot);
      setSaved(true);
      onSaved?.(id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  const fieldClass = 'h-8 text-xs';
  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold">
        {isNew ? t('eval.editor.newPack') : `${t('eval.editor.title')}: ${fixedPackId}`}
      </h2>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{t('eval.editor.packId')}</span>
        <Input
          value={packId}
          onChange={(e) => setPackId(e.target.value)}
          disabled={!isNew}
          className={`font-mono ${fieldClass}`}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t('eval.editor.titleKo')}</span>
          <Input value={titleKo} onChange={(e) => setTitleKo(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t('eval.editor.titleEn')}</span>
          <Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t('eval.editor.descKo')}</span>
          <Input value={descKo} onChange={(e) => setDescKo(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t('eval.editor.descEn')}</span>
          <Input value={descEn} onChange={(e) => setDescEn(e.target.value)} className={fieldClass} />
        </label>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t('eval.editor.category')}</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as EvalCategoryId)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {EVAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t('eval.editor.tierSmoke')}</span>
          <Input value={smoke} onChange={(e) => setSmoke(e.target.value)} className={fieldClass} inputMode="numeric" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t('eval.editor.tierStandard')}</span>
          <Input value={standard} onChange={(e) => setStandard(e.target.value)} className={fieldClass} inputMode="numeric" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t('eval.editor.tierFull')}</span>
          <Input value={full} onChange={(e) => setFull(e.target.value)} className={fieldClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">
          {t('eval.editor.samples')} ({samples.length})
        </span>
        <textarea
          value={samplesText}
          onChange={(e) => setSamplesText(e.target.value)}
          rows={12}
          spellCheck={false}
          className="rounded-md border border-input bg-background p-2 font-mono text-[11px] leading-relaxed"
        />
      </label>
      {lineErrors.length > 0 && (
        <ul className="max-h-28 space-y-0.5 overflow-y-auto rounded-lg border border-warning/40 bg-warning/5 p-2 font-mono text-[11px] text-warning">
          {lineErrors.map((e) => (
            <li key={e.line}>
              {t('eval.editor.lineError', { line: e.line, message: e.message })}
            </li>
          ))}
        </ul>
      )}
      {formError && <p className="text-xs text-destructive">{formError}</p>}
      {saved && <p className="text-xs text-success">{t('eval.editor.saved')}</p>}
      <div className="flex justify-end gap-2">
        {onClose && (
          <Button size="sm" variant="outline" onClick={onClose}>
            {t('eval.editor.cancel')}
          </Button>
        )}
        <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
          {saving ? t('eval.editor.saving') : t('eval.editor.save')}
        </Button>
      </div>
    </div>
  );
}

export default PackEditor;
