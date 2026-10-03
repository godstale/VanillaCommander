import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useJobs } from '@/lib/commander/useJobs';
import { fcStat, isFcStatResult } from '@/lib/commander/ipc';
import { formatBytes } from '@/lib/commander/format';

export interface PropertiesDialogProps {
  paths: string[];
  onClose: () => void;
}

export function PropertiesDialog({ paths, onClose }: PropertiesDialogProps) {
  const { t } = useLanguage();
  const { jobs, registerJob } = useJobs();
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fcStat(paths)
      .then((id) => {
        if (!active) return;
        setJobId(id);
        registerJob(id, 'stat', t('props.title'));
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const job = jobId ? jobs.find((j) => j.id === jobId) : undefined;
  const result = job && isFcStatResult(job.result) ? job.result : null;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{t('props.title')}</DialogTitle>
        </DialogHeader>
        <div className="text-xs space-y-1.5">
          <div className="font-mono text-[11px] break-all text-muted-foreground">
            {paths.join('\n')}
          </div>
          {error ? (
            <p className="text-destructive">{t('props.failed', { err: error })}</p>
          ) : !result ? (
            <p className="text-muted-foreground">
              {t('props.loading')}
              {job && job.doneFiles > 0 ? ` (${job.doneFiles})` : ''}
            </p>
          ) : (
            <>
              <p>{t('props.files', { n: String(result.file_count) })}</p>
              <p>{t('props.dirs', { n: String(result.dir_count) })}</p>
              <p>{t('props.size', { size: formatBytes(result.total_bytes) })}</p>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('workspace.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
