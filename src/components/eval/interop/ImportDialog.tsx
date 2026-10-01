import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { evalReadImportFile } from '@/lib/eval/ipc';
import { tauriPackFs } from '@/lib/eval/packs/packFs';
import { convertCsvImport } from '@/lib/eval/interop/csvImport';
import { isValidPackId, samplesToJsonl } from '@/lib/eval/interop/draft';
import {
  importHfDataset,
  presetToHfInput,
  type HfDatasetFormat,
  type HfImportInput,
} from '@/lib/eval/interop/hfImport';
import { IMPORT_PRESETS } from '@/lib/eval/interop/importPresets';
import { convertInspectJsonl } from '@/lib/eval/interop/inspectImport';
import { convertPromptfoo } from '@/lib/eval/interop/promptfooImport';
import { EVAL_CATEGORIES, type EvalCategoryId, type EvalSample } from '@/lib/eval/types';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (packId: string) => void;
}

type SourceTab = 'file' | 'hf' | 'paste';
type ImportFormat = 'auto' | 'jsonl' | 'csv' | 'yaml';

interface Converted {
  samples: EvalSample[];
  warnings: string[];
}

function detectFormat(fileName: string, text: string): 'jsonl' | 'csv' | 'yaml' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.jsonl') || lower.endsWith('.json')) return 'jsonl';
  const trimmed = text.trimStart();
  if (/^tests\s*:/m.test(trimmed.slice(0, 512))) return 'yaml';
  if (trimmed.startsWith('{')) return 'jsonl';
  return 'csv';
}

function fmt(t: (k: string) => string, template: string, vars: Record<string, string | number>): string {
  void t;
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
    template,
  );
}

export function ImportDialog({ open, onOpenChange, onSaved }: ImportDialogProps) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<SourceTab>('file');
  const [format, setFormat] = useState<ImportFormat>('auto');
  const [sourcePath, setSourcePath] = useState('');
  const [fileText, setFileText] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [packId, setPackId] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<EvalCategoryId>('Q9');
  const [licenseId, setLicenseId] = useState('imported-unknown');

  const [csvId, setCsvId] = useState('id');
  const [csvInput, setCsvInput] = useState('input');
  const [csvChoices, setCsvChoices] = useState('choices');
  const [csvTarget, setCsvTarget] = useState('target');
  const [csvMetadata, setCsvMetadata] = useState('');
  const [csvDelimiter, setCsvDelimiter] = useState('|');

  const [hfPresetId, setHfPresetId] = useState<string>('__custom');
  const [hfRepo, setHfRepo] = useState('');
  const [hfPath, setHfPath] = useState('');
  const [hfRevision, setHfRevision] = useState('main');
  const [hfFormat, setHfFormat] = useState<Exclude<HfDatasetFormat, 'parquet'>>('jsonl');
  const [hfInputCol, setHfInputCol] = useState('question');
  const [hfChoicesCol, setHfChoicesCol] = useState('choices');
  const [hfTargetCol, setHfTargetCol] = useState('answer');
  const [hfMcqAnswer, setHfMcqAnswer] = useState<HfImportInput['mcqAnswer']>('index0');

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const hfPreset = IMPORT_PRESETS.find((p) => p.id === hfPresetId) ?? null;

  async function loadFile(): Promise<void> {
    setLoading(true);
    setLoadError(null);
    try {
      const text = await evalReadImportFile(sourcePath);
      setFileText(text);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'load failed');
      setFileText(null);
    } finally {
      setLoading(false);
    }
  }

  const sourceText = tab === 'file' ? (fileText ?? '') : pastedText;
  const sourceName = tab === 'file' ? sourcePath : 'pasted.txt';

  const converted: Converted & { error: string | null } = useMemo(() => {
    if (tab === 'hf' || sourceText.trim() === '') {
      return { samples: [], warnings: [], error: null };
    }
    try {
      const resolved = format === 'auto' ? detectFormat(sourceName, sourceText) : format;
      const base = {
        packId: packId.trim() !== '' ? packId.trim() : 'preview-pack',
        title: title.trim() !== '' ? title.trim() : undefined,
        licenseId,
        category,
      };
      if (resolved === 'csv') {
        const meta = csvMetadata.split(',').map((s) => s.trim()).filter((s) => s !== '');
        const r = convertCsvImport(
          sourceText,
          {
            id: csvId.trim() !== '' ? csvId.trim() : undefined,
            input: csvInput.trim(),
            choices: csvChoices.trim() !== '' ? csvChoices.trim() : undefined,
            target: csvTarget.trim() !== '' ? csvTarget.trim() : undefined,
            metadata: meta.length > 0 ? meta : undefined,
          },
          { ...base, choicesDelimiter: csvDelimiter },
        );
        return { samples: r.samples, warnings: r.warnings, error: null };
      }
      if (resolved === 'yaml') {
        const r = convertPromptfoo(sourceText, base);
        return { samples: r.samples, warnings: r.warnings, error: null };
      }
      const r = convertInspectJsonl(sourceText, base);
      return { samples: r.samples, warnings: r.warnings, error: null };
    } catch (err) {
      return { samples: [], warnings: [], error: err instanceof Error ? err.message : 'convert failed' };
    }
  }, [
    tab, sourceText, sourceName, format, packId, title, licenseId, category,
    csvId, csvInput, csvChoices, csvTarget, csvMetadata, csvDelimiter,
  ]);

  const packIdValid = isValidPackId(packId.trim());

  async function saveFilePack(): Promise<void> {
    if (!packIdValid) return;
    setSaving(true);
    setStatus(null);
    try {
      const resolved = format === 'auto' ? detectFormat(sourceName, sourceText) : format;
      const base = {
        packId: packId.trim(),
        title: title.trim() !== '' ? title.trim() : undefined,
        licenseId,
        category,
      };
      let samples: EvalSample[];
      let manifest: unknown;
      if (resolved === 'csv') {
        const meta = csvMetadata.split(',').map((s) => s.trim()).filter((s) => s !== '');
        const r = convertCsvImport(
          sourceText,
          {
            id: csvId.trim() !== '' ? csvId.trim() : undefined,
            input: csvInput.trim(),
            choices: csvChoices.trim() !== '' ? csvChoices.trim() : undefined,
            target: csvTarget.trim() !== '' ? csvTarget.trim() : undefined,
            metadata: meta.length > 0 ? meta : undefined,
          },
          { ...base, choicesDelimiter: csvDelimiter },
        );
        samples = r.samples;
        manifest = r.manifest;
      } else if (resolved === 'yaml') {
        const r = convertPromptfoo(sourceText, base);
        samples = r.samples;
        manifest = r.manifest;
      } else {
        const r = convertInspectJsonl(sourceText, base);
        samples = r.samples;
        manifest = r.manifest;
      }
      await tauriPackFs.write('user', packId.trim(), [
        { relPath: 'manifest.json', content: JSON.stringify(manifest, null, 2) },
        { relPath: 'samples.jsonl', content: samplesToJsonl(samples) },
      ]);
      setStatus(fmt(t, t('eval.interop.import.saved'), { packId: packId.trim(), n: samples.length }));
      onSaved?.(packId.trim());
    } catch (err) {
      setStatus(fmt(t, t('eval.interop.import.saveError'), { err: err instanceof Error ? err.message : 'save failed' }));
    } finally {
      setSaving(false);
    }
  }

  async function saveHfPack(): Promise<void> {
    if (!packIdValid) return;
    setSaving(true);
    setStatus(null);
    try {
      let input: HfImportInput;
      if (hfPreset) {
        const lifted = presetToHfInput(hfPreset, {
          format: hfFormat,
          fieldMap: { input: hfInputCol.trim(), choices: hfChoicesCol.trim(), target: hfTargetCol.trim() },
          packId: packId.trim(),
          mcqAnswer: hfMcqAnswer,
        });
        if (!lifted) {
          setStatus(t('eval.interop.import.hfUnsupportedPreset'));
          return;
        }
        input = {
          ...lifted,
          path: hfPath.trim() !== '' ? hfPath.trim() : lifted.path,
          revision: hfRevision.trim() !== '' ? hfRevision.trim() : lifted.revision,
        };
      } else {
        input = {
          repo: hfRepo.trim(),
          path: hfPath.trim(),
          revision: hfRevision.trim() !== '' ? hfRevision.trim() : 'main',
          format: hfFormat,
          fieldMap: { input: hfInputCol.trim(), choices: hfChoicesCol.trim(), target: hfTargetCol.trim() },
          mcqAnswer: hfMcqAnswer,
          packId: packId.trim(),
          title: title.trim() !== '' ? title.trim() : undefined,
          licenseId,
          category,
        };
      }
      const result = await importHfDataset(input);
      setStatus(fmt(t, t('eval.interop.import.saved'), { packId: result.packId, n: result.sampleCount }));
      onSaved?.(result.packId);
    } catch (err) {
      setStatus(fmt(t, t('eval.interop.import.saveError'), { err: err instanceof Error ? err.message : 'save failed' }));
    } finally {
      setSaving(false);
    }
  }

  const preview = converted.samples.slice(0, 5);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">{t('eval.interop.import.title')}</DialogTitle>
          <DialogDescription className="text-xs">
            {t('eval.interop.import.desc')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(['file', 'hf', 'paste'] as SourceTab[]).map((id) => (
            <Button
              key={id}
              size="sm"
              variant={tab === id ? 'default' : 'ghost'}
              className="flex-1"
              onClick={() => setTab(id)}
            >
              {t(`eval.interop.import.tab${id === 'file' ? 'File' : id === 'hf' ? 'Hf' : 'Paste'}`)}
            </Button>
          ))}
        </div>

        {tab === 'file' && (
          <div className="flex gap-2">
            <Input
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              placeholder={t('eval.interop.import.sourcePathPh')}
              className="h-8 text-xs"
            />
            <Button size="sm" variant="outline" disabled={loading || sourcePath.trim() === ''} onClick={() => void loadFile()}>
              {loading ? t('eval.interop.import.loading') : t('eval.interop.import.load')}
            </Button>
          </div>
        )}
        {tab === 'paste' && (
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder={t('eval.interop.import.pastePh')}
            className="min-h-28 w-full rounded-lg border border-border bg-background p-2 font-mono text-[11px]"
          />
        )}
        {loadError && <p className="text-xs text-destructive">{fmt(t, t('eval.interop.import.loadError'), { err: loadError })}</p>}

        {tab === 'hf' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 flex flex-col gap-1 text-xs">
              {t('eval.interop.import.hfPreset')}
              <select
                value={hfPresetId}
                onChange={(e) => {
                  const id = e.target.value;
                  setHfPresetId(id);
                  const preset = IMPORT_PRESETS.find((p) => p.id === id);
                  if (preset && preset.source.kind === 'hf') {
                    setHfRepo(preset.source.repo);
                    setHfPath(preset.source.path ?? '');
                    setHfRevision(preset.source.revision ?? 'main');
                  }
                }}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
              >
                <option value="__custom">{t('eval.interop.import.hfPresetNone')}</option>
                {IMPORT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.id} ({p.source.kind})</option>
                ))}
              </select>
            </label>
            {hfPreset && hfPreset.source.kind !== 'hf' && (
              <p className="col-span-2 text-xs text-warning">{t('eval.interop.import.hfUnsupportedPreset')}</p>
            )}
            <label className="flex flex-col gap-1 text-xs">
              {t('eval.interop.import.hfRepo')}
              <Input value={hfRepo} onChange={(e) => setHfRepo(e.target.value)} className="h-8 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {t('eval.interop.import.hfPath')}
              <Input value={hfPath} onChange={(e) => setHfPath(e.target.value)} className="h-8 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {t('eval.interop.import.hfRevision')}
              <Input value={hfRevision} onChange={(e) => setHfRevision(e.target.value)} className="h-8 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {t('eval.interop.import.hfFormat')}
              <select
                value={hfFormat}
                onChange={(e) => setHfFormat(e.target.value as Exclude<HfDatasetFormat, 'parquet'>)}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
              >
                <option value="jsonl">JSONL</option>
                <option value="csv">CSV</option>
              </select>
            </label>
            <p className="col-span-2 text-[11px] text-muted-foreground">{t('eval.interop.import.parquetNote')}</p>
            <div className="col-span-2 grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1 text-xs">
                input
                <Input value={hfInputCol} onChange={(e) => setHfInputCol(e.target.value)} className="h-8 text-xs" />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                choices
                <Input value={hfChoicesCol} onChange={(e) => setHfChoicesCol(e.target.value)} className="h-8 text-xs" />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                target
                <Input value={hfTargetCol} onChange={(e) => setHfTargetCol(e.target.value)} className="h-8 text-xs" />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs">
              answer index
              <select
                value={hfMcqAnswer ?? 'letter'}
                onChange={(e) => setHfMcqAnswer(e.target.value as HfImportInput['mcqAnswer'])}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
              >
                <option value="index0">0-based index</option>
                <option value="index1">1-based index</option>
                <option value="letter">letter</option>
              </select>
            </label>
          </div>
        )}

        {tab !== 'hf' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs">
              {t('eval.interop.import.format')}
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as ImportFormat)}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
              >
                <option value="auto">{t('eval.interop.import.formatAuto')}</option>
                <option value="jsonl">JSONL</option>
                <option value="csv">CSV</option>
                <option value="yaml">promptfoo YAML</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {t('eval.interop.import.csvDelimiter')}
              <Input value={csvDelimiter} onChange={(e) => setCsvDelimiter(e.target.value)} className="h-8 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {t('eval.interop.import.csvId')}
              <Input value={csvId} onChange={(e) => setCsvId(e.target.value)} className="h-8 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {t('eval.interop.import.csvInput')}
              <Input value={csvInput} onChange={(e) => setCsvInput(e.target.value)} className="h-8 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {t('eval.interop.import.csvChoices')}
              <Input value={csvChoices} onChange={(e) => setCsvChoices(e.target.value)} className="h-8 text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {t('eval.interop.import.csvTarget')}
              <Input value={csvTarget} onChange={(e) => setCsvTarget(e.target.value)} className="h-8 text-xs" />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-xs">
              {t('eval.interop.import.csvMetadata')}
              <Input value={csvMetadata} onChange={(e) => setCsvMetadata(e.target.value)} className="h-8 text-xs" />
            </label>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs">
            {t('eval.interop.import.packId')}
            <Input
              value={packId}
              onChange={(e) => setPackId(e.target.value)}
              placeholder={t('eval.interop.import.packIdPh')}
              className="h-8 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('eval.interop.import.category')}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EvalCategoryId)}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
            >
              {EVAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('eval.interop.import.licenseId')}
            <Input value={licenseId} onChange={(e) => setLicenseId(e.target.value)} className="h-8 text-xs" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {t('eval.interop.import.titleField')}
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-xs" />
          </label>
        </div>
        {packId.trim() !== '' && !packIdValid && (
          <p className="text-xs text-destructive">{t('eval.interop.import.packIdInvalid')}</p>
        )}

        {tab !== 'hf' && (
          <div className="space-y-1.5 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span>{fmt(t, t('eval.interop.import.preview'), { n: preview.length })}</span>
              <span className="text-muted-foreground">
                {fmt(t, t('eval.interop.import.sampleCount'), { n: converted.samples.length })}
              </span>
            </div>
            {converted.error && <p className="text-xs text-destructive">{converted.error}</p>}
            {preview.length === 0 && !converted.error && (
              <p className="text-xs text-muted-foreground">{t('eval.interop.import.previewEmpty')}</p>
            )}
            {preview.map((s) => (
              <pre key={s.id} className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[10px]">
                {JSON.stringify(s).slice(0, 500)}
              </pre>
            ))}
            <div className="text-xs">
              <span className="font-semibold">{fmt(t, t('eval.interop.import.warnings'), { n: converted.warnings.length })}</span>
              {converted.warnings.length === 0
                ? <span className="text-muted-foreground"> · {t('eval.interop.import.noWarnings')}</span>
                : (
                  <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto font-mono text-[11px] text-warning">
                    {converted.warnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
            </div>
          </div>
        )}

        {status && <p className="text-xs text-muted-foreground">{status}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('eval.interop.import.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!packIdValid || saving || (tab !== 'hf' && converted.samples.length === 0)}
            onClick={() => void (tab === 'hf' ? saveHfPack() : saveFilePack())}
          >
            {saving ? t('eval.interop.import.saving') : t('eval.interop.import.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImportDialog;
