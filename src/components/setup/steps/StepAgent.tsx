import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useAgents } from '@/lib/context/AgentsContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { DEFAULT_AGENT } from '@/lib/agent/defaultAgent';
import { APP_DEFAULT_BUILTIN_TOOLS, APP_DEFAULT_SKILLS, APP_DEFAULT_TEMPERATURE } from '@/lib/agent/defaults';
import { LLM_PROVIDER_PRESETS } from '@/lib/llm/providers';
import { listProviderModelsWithFallback } from '@/lib/llm/providerRuntime';

export function StepAgent({ onApply }: { onApply: (apply: () => Promise<void>) => void }) {
  const { t } = useLanguage();
  const { agents, defaultAgent, createAgent, updateAgent } = useAgents();
  const { settings } = useSettings();
  const [baseUrl, setBaseUrl] = useState(settings.ollamaBaseUrl);
  const [model, setModel] = useState(defaultAgent.model);
  const [fetched, setFetched] = useState<{ url: string; models: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const checking = fetched?.url !== baseUrl;
  const models = checking ? null : (fetched?.models ?? []);

  useEffect(() => {
    if (fetched?.url === baseUrl) return;
    let active = true;
    const preset = LLM_PROVIDER_PRESETS.ollama;
    void listProviderModelsWithFallback({
      kind: 'ollama',
      preset,
      baseUrl,
      apiKey: undefined,
      openAiCompatible: preset.openAiCompatible,
    }).then(
      (res) => {
        if (active) setFetched({ url: baseUrl, models: res.models.map((m) => m.name) });
      },
      () => {
        if (active) setFetched({ url: baseUrl, models: [] });
      },
    );
    return () => {
      active = false;
    };
  }, [baseUrl, fetched?.url]);

  useEffect(() => {
    onApply(async () => {
      const chosen = model.trim() || DEFAULT_AGENT.model;
      const url = baseUrl.trim() || undefined;
      try {
        if (agents.length === 0) {
          await createAgent({
            name: DEFAULT_AGENT.name,
            description: DEFAULT_AGENT.description,
            systemPrompt: DEFAULT_AGENT.systemPrompt,
            model: chosen,
            temperature: APP_DEFAULT_TEMPERATURE,
            contextSize: DEFAULT_AGENT.contextSize,
            reserveTokens: DEFAULT_AGENT.reserveTokens,
            keepRecentTokens: DEFAULT_AGENT.keepRecentTokens,
            enabledSkills: [...APP_DEFAULT_SKILLS],
            enabledBuiltinTools: [...APP_DEFAULT_BUILTIN_TOOLS],
            approvalMode: DEFAULT_AGENT.approvalMode,
            reasoning: DEFAULT_AGENT.reasoning,
            reasoningEffort: DEFAULT_AGENT.reasoningEffort,
            llmProvider: 'ollama',
            llmBaseUrl: url,
            autoMonitor: true,
            isDefault: true,
          });
          setNotice(t('setup.agent.created'));
        } else {
          await updateAgent(defaultAgent.id, { model: chosen, llmBaseUrl: url });
          setNotice(t('setup.agent.updated'));
        }
        setError(null);
      } catch (err) {
        setError(t('setup.agent.failed', { err: err instanceof Error ? err.message : String(err) }));
        throw err;
      }
    });
  }, [onApply, agents.length, baseUrl, model, createAgent, updateAgent, defaultAgent.id, t]);

  return (
    <div className="space-y-4 text-xs">
      <div>
        <h3 className="text-sm font-semibold">{t('setup.agent.title')}</h3>
        <p className="text-xs text-muted-foreground mt-1">{t('setup.agent.desc')}</p>
      </div>
      <div className="space-y-1.5">
        <label className="font-medium">{t('setup.agent.baseUrl')}</label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="text-xs font-mono"
        />
      </div>
      <div className="space-y-1.5">
        <label className="font-medium">{t('setup.agent.model')}</label>
        {models === null ? (
          <p className="text-muted-foreground">{t('setup.agent.checking')}</p>
        ) : (
          <>
            {models.length > 0 ? (
              <select
                value={models.includes(model) ? model : ''}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono"
              >
                <option value="">{t('setup.agent.disconnected')}</option>
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <p className="text-warning">{t('setup.agent.disconnected')}</p>
            )}
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="text-xs font-mono"
              placeholder={DEFAULT_AGENT.model}
            />
            {models.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {t('setup.agent.connected', { n: String(models.length) })}
              </p>
            )}
          </>
        )}
      </div>
      {error && <p className="text-destructive">{error}</p>}
      {notice && <p className="text-success">{notice}</p>}
    </div>
  );
}
