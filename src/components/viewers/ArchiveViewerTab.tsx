import { useEffect, useState } from 'react';
import { ExternalLink, PackageOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useJobs } from '@/lib/commander/useJobs';
import { fcArchiveList, fcOpenDefault, fcUnzip } from '@/lib/commander/ipc';
import type { FcArchiveEntry } from '@/lib/commander/types';
import { formatBytes } from '@/lib/commander/format';

export function ArchiveViewerTab({ tab }: { tab: WorkspaceTab }) {
  const { t } = useLanguage();
  const { registerJob } = useJobs();
  const filePath = (tab.meta?.filePath as string) ?? '';
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const [entries, setEntries] = useState<FcArchiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fcArchiveList(filePath)
      .then((list) => {
        if (active) setEntries(list);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filePath]);

  const extractAll = () => {
    const sep = filePath.includes('\\') ? '\\' : '/';
    const dest = filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
    void fcUnzip(filePath, dest || filePath)
      .then((id) => registerJob(id, 'unzip', `${t('explorer.ctxUnzip')}${sep}${fileName}`))
      .catch(() => {});
  };

  return (
    <div className="flex flex-col h-full w-full min-h-0 bg-editor">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0">
        <span className="text-xs font-medium truncate flex-1" title={filePath}>
          {fileName}
        </span>
        <Button variant="outline" size="sm" onClick={extractAll} className="text-xs h-7 gap-1.5">
          <PackageOpen className="h-3.5 w-3.5" />
          {t('viewers.extractAll')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fcOpenDefault(filePath).catch(() => {})}
          className="text-xs h-7 gap-1.5"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('viewers.openDefault')}
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <p className="p-4 text-xs text-muted-foreground">{t('explorer.loading')}</p>
        ) : error ? (
          <p className="p-4 text-xs text-destructive">{t('viewers.loadFailed', { err: error })}</p>
        ) : (
          <div className="min-w-[480px]">
            <div className="grid grid-cols-[1fr_90px] gap-1 border-b border-border sticky top-0 bg-tabbar px-2 py-1 text-[11px] font-medium text-muted-foreground">
              <span>{t('explorer.colName')}</span>
              <span className="text-right">{t('explorer.colSize')}</span>
            </div>
            {entries.map((entry) => (
              <div
                key={entry.name}
                className="grid grid-cols-[1fr_90px] gap-1 px-2 py-1 text-xs border-b border-border/30"
              >
                <span className="truncate font-mono text-[11px]" title={entry.name}>
                  {entry.name}
                </span>
                <span className="text-right font-mono text-[11px] text-muted-foreground">
                  {entry.is_dir ? '' : formatBytes(entry.size)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ArchiveViewerTab;
