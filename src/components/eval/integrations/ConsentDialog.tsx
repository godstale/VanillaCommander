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
import { INTEGRATION_CONSENT_TEXT_VERSION } from '@/lib/eval/integrations/consent';
import type { DataClass, IntegrationPurpose } from '@/lib/eval/types';

interface ConsentDialogProps {
  open: boolean;
  purposes: IntegrationPurpose[];
  dataClasses: DataClass[];
  onApprove: () => void;
  onDecline: () => void;
}

export function ConsentDialog({ open, purposes, dataClasses, onApprove, onDecline }: ConsentDialogProps) {
  const { t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onDecline(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{t('eval.integrations.consentTitle')}</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {t('eval.integrations.consentBody')}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs space-y-1.5">
          <div className="font-mono text-[11px] text-muted-foreground">
            {INTEGRATION_CONSENT_TEXT_VERSION}
          </div>
          <div>
            <span className="font-semibold">{t('eval.integrations.consentScope')}: </span>
            <span className="text-muted-foreground">
              {purposes.map((p) => t(`eval.integrations.purpose.${p}`)).join(', ')}
              {' / '}
              {dataClasses.map((d) => t(`eval.integrations.data.${d}`)).join(', ')}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onDecline}>
            {t('eval.integrations.consentDecline')}
          </Button>
          <Button size="sm" onClick={onApprove}>
            {t('eval.integrations.consentApprove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConsentDialog;
