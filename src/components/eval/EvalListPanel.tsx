import { useState } from 'react';
import { FlaskConical, Play, Plus, FolderOpen, MoreHorizontal, RotateCcw } from 'lucide-react';
import { useEval } from '@/lib/context/EvalContext';
import { useEvalLock } from '@/lib/eval/evalLock';
import { useOpenEvalTab } from '@/lib/eval/ui/openEvalTab';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function EvalListPanel() {
  const { t } = useLanguage();
  const { runs, packs, packErrors, packsLoading, activeRunner, startRun, deleteRun, renameRun, cloneRun } = useEval();
  const lock = useEvalLock();
  const { openEvalWizard, openEvalRun, openEvalPacks } = useOpenEvalTab();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const packsNeedAttention = !packsLoading && (packs.length === 0 || packErrors.length > 0);

  const handleResume = async (runId: string) => {
    if (window.confirm(t('eval.common.panel.resume'))) {
      await startRun(runId);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          className="flex-1 gap-1.5"
          disabled={lock !== null}
          onClick={openEvalWizard}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('eval.common.panel.newEval')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="relative gap-1.5"
          onClick={openEvalPacks}
          title={packsNeedAttention ? t('eval.common.panel.managePacksAlert') : t('eval.common.panel.managePacks')}
          aria-label={packsNeedAttention ? t('eval.common.panel.managePacksAlert') : t('eval.common.panel.managePacks')}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {packsNeedAttention && (
            <span
              aria-hidden
              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground"
            >
              !
            </span>
          )}
        </Button>
      </div>

      {activeRunner && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <FlaskConical className="h-3.5 w-3.5 text-primary" />
            <span className="truncate">{t('eval.common.panel.running')}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${activeRunner.total > 0 ? Math.round((activeRunner.done / activeRunner.total) * 100) : 0}%`,
              }}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-1 h-6 px-2 text-[11px]"
            onClick={() => openEvalRun(activeRunner.runId)}
          >
            {t('eval.common.panel.open')}
          </Button>
        </div>
      )}

      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('eval.common.panel.recent')}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {runs.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('eval.common.panel.empty')}</p>
        )}
        {runs.map((run) => (
          <div
            key={run.id}
            className={cn(
              'group rounded-lg border border-border bg-card/40 p-2.5 text-xs',
              run.status === 'interrupted' && 'border-warning/40',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              {renaming === run.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    if (renameValue.trim()) void renameRun(run.id, renameValue.trim());
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && renameValue.trim()) {
                      void renameRun(run.id, renameValue.trim());
                      setRenaming(null);
                    }
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-medium text-foreground hover:underline"
                  onClick={() => openEvalRun(run.id, run.name)}
                >
                  {run.name}
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="run menu"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-xs">
                  <DropdownMenuItem onClick={() => openEvalRun(run.id, run.name)}>
                    {t('eval.common.panel.open')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setRenaming(run.id);
                      setRenameValue(run.name);
                    }}
                  >
                    {t('eval.common.panel.rename')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void cloneRun(run.id)}>
                    {t('eval.common.panel.clone')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setConfirmDelete(run.id)}
                  >
                    {t('eval.common.panel.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{formatDate(run.createdAt)}</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-px font-medium',
                  run.status === 'completed' && 'bg-success/15 text-success',
                  run.status === 'failed' && 'bg-destructive/15 text-destructive',
                  run.status === 'interrupted' && 'bg-warning/15 text-warning',
                  (run.status === 'running' || run.status === 'judging' || run.status === 'paused') &&
                    'bg-primary/15 text-primary',
                )}
              >
                {run.status}
              </span>
            </div>
            {run.status === 'interrupted' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-1.5 h-6 gap-1 px-2 text-[11px]"
                disabled={lock !== null}
                onClick={() => void handleResume(run.id)}
              >
                <RotateCcw className="h-3 w-3" />
                {t('eval.common.panel.resume')}
              </Button>
            )}
            {run.status === 'pending' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-1.5 h-6 gap-1 px-2 text-[11px]"
                disabled={lock !== null}
                onClick={() => void startRun(run.id)}
              >
                <Play className="h-3 w-3" />
                {t('eval.common.panel.start')}
              </Button>
            )}
            {confirmDelete === run.id && (
              <div className="mt-1.5 flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => {
                    void deleteRun(run.id);
                    setConfirmDelete(null);
                  }}
                >
                  {t('eval.common.panel.delete')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setConfirmDelete(null)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
