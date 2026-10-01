import { useCallback, useEffect, useState } from 'react';
import { Plug, Pencil, Trash2, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type {
  ExternalIntegration,
  IntegrationAuditRow,
  IntegrationSettings,
} from '@/lib/eval/types';
import { CONSENT_TEXT_VERSION } from '@/lib/eval/constants';
import { classifyEndpoint } from '@/lib/eval/integrations/endpointClass';
import {
  clearAudit,
  deleteIntegration,
  getIntegrationSettings,
  listAudit,
  listIntegrations,
  saveIntegration,
  saveIntegrationSettings,
} from '@/lib/db/repositories/integrationsRepo';
import { checkProviderModel } from '@/lib/llm/providerRuntime';
import { getProviderPreset } from '@/lib/llm/providers';
import { runIntegrationCli } from '@/lib/eval/integrations/cliRunner';
import { AuditLogTable } from '@/components/eval/integrations/AuditLogTable';
import { IntegrationEditorDialog } from '@/components/eval/integrations/IntegrationEditorDialog';

export function SettingsIntegrations() {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<IntegrationSettings | null>(null);
  const [integrations, setIntegrations] = useState<ExternalIntegration[]>([]);
  const [audit, setAudit] = useState<IntegrationAuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ExternalIntegration | null>(null);
  const [newHost, setNewHost] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [s, list, log] = await Promise.all([
        getIntegrationSettings(),
        listIntegrations(),
        listAudit({ limit: 200 }),
      ]);
      setSettings(s);
      setIntegrations(list);
      setAudit(log);
    } catch (err) {
      setError(t('eval.integrations.loadFailed', { err: err instanceof Error ? err.message : String(err) }));
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [s, list, log] = await Promise.all([
          getIntegrationSettings(),
          listIntegrations(),
          listAudit({ limit: 200 }),
        ]);
        if (!active) return;
        setSettings(s);
        setIntegrations(list);
        setAudit(log);
      } catch (err) {
        if (!active) return;
        setError(t('eval.integrations.loadFailed', { err: err instanceof Error ? err.message : String(err) }));
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [t]);

  const updateSettings = async (next: IntegrationSettings) => {
    setSettings(next);
    try {
      await saveIntegrationSettings(next);
    } catch (err) {
      setError(t('eval.integrations.saveFailed', { err: err instanceof Error ? err.message : String(err) }));
    }
  };

  const handleSaveIntegration = async (draft: ExternalIntegration) => {
    await saveIntegration(draft);
    setEditorOpen(false);
    setEditing(null);
    await reload();
  };

  const handleToggleEnabled = async (integration: ExternalIntegration) => {
    await saveIntegration({ ...integration, enabled: !integration.enabled, updatedAt: new Date().toISOString() });
    await reload();
  };

  const handleDelete = async (integration: ExternalIntegration) => {
    if (!window.confirm(t('eval.integrations.deleteConfirm', { name: integration.name }))) return;
    await deleteIntegration(integration.id);
    await reload();
  };

  const handleTest = async (integration: ExternalIntegration) => {
    setTestingId(integration.id);
    setTestMsg(null);
    try {
      if (integration.kind === 'llm-api' && integration.llm) {
        const preset = getProviderPreset(integration.llm.provider);
        const result = await checkProviderModel(
          {
            kind: integration.llm.provider,
            preset,
            baseUrl: integration.llm.baseUrl,
            apiKey: integration.llm.apiKey,
            openAiCompatible: preset.openAiCompatible,
          },
          integration.llm.model,
        );
        if (result !== 'connected') throw new Error(integration.llm.model);
      } else if (integration.kind === 'agent-cli' && integration.cli) {
        const out = await runIntegrationCli({
          executablePath: integration.cli.executablePath,
          args: integration.cli.args,
          stdinText: 'Fortress connection test',
          promptFileText: 'Fortress connection test',
          timeoutMs: Math.min(integration.cli.timeoutMs, 30000),
        });
        if (out.timedOut || out.exitCode !== 0) {
          throw new Error(out.timedOut ? 'timed out' : `exit code ${out.exitCode}`);
        }
      }
      setTestMsg(t('eval.integrations.testOk'));
    } catch (err) {
      setTestMsg(t('eval.integrations.testFailed', { err: err instanceof Error ? err.message : String(err) }));
    } finally {
      setTestingId(null);
    }
  };

  const handleAddHost = () => {
    if (!settings || !newHost.trim()) return;
    const host = newHost.trim();
    if (settings.trustedLanHosts.includes(host)) return;
    void updateSettings({ ...settings, trustedLanHosts: [...settings.trustedLanHosts, host] });
    setNewHost('');
  };

  const handleClearAudit = async () => {
    if (!window.confirm(t('eval.integrations.auditClearConfirm'))) return;
    await clearAudit();
    await reload();
  };

  const nameOf = (id: string) => integrations.find((i) => i.id === id)?.name ?? id;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold text-foreground">{t('eval.integrations.title')}</h2>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {t('eval.integrations.desc')}
        </p>
      </div>

      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-foreground leading-relaxed">
        {t('eval.integrations.exportNotice')}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-4 shadow-xs">
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('eval.integrations.master')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('eval.integrations.masterDesc')}</p>
          </div>
          <input
            type="checkbox"
            aria-label={t('eval.integrations.master')}
            checked={settings?.masterEnabled ?? false}
            onChange={(e) => settings && void updateSettings({ ...settings, masterEnabled: e.target.checked })}
            className="h-4 w-4 shrink-0"
          />
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Plug className="h-4 w-4" />
            {t('eval.integrations.navTitle')}
          </h3>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            {t('eval.integrations.add')}
          </Button>
        </div>

        {integrations.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('eval.integrations.noIntegrations')}</p>
        ) : (
          integrations.map((integration) => {
            const endpoint =
              integration.kind === 'llm-api' && integration.llm
                ? classifyEndpoint(integration.llm.baseUrl, settings ?? { masterEnabled: false, trustedLanHosts: [], allowLocalCodeExecution: false })
                : null;
            const stale =
              integration.consent != null && integration.consent.version !== CONSENT_TEXT_VERSION;
            return (
              <div key={integration.id} className="border border-border rounded-xl p-4 bg-card/40 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{integration.name}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground font-mono">
                    {integration.kind === 'llm-api' ? t('eval.integrations.kindLlm') : t('eval.integrations.kindCli')}
                  </span>
                  {endpoint && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground font-mono">
                      {endpoint === 'local'
                        ? t('eval.integrations.endpointLocal')
                        : endpoint === 'lan-trusted'
                          ? t('eval.integrations.endpointLan')
                          : t('eval.integrations.endpointExternal')}
                      {integration.llm ? ` · ${integration.llm.baseUrl}` : ''}
                    </span>
                  )}
                  <span className={`ml-auto text-[11px] font-medium ${integration.enabled ? 'text-primary' : 'text-muted-foreground'}`}>
                    {integration.enabled ? t('eval.integrations.enabled') : t('eval.integrations.disabled')}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground space-y-0.5">
                  <p>
                    {t('eval.integrations.colPurposes')}: {integration.allowedPurposes.join(', ')}
                  </p>
                  <p>
                    {t('eval.integrations.colData')}: {integration.allowedDataClasses.join(', ')}
                  </p>
                  <p>
                    {t('eval.integrations.colConsent')}:{' '}
                    {integration.consent ? integration.consent.grantedAt : t('eval.integrations.noConsent')}
                    {stale && (
                      <span className="ml-1 text-warning font-medium">
                        {t('eval.integrations.staleConsent')}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => void handleTest(integration)} disabled={testingId === integration.id}>
                    <FlaskConical className="h-3.5 w-3.5" />
                    {t('eval.integrations.test')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(integration);
                      setEditorOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t('eval.integrations.edit')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleDelete(integration)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('eval.integrations.delete')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void handleToggleEnabled(integration)}>
                    {integration.enabled ? t('eval.integrations.disable') : t('eval.integrations.enable')}
                  </Button>
                </div>
              </div>
            );
          })
        )}
        {testMsg && <p className="text-xs text-muted-foreground">{testMsg}</p>}
      </div>

      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-3 shadow-xs">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('eval.integrations.trustedLan')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{t('eval.integrations.trustedLanDesc')}</p>
        </div>
        <div className="flex gap-2">
          <Input
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            placeholder={t('eval.integrations.trustedLanPlaceholder')}
            className="text-xs font-mono flex-1"
          />
          <Button variant="outline" size="sm" onClick={handleAddHost}>
            {t('eval.integrations.trustedLanAdd')}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(settings?.trustedLanHosts ?? []).map((host) => (
            <span key={host} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted text-xs font-mono">
              {host}
              <button
                type="button"
                aria-label={`${t('eval.integrations.trustedLanRemove')}: ${host}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() =>
                  settings &&
                  void updateSettings({
                    ...settings,
                    trustedLanHosts: settings.trustedLanHosts.filter((h) => h !== host),
                  })
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="border border-border rounded-xl p-5 bg-card/40 space-y-2 shadow-xs">
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('eval.integrations.allowLocalCode')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('eval.integrations.allowLocalCodeDesc')}</p>
          </div>
          <input
            type="checkbox"
            aria-label={t('eval.integrations.allowLocalCode')}
            checked={settings?.allowLocalCodeExecution ?? false}
            onChange={(e) => settings && void updateSettings({ ...settings, allowLocalCodeExecution: e.target.checked })}
            className="h-4 w-4 shrink-0"
          />
        </label>
        <p className="text-[11px] text-warning font-medium">{t('eval.integrations.localCodeRisk')}</p>
      </div>

      <div className="border border-border rounded-xl p-5 bg-card/40 shadow-xs">
        <AuditLogTable rows={audit} integrationNameOf={nameOf} onClear={() => void handleClearAudit()} />
      </div>

      {editorOpen && (
        <IntegrationEditorDialog
          open
          initial={editing}
          onClose={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
          onSave={handleSaveIntegration}
        />
      )}
    </div>
  );
}

export default SettingsIntegrations;
