import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import type { ExternalIntegration, ExternalTransferPlan } from '@/lib/eval/types';

interface ExternalTransferSummaryProps {
  transfers: ExternalTransferPlan[];
  integrations: ExternalIntegration[];
  consented: boolean;
  onConsentChange: (consented: boolean, at: string | null) => void;
  declined: boolean;
  onDecline: () => void;
  proceedWithoutExternal: boolean;
  onProceedWithoutChange: (v: boolean) => void;
}

export function ExternalTransferSummary({
  transfers,
  integrations,
  consented,
  onConsentChange,
  declined,
  onDecline,
  proceedWithoutExternal,
  onProceedWithoutChange,
}: ExternalTransferSummaryProps) {
  const { t } = useLanguage();
  const nameOf = (id: string): string => integrations.find((it) => it.id === id)?.name ?? id;

  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <div className="font-semibold">{t('eval.wizard.external.title')}</div>
      <p className="text-muted-foreground">{t('eval.wizard.external.desc')}</p>
      {transfers.length === 0 && <div className="text-muted-foreground">{t('eval.wizard.external.none')}</div>}
      {transfers.map((tr, i) => (
        <div key={i} className="rounded border border-border px-2 py-1.5">
          <div className="font-semibold">{nameOf(tr.integrationId)}</div>
          <div className="text-muted-foreground">
            {t(`eval.integrations.purpose.${tr.purpose}`)}
            {' · '}
            {tr.dataClasses.map((d) => t(`eval.integrations.data.${d}`)).join(', ')}
            {' · '}
            {t('eval.wizard.external.requests', { n: tr.estimatedRequests })}
            {' · '}
            {t('eval.wizard.external.tokens', { n: tr.estimatedInputTokens })}
          </div>
        </div>
      ))}
      {transfers.length > 0 && !proceedWithoutExternal && (
        <>
          <label className="flex items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => onConsentChange(e.target.checked, e.target.checked ? new Date().toISOString() : null)}
            />
            {t('eval.wizard.external.consent')}
          </label>
          {!consented && (
            <Button type="button" size="sm" variant="outline" onClick={onDecline}>
              {t('eval.wizard.external.decline')}
            </Button>
          )}
        </>
      )}
      {declined && !proceedWithoutExternal && (
        <div className="space-y-1 rounded border border-amber-500/40 p-2">
          <div className="text-muted-foreground">{t('eval.wizard.external.proceedWithoutNote')}</div>
          <Button type="button" size="sm" variant="outline" onClick={() => onProceedWithoutChange(true)}>
            {t('eval.wizard.external.proceedWithout')}
          </Button>
        </div>
      )}
      {proceedWithoutExternal && (
        <Button type="button" size="sm" variant="ghost" onClick={() => onProceedWithoutChange(false)}>
          × {t('eval.wizard.external.proceedWithout')}
        </Button>
      )}
    </div>
  );
}
