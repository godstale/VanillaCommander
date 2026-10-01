import { ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/lib/context/WorkspaceContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export function TrustWorkspaceDialog() {
  const { t } = useLanguage();
  const {
    workspaceRoot,
    trustModalOpen,
    setTrustModalOpen,
    trustCurrentWorkspace,
    rejectCurrentWorkspace,
  } = useWorkspace();

  if (!workspaceRoot) return null;

  return (
    <Dialog open={trustModalOpen} onOpenChange={setTrustModalOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-warning mb-1">
            <ShieldAlert className="h-5 w-5" />
            <DialogTitle className="text-base font-semibold text-foreground">
              {t('trust.title')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            {t('trust.desc')}
          </DialogDescription>
        </DialogHeader>

        <div className="p-2.5 rounded-lg bg-muted/50 border border-border/60 text-xs font-mono break-all text-muted-foreground">
          {workspaceRoot}
        </div>

        <DialogFooter className="flex flex-row justify-end gap-2 sm:justify-end pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={rejectCurrentWorkspace}
            className="text-xs"
          >
            {t('trust.decline')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={trustCurrentWorkspace}
            className="text-xs flex items-center gap-1.5 bg-primary text-primary-foreground"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>{t('trust.accept')}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
