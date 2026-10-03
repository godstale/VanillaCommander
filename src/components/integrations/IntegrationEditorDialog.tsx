import { useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  DATA_CLASSES,
  INTEGRATION_PURPOSES,
  type DataClass,
  type ExternalIntegration,
  type IntegrationPurpose,
} from '@/lib/integrations/types';
import { INTEGRATION_CONSENT_TEXT_VERSION } from '@/lib/integrations/consent';
import { LLM_PROVIDER_ORDER, LLM_PROVIDER_PRESETS } from '@/lib/llm/providers';
import { listProviderModels } from '@/lib/llm/providerRuntime';
import type { LlmProviderKind } from '@/lib/types/agent';
import { ConsentDialog } from './ConsentDialog';

interface IntegrationEditorDialogProps {
  open: boolean;
  initial: ExternalIntegration | null;
  onClose: () => void;
  onSave: (integration: ExternalIntegration) => Promise<void> | void;
  /** 지정하면 종류 토글이 숨겨지고 이 종류로 고정된다 (P11-22 에이전트 편집용). */
  fixedKind?: 'agent-cli';
}

const DEFAULT_TIMEOUT_MS = 180000;

/** 외부 에이전트 CLI 프리셋 (P11-22, 비대화형 플래그 기준 — 실행 전 연결 테스트 권장). */
const CLI_PRESETS = {
  claude: {
    exe: 'claude',
    args: ['-p', '--output-format', 'json', '{promptFile}'],
    promptVia: 'stdin' as const,
    outputFormat: 'json' as const,
    jsonPath: 'result',
  },
  codex: {
    exe: 'codex',
    args: ['exec', '{promptFile}'],
    promptVia: 'file' as const,
    outputFormat: 'text' as const,
    jsonPath: '',
  },
  gemini: {
    exe: 'gemini',
    args: ['-p', '{promptFile}'],
    promptVia: 'file' as const,
    outputFormat: 'text' as const,
    jsonPath: '',
  },
} as const;

type CliPresetKey = keyof typeof CLI_PRESETS;

export function IntegrationEditorDialog({ open, initial, onClose, onSave, fixedKind }: IntegrationEditorDialogProps) {
  const { t } = useLanguage();
  // Mounted fresh on every open (parent renders conditionally), so initializers
  // seed the form from `initial` without a prop-sync effect.
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<'llm-api' | 'agent-cli'>(fixedKind ?? initial?.kind ?? 'llm-api');
  const [provider, setProvider] = useState<LlmProviderKind>(initial?.llm?.provider ?? 'openai');
  const [baseUrl, setBaseUrl] = useState(
    initial?.llm?.baseUrl ?? LLM_PROVIDER_PRESETS.openai.defaultBaseUrl,
  );
  const [model, setModel] = useState(
    initial?.llm?.model ?? LLM_PROVIDER_PRESETS.openai.defaultModel ?? '',
  );
  const [apiKey, setApiKey] = useState(initial?.llm?.apiKey ?? '');
  const [exe, setExe] = useState(initial?.cli?.executablePath ?? '');
  const [argsText, setArgsText] = useState((initial?.cli?.args ?? []).join('\n'));
  const [promptVia, setPromptVia] = useState<'stdin' | 'file'>(initial?.cli?.promptVia ?? 'stdin');
  const [outputFormat, setOutputFormat] = useState<'text' | 'json'>(initial?.cli?.outputFormat ?? 'text');
  const [jsonPath, setJsonPath] = useState(initial?.cli?.jsonPath ?? '');
  const [timeoutMs, setTimeoutMs] = useState(String(initial?.cli?.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const [purposes, setPurposes] = useState<IntegrationPurpose[]>([...(initial?.allowedPurposes ?? ['chat-agent'])]);
  const [dataClasses, setDataClasses] = useState<DataClass[]>([...(initial?.allowedDataClasses ?? ['public-bundled'])]);
  const [models, setModels] = useState<string[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [detectingExe, setDetectingExe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const toggleIn = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const handleProviderChange = (next: LlmProviderKind) => {
    setProvider(next);
    const preset = LLM_PROVIDER_PRESETS[next];
    setBaseUrl(preset.defaultBaseUrl);
    if (preset.defaultModel) setModel(preset.defaultModel);
    setModels([]);
  };

  const handleLookup = async () => {
    setLookingUp(true);
    setError(null);
    try {
      const preset = LLM_PROVIDER_PRESETS[provider];
      const list = await listProviderModels({
        kind: provider,
        preset,
        baseUrl: baseUrl.trim() || preset.defaultBaseUrl,
        apiKey: apiKey.trim() || undefined,
        openAiCompatible: preset.openAiCompatible,
      });
      setModels(list.map((m) => m.name));
    } catch (err) {
      setError(t('eval.integrations.lookupFailed', { err: err instanceof Error ? err.message : String(err) }));
    } finally {
      setLookingUp(false);
    }
  };

  const handleBrowse = async () => {
    try {
      const picked = await openFileDialog({ multiple: false, directory: false });
      if (typeof picked === 'string') setExe(picked);
    } catch {
      // dialog cancelled or unavailable; keep manual input
    }
  };

  const applyCliPreset = (key: CliPresetKey) => {
    const preset = CLI_PRESETS[key];
    setExe(preset.exe);
    setArgsText(preset.args.join('\n'));
    setPromptVia(preset.promptVia);
    setOutputFormat(preset.outputFormat);
    setJsonPath(preset.jsonPath);
    setError(null);
  };

  const handleDetectExe = async () => {
    const base = exe.trim() || 'claude';
    const name = base.split(/[\\/]/).pop() ?? base;
    setDetectingExe(true);
    setError(null);
    try {
      const found = await invoke<string>('find_executable', { name });
      setExe(found);
    } catch (err) {
      setError(t('agentForm.exeDetectFailed', { err: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDetectingExe(false);
    }
  };

  const validate = (): string | null => {
    if (!name.trim()) return t('eval.integrations.errName');
    if (kind === 'llm-api') {
      if (!baseUrl.trim()) return t('eval.integrations.errBaseUrl');
      if (!model.trim()) return t('eval.integrations.errModel');
    } else {
      if (!exe.trim()) return t('eval.integrations.errExe');
      if (promptVia === 'file' && !argsText.includes('{promptFile}')) {
        return t('eval.integrations.promptFileRequired');
      }
      if (outputFormat === 'json' && !jsonPath.trim()) {
        return t('eval.integrations.jsonPathRequired');
      }
    }
    if (purposes.length === 0 || dataClasses.length === 0) {
      return t('eval.integrations.errScope');
    }
    return null;
  };

  const buildDraft = (): ExternalIntegration => {
    const now = new Date().toISOString();
    const args = argsText.split('\n').map((a) => a.trim()).filter((a) => a.length > 0);
    const timeout = Number(timeoutMs);
    return {
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      kind,
      enabled: initial?.enabled ?? true,
      llm:
        kind === 'llm-api'
          ? {
              provider,
              baseUrl: baseUrl.trim(),
              model: model.trim(),
              apiKey: apiKey.trim() || undefined,
            }
          : undefined,
      cli:
        kind === 'agent-cli'
          ? {
              executablePath: exe.trim(),
              args,
              promptVia,
              outputFormat,
              jsonPath: outputFormat === 'json' ? jsonPath.trim() : undefined,
              timeoutMs: Number.isInteger(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
            }
          : undefined,
      allowedPurposes: purposes,
      allowedDataClasses: dataClasses,
      consent: {
        version: INTEGRATION_CONSENT_TEXT_VERSION,
        grantedAt: now,
        purposes,
        dataClasses,
      },
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    };
  };

  const handleSaveClick = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setConsentOpen(true);
  };

  const handleApprove = async () => {
    setSaving(true);
    try {
      await onSave(buildDraft());
      setConsentOpen(false);
    } catch (err) {
      setConsentOpen(false);
      setError(t('eval.integrations.saveFailed', { err: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open && !consentOpen} onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {initial ? t('eval.integrations.dialogEdit') : t('eval.integrations.dialogAdd')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="font-medium">{t('eval.integrations.fieldName')}</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="text-xs" />
            </div>

            {!fixedKind && (
            <div className="space-y-1.5">
              <label className="font-medium">{t('eval.integrations.fieldKind')}</label>
              <div className="flex gap-2">
                <Button
                  variant={kind === 'llm-api' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setKind('llm-api')}
                >
                  {t('eval.integrations.kindLlm')}
                </Button>
                <Button
                  variant={kind === 'agent-cli' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setKind('agent-cli')}
                >
                  {t('eval.integrations.kindCli')}
                </Button>
              </div>
            </div>
            )}

            {kind === 'llm-api' ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="space-y-1.5">
                  <label className="font-medium">{t('eval.integrations.fieldProvider')}</label>
                  <select
                    value={provider}
                    onChange={(e) => handleProviderChange(e.target.value as LlmProviderKind)}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                  >
                    {LLM_PROVIDER_ORDER.map((k) => (
                      <option key={k} value={k}>
                        {LLM_PROVIDER_PRESETS[k].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="font-medium">{t('eval.integrations.fieldBaseUrl')}</label>
                  <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="text-xs font-mono" />
                </div>
                <div className="space-y-1.5">
                  <label className="font-medium">{t('eval.integrations.fieldModel')}</label>
                  <div className="flex gap-2">
                    <Input value={model} onChange={(e) => setModel(e.target.value)} className="text-xs font-mono flex-1" />
                    <Button variant="outline" size="sm" onClick={() => void handleLookup()} disabled={lookingUp}>
                      {lookingUp ? '...' : t('eval.integrations.lookupModels')}
                    </Button>
                  </div>
                  {models.length > 0 && (
                    <select
                      aria-label={t('eval.integrations.fieldModel')}
                      onChange={(e) => { if (e.target.value) setModel(e.target.value); }}
                      defaultValue=""
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono"
                    >
                      <option value="">—</option>
                      {models.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="font-medium">{t('eval.integrations.fieldApiKey')}</label>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={t('eval.integrations.fieldApiKeyPlaceholder')}
                    className="text-xs font-mono"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <p className="text-[11px] text-muted-foreground">{t('eval.integrations.presetNote')}</p>
                <div className="space-y-1.5">
                  <label className="font-medium">{t('agentForm.cliPreset')}</label>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => applyCliPreset('claude')}>
                      {t('agentForm.cliPresetClaude')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => applyCliPreset('codex')}>
                      {t('agentForm.cliPresetCodex')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => applyCliPreset('gemini')}>
                      {t('agentForm.cliPresetGemini')}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="font-medium">{t('eval.integrations.fieldExe')}</label>
                  <div className="flex gap-2">
                    <Input value={exe} onChange={(e) => setExe(e.target.value)} className="text-xs font-mono flex-1" />
                    <Button variant="outline" size="sm" onClick={() => void handleDetectExe()} disabled={detectingExe}>
                      {detectingExe ? '...' : t('agentForm.detectExe')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void handleBrowse()}>
                      {t('eval.integrations.browse')}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="font-medium">{t('eval.integrations.fieldArgs')}</label>
                  <textarea
                    value={argsText}
                    onChange={(e) => setArgsText(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">{t('eval.integrations.fieldArgsHint')}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="font-medium">{t('eval.integrations.fieldPromptVia')}</label>
                    <select
                      value={promptVia}
                      onChange={(e) => setPromptVia(e.target.value as 'stdin' | 'file')}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                    >
                      <option value="stdin">{t('eval.integrations.promptViaStdin')}</option>
                      <option value="file">{t('eval.integrations.promptViaFile')}</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="font-medium">{t('eval.integrations.fieldOutput')}</label>
                    <select
                      value={outputFormat}
                      onChange={(e) => setOutputFormat(e.target.value as 'text' | 'json')}
                      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                    >
                      <option value="text">{t('eval.integrations.outputText')}</option>
                      <option value="json">{t('eval.integrations.outputJson')}</option>
                    </select>
                  </div>
                </div>
                {outputFormat === 'json' && (
                  <div className="space-y-1.5">
                    <label className="font-medium">{t('eval.integrations.fieldJsonPath')}</label>
                    <Input value={jsonPath} onChange={(e) => setJsonPath(e.target.value)} className="text-xs font-mono" placeholder="result.text" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="font-medium">{t('eval.integrations.fieldTimeout')}</label>
                  <Input type="number" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} className="text-xs font-mono" />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="font-medium">{t('eval.integrations.fieldPurposes')}</label>
              <div className="flex flex-wrap gap-3">
                {INTEGRATION_PURPOSES.map((p) => (
                  <label key={p} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={purposes.includes(p)}
                      onChange={() => setPurposes((prev) => toggleIn(prev, p))}
                      className="h-3.5 w-3.5"
                    />
                    <span className="font-mono text-[11px]">{t(`eval.integrations.purpose.${p}`)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="font-medium">{t('eval.integrations.fieldDataClasses')}</label>
              <div className="flex flex-wrap gap-3">
                {DATA_CLASSES.map((d) => (
                  <label key={d} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dataClasses.includes(d)}
                      onChange={() => setDataClasses((prev) => toggleIn(prev, d))}
                      className="h-3.5 w-3.5"
                    />
                    <span className="font-mono text-[11px]">{t(`eval.integrations.data.${d}`)}</span>
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('eval.integrations.cancel')}
            </Button>
            <Button size="sm" onClick={handleSaveClick} disabled={saving}>
              {t('eval.integrations.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConsentDialog
        open={consentOpen}
        purposes={purposes}
        dataClasses={dataClasses}
        onApprove={() => void handleApprove()}
        onDecline={() => setConsentOpen(false)}
      />
    </>
  );
}

export default IntegrationEditorDialog;
