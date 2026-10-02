import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { ConflictDecision, FcConflict } from '@/lib/commander/types';

export interface ConflictDialogProps {
  conflict: FcConflict;
  pendingCount: number;
  onResolve: (decision: ConflictDecision, applyToAll: boolean) => void;
}

export function ConflictDialog({ conflict, pendingCount, onResolve }: ConflictDialogProps) {
  const { t } = useLanguage();
  const [applyToAll, setApplyToAll] = useState(false);
  const fileName = conflict.path.split(/[\\/]/).filter(Boolean).pop() ?? conflict.path;

  const decide = (decision: ConflictDecision) => {
    onResolve(decision, pendingCount > 1 && applyToAll);
  };

  return (
    <Dialog open onOpenChange={() => decide('skip')}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{t('conflict.title')}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {t('conflict.desc', { name: fileName })}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-1.5">
          <div className="font-mono text-[11px] break-all">{conflict.path}</div>
          <div className="text-muted-foreground">
            {t('conflict.renameTo', { name: conflict.suggestedName })}
          </div>
        </div>
        {pendingCount > 1 && (
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            {t('conflict.applyToAll')}
          </label>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={() => decide('skip')}>
            {t('conflict.skip')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => decide('rename')}>
            {t('conflict.rename')}
          </Button>
          <Button size="sm" onClick={() => decide('overwrite')}>
            {t('conflict.overwrite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
