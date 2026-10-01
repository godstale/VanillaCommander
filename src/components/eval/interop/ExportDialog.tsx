import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { evalExportWrite } from '@/lib/eval/ipc';
import { buildTrialsCsv } from '@/lib/eval/interop/csvExport';
import { buildEeeBundle } from '@/lib/eval/interop/eeeExport';
import {
  collectReportData,
  type EvalReportData,
} from '@/components/eval/report/reportData';

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
}

function browserDownload(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ExportDialog({ open, onOpenChange, runId }: ExportDialogProps) {
  const { t } = useLanguage();
  const [data, setData] = useState<EvalReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outPath, setOutPath] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setData(null);
    collectReportData(runId).then(
      (loaded) => {
        setData(loaded);
        setLoading(false);
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : 'load failed');
        setLoading(false);
      },
    );
  }, [runId]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external eval_runs DB when the dialog opens
    reload();
  }, [open, reload]);

  const bundle = useMemo(() => (data ? buildEeeBundle(data) : null), [data]);
  const csv = useMemo(() => (data ? buildTrialsCsv(data) : null), [data]);

  async function saveViaBackend(kind: string, fileName: string, content: string): Promise<void> {
    const path = outPath.trim() !== '' ? outPath.trim() : fileName;
    setBusy(kind);
    setStatus(null);
    try {
      await evalExportWrite(path, content);
      setStatus(t('eval.interop.export.saved').replace('{path}', path));
    } catch {
      browserDownload(fileName, content);
      setStatus(t('eval.interop.export.download'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">{t('eval.interop.export.title')}</DialogTitle>
          <DialogDescription className="text-xs">
            {t('eval.interop.export.desc')}
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-xs text-muted-foreground">{t('eval.interop.export.loading')}</p>}
        {error && <p className="text-xs text-destructive">{t('eval.interop.export.loadError').replace('{err}', error)}</p>}
        {data && bundle && (
          <div className="space-y-2 text-xs">
            <p className="text-muted-foreground">
              {t('eval.interop.export.summary')
                .replace('{trials}', String(data.trials.length))
                .replace('{scores}', String(data.scores.length))
                .replace('{candidates}', String(data.candidates.length))}
            </p>
            {bundle.redactedPacks.length > 0 && (
              <p className="text-warning">
                {t('eval.interop.export.gpqaNote').replace('{n}', String(bundle.redactedPacks.length))}
              </p>
            )}
            <label className="flex flex-col gap-1">
              {t('eval.interop.export.outPath')}
              <Input
                value={outPath}
                onChange={(e) => setOutPath(e.target.value)}
                placeholder={bundle.evaluationFileName}
                className="h-8 font-mono text-xs"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void saveViaBackend('eee', bundle.evaluationFileName, JSON.stringify(bundle.evaluation, null, 2))}
              >
                {busy === 'eee' ? t('eval.interop.export.saving') : t('eval.interop.export.eeeJson')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void saveViaBackend('samples', bundle.samplesFileName, bundle.samplesJsonl)}
              >
                {busy === 'samples' ? t('eval.interop.export.saving') : t('eval.interop.export.samplesJsonl')}
              </Button>
              {csv !== null && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void saveViaBackend('csv', `${runId}_trials.csv`, csv)}
                >
                  {busy === 'csv' ? t('eval.interop.export.saving') : t('eval.interop.export.trialsCsv')}
                </Button>
              )}
            </div>
            {status && <p className="text-muted-foreground">{status}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('eval.interop.export.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ExportDialog;
