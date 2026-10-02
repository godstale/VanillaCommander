import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useWorkspace } from '@/lib/context/WorkspaceContext';

export function StepWorkFolder({ onApply }: { onApply: (apply: () => Promise<void>) => void }) {
  const { t } = useLanguage();
  const { workFolder, setWorkFolder } = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onApply(async () => {});
  }, [onApply]);

  const pick = async () => {
    setBusy(true);
    setError(null);
    try {
      const picked = await invoke<string | null>('pick_project_folder');
      if (picked) {
        const ok = await setWorkFolder(picked);
        if (!ok) {
          setError(t('setup.folder.failed', { err: 'busy' }));
        }
      }
    } catch (err) {
      setError(t('setup.folder.failed', { err: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t('setup.folder.title')}</h3>
        <p className="text-xs text-muted-foreground mt-1">{t('setup.folder.desc')}</p>
      </div>
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-warning shrink-0" />
        <span className="font-mono truncate flex-1">
          {workFolder ?? t('setup.folder.none')}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => void pick()} disabled={busy}>
          {workFolder ? t('setup.folder.change') : t('setup.folder.browse')}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
