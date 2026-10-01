import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { IntegrationAuditRow } from '@/lib/eval/types';

interface AuditLogTableProps {
  rows: IntegrationAuditRow[];
  integrationNameOf?: (id: string) => string;
  onClear: () => void;
}

export function AuditLogTable({ rows, integrationNameOf, onClear }: AuditLogTableProps) {
  const { t } = useLanguage();
  const visible = rows.slice(0, 200);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t('eval.integrations.auditTitle')}</h3>
        <Button variant="outline" size="sm" onClick={onClear} disabled={rows.length === 0}>
          {t('eval.integrations.auditClear')}
        </Button>
      </div>
      {visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('eval.integrations.auditEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">{t('eval.integrations.auditColIntegration')}</th>
                <th className="px-2 py-1.5 font-medium">{t('eval.integrations.auditColPurpose')}</th>
                <th className="px-2 py-1.5 font-medium">{t('eval.integrations.auditColData')}</th>
                <th className="px-2 py-1.5 font-medium text-right">{t('eval.integrations.auditColRequests')}</th>
                <th className="px-2 py-1.5 font-medium text-right">{t('eval.integrations.auditColBytes')}</th>
                <th className="px-2 py-1.5 font-medium">{t('eval.integrations.auditColStatus')}</th>
                <th className="px-2 py-1.5 font-medium">{t('eval.integrations.auditColTime')}</th>
                <th className="px-2 py-1.5 font-medium">{t('eval.integrations.auditColError')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className="border-b border-border/50 last:border-0">
                  <td className="px-2 py-1.5 font-medium">{integrationNameOf?.(row.integrationId) ?? row.integrationId}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">{row.purpose}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">{row.dataClasses.join(', ')}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{row.requestCount}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{row.bytesSent}</td>
                  <td className="px-2 py-1.5">
                    <span className={row.status === 'ok' ? 'text-primary' : 'text-destructive'}>
                      {row.status === 'ok' ? t('eval.integrations.statusOk') : t('eval.integrations.statusError')}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">{row.createdAt}</td>
                  <td className="px-2 py-1.5 max-w-48 truncate text-muted-foreground" title={row.error ?? ''}>
                    {row.error ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AuditLogTable;
