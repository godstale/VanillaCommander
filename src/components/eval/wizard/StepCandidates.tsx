import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAgents } from '@/lib/context/AgentsContext';
import { getProviderPreset } from '@/lib/llm/providers';
import { DEFAULT_RUN_OPTIONS } from '@/lib/eval/constants';
import { candidateFromAgent, expandMatrix, type MatrixAxes } from '@/lib/eval/runner/candidates';
import { listIntegrations } from '@/lib/db/repositories/integrationsRepo';
import type { Agent } from '@/lib/types/agent';
import type {
  CandidateSnapshot,
  EvalPackManifest,
  ExternalIntegration,
  JudgeConfig,
} from '@/lib/eval/types';
import { JUDGE_PROMPT_VERSION } from '@/lib/eval/constants';
import { MatrixBuilder } from './MatrixBuilder';
import { FieldInfo } from './FieldInfo';
import type { WizardRunOptions } from './buildRunConfig';

export interface QuantCompare {
  enabled: boolean;
  baseIndex: number;
}

interface StepCandidatesProps {
  candidates: CandidateSnapshot[];
  onChange: (candidates: CandidateSnapshot[]) => void;
  judge: JudgeConfig | null;
  onJudgeChange: (judge: JudgeConfig | null) => void;
  judgeRequired: boolean;
  packManifests: EvalPackManifest[];
  options: WizardRunOptions;
  onOptionsChange: (options: WizardRunOptions) => void;
  sampleOrderSeed: number;
  onSeedChange: (seed: number) => void;
  quant: QuantCompare;
  onQuantChange: (quant: QuantCompare) => void;
  quantPackExists: boolean;
  quantPackIncluded: boolean;
}

function familyOf(model: string): string {
  return model.split(/[/:._-]/)[0]?.toLowerCase() ?? model.toLowerCase();
}

export function StepCandidates(props: StepCandidatesProps) {
  const { t } = useLanguage();
  const { agents } = useAgents();
  const [baseAgentId, setBaseAgentId] = useState(agents[0]?.id ?? '');
  const [axes, setAxes] = useState<MatrixAxes>({});
  const [integrations, setIntegrations] = useState<ExternalIntegration[]>([]);
  const [judgeMode, setJudgeMode] = useState<'local' | 'integration'>(props.judge?.target.type === 'integration' ? 'integration' : 'local');
  const [judgeAgentId, setJudgeAgentId] = useState(agents[0]?.id ?? '');
  const [judgeIntegrationId, setJudgeIntegrationId] = useState('');
  const [judgeScale, setJudgeScale] = useState<'1-5' | '1-10'>(props.judge?.scale ?? '1-5');
  const [judgePairwise, setJudgePairwise] = useState<'none' | 'vs-reference' | 'round-robin'>(props.judge?.pairwise ?? 'none');

  useEffect(() => {
    let alive = true;
    listIntegrations().then(
      (list) => { if (alive) setIntegrations(list); },
      () => { if (alive) setIntegrations([]); },
    );
    return () => { alive = false; };
  }, []);

  const judgeIntegrations = useMemo(
    () => integrations.filter((it) => it.enabled && it.allowedPurposes.includes('judge')),
    [integrations],
  );

  const selectedIds = useMemo(
    () => new Set(props.candidates.map((c) => c.sourceAgentId).filter((id): id is string => id !== null)),
    [props.candidates],
  );

  function toggleAgent(agent: Agent): void {
    if (selectedIds.has(agent.id)) {
      props.onChange(props.candidates.filter((c) => c.sourceAgentId !== agent.id || c.sweep !== undefined));
    } else {
      props.onChange([...props.candidates, candidateFromAgent(agent)]);
    }
  }

  function handleExpand(base: Agent, nextAxes: MatrixAxes): void {
    try {
      const added = expandMatrix(base, nextAxes);
      const labels = new Set(props.candidates.map((c) => c.label));
      props.onChange([...props.candidates, ...added.filter((c) => !labels.has(c.label))]);
    } catch {
      // expandMatrix throws over the 24-combo cap; MatrixBuilder already blocks this.
    }
  }

  function applyJudge(): void {
    if (judgeMode === 'local') {
      const agent = agents.find((a) => a.id === judgeAgentId) ?? agents[0];
      if (!agent) return;
      const provider = agent.llmProvider ?? 'ollama';
      props.onJudgeChange({
        target: {
          type: 'local',
          provider,
          baseUrl: agent.llmBaseUrl ?? getProviderPreset(provider).defaultBaseUrl,
          model: agent.model,
          sourceAgentId: agent.id,
        },
        scale: judgeScale,
        pairwise: judgePairwise,
        promptVersion: JUDGE_PROMPT_VERSION,
      });
    } else {
      if (!judgeIntegrationId) return;
      props.onJudgeChange({
        target: { type: 'integration', integrationId: judgeIntegrationId },
        scale: judgeScale,
        pairwise: judgePairwise,
        promptVersion: JUDGE_PROMPT_VERSION,
      });
    }
  }

  const quantBase = props.candidates[props.quant.baseIndex];
  const quantFamilyMismatch =
    props.quant.enabled &&
    quantBase !== undefined &&
    props.candidates.some((c) => familyOf(c.model) !== familyOf(quantBase.model));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {t('eval.wizard.candidates.select')}
          <FieldInfo label={t('eval.wizard.candidates.select')} help={t('eval.wizard.guide.candidates')} />
        </h3>
        <p className="text-xs text-muted-foreground">{t('eval.wizard.candidates.desc')}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t('eval.wizard.candidates.snapshotNote')}</p>
      </div>
      <div className="grid gap-1.5 md:grid-cols-2">
        {agents.map((agent) => {
          const on = selectedIds.has(agent.id);
          const external = (agent.llmBaseUrl ?? '').startsWith('https://') && !(agent.llmProvider ?? 'ollama').startsWith('ollama');
          return (
            <div key={agent.id} className={`flex items-center gap-2 rounded-lg border p-2 text-xs ${on ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <input type="checkbox" checked={on} onChange={() => toggleAgent(agent)} aria-label={agent.name} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{agent.name}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {agent.llmProvider ?? 'ollama'} / {agent.model} / ctx {agent.contextSize}
                </div>
              </div>
              {external && <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">{t('eval.wizard.candidates.external')}</span>}
            </div>
          );
        })}
      </div>

      {props.candidates.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            {t('eval.wizard.candidates.count', { n: props.candidates.length })}
          </div>
          {props.candidates.map((c, i) => (
            <div key={`${c.label}-${i}`} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs">
              <span className="truncate font-mono">{c.label}</span>
              {c.endpointClass !== 'local' && <span className="rounded bg-muted px-1 text-[10px]">{t('eval.wizard.candidates.external')}</span>}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto h-6 px-1.5 text-[11px]"
                onClick={() => props.onChange(props.candidates.filter((_, j) => j !== i))}
              >
                {t('eval.wizard.candidates.remove')}
              </Button>
            </div>
          ))}
        </div>
      )}
      {props.candidates.length === 0 && <div className="text-xs text-destructive">{t('eval.wizard.candidates.requireSelect')}</div>}

      <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
        <div className="flex items-center gap-1.5 font-semibold">
          {t('eval.wizard.judge.title')}
          <FieldInfo label={t('eval.wizard.judge.title')} help={t('eval.wizard.judge.desc')} />
        </div>
        {!props.judgeRequired ? (
          <div className="text-muted-foreground">{t('eval.wizard.judge.notNeeded')}</div>
        ) : (
          <>
            <label className="flex items-center gap-2">
              <span className="w-24 shrink-0">{t('eval.wizard.judge.mode')}</span>
              <select value={judgeMode} onChange={(e) => setJudgeMode(e.target.value as 'local' | 'integration')} className="h-7 flex-1 rounded border border-input bg-background px-1">
                <option value="local">{t('eval.wizard.judge.modeLocal')}</option>
                <option value="integration">{t('eval.wizard.judge.modeIntegration')}</option>
              </select>
            </label>
            {judgeMode === 'local' ? (
              <label className="flex items-center gap-2">
                <span className="w-24 shrink-0">{t('eval.wizard.judge.agent')}</span>
                <select value={judgeAgentId} onChange={(e) => setJudgeAgentId(e.target.value)} className="h-7 flex-1 rounded border border-input bg-background px-1">
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.model})</option>)}
                </select>
              </label>
            ) : (
              <label className="flex items-center gap-2">
                <span className="w-24 shrink-0">{t('eval.wizard.judge.integration')}</span>
                <select value={judgeIntegrationId} onChange={(e) => setJudgeIntegrationId(e.target.value)} className="h-7 flex-1 rounded border border-input bg-background px-1">
                  <option value="">{judgeIntegrations.length === 0 ? t('eval.wizard.judge.noIntegrations') : '—'}</option>
                  {judgeIntegrations.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </select>
              </label>
            )}
            <Button type="button" size="sm" variant="outline" onClick={applyJudge}>
              {props.judge ? `${t('eval.wizard.judge.title')} ✓` : t('eval.wizard.judge.apply')}
            </Button>
          </>
        )}
      </div>

      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">
          {t('eval.wizard.advanced.title')}
        </summary>
        <div className="space-y-3 border-t border-border p-3 text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 font-semibold">
              {t('eval.wizard.advanced.matrix')}
              <FieldInfo label={t('eval.wizard.advanced.matrix')} help={t('eval.wizard.advanced.matrixDesc')} />
            </div>
            <MatrixBuilder
              agents={agents}
              baseAgentId={baseAgentId || agents[0]?.id || ''}
              onBaseChange={setBaseAgentId}
              axes={axes}
              onAxesChange={setAxes}
              onExpand={handleExpand}
            />
          </div>

          <div className="space-y-1 rounded-lg border border-border p-3">
            <div className="flex items-center gap-1.5 font-semibold">
              {t('eval.wizard.quant.title')}
              <FieldInfo label={t('eval.wizard.quant.title')} help={t('eval.wizard.quant.help')} />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.quant.enabled}
                disabled={!props.quantPackExists}
                onChange={(e) => props.onQuantChange({ ...props.quant, enabled: e.target.checked })}
              />
              {t('eval.wizard.quant.enable')}
            </label>
            {!props.quantPackExists && (
              <div className="text-muted-foreground">{t('eval.wizard.quant.packMissing')}</div>
            )}
            {props.quantPackExists && props.quantPackIncluded && (
              <div className="text-muted-foreground">{t('eval.wizard.quant.packIncluded')}</div>
            )}
            {props.quant.enabled && (
              <>
                <label className="flex items-center gap-2">
                  <span className="w-24 shrink-0">{t('eval.wizard.quant.base')}</span>
                  <select
                    value={props.quant.baseIndex}
                    onChange={(e) => props.onQuantChange({ ...props.quant, baseIndex: Number(e.target.value) })}
                    className="h-7 flex-1 rounded border border-input bg-background px-1"
                  >
                    {props.candidates.map((c, i) => <option key={i} value={i}>{c.label}</option>)}
                  </select>
                </label>
                {quantFamilyMismatch && <div className="text-amber-600">{t('eval.wizard.quant.sameFamily')}</div>}
              </>
            )}
          </div>

          {props.judgeRequired && (
            <div className="space-y-1 rounded-lg border border-border p-3">
              <div className="font-semibold">{t('eval.wizard.advanced.judgeDetail')}</div>
              <div className="flex gap-3">
                <label className="flex items-center gap-2">
                  {t('eval.wizard.judge.scale')}
                  <select value={judgeScale} onChange={(e) => setJudgeScale(e.target.value as '1-5' | '1-10')} className="h-7 rounded border border-input bg-background px-1">
                    <option value="1-5">1-5</option>
                    <option value="1-10">1-10</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  {t('eval.wizard.judge.pairwise')}
                  <select value={judgePairwise} onChange={(e) => setJudgePairwise(e.target.value as 'none' | 'vs-reference' | 'round-robin')} className="h-7 rounded border border-input bg-background px-1">
                    <option value="none">none</option>
                    <option value="vs-reference">vs-reference</option>
                    <option value="round-robin">round-robin</option>
                  </select>
                </label>
              </div>
              <div className="text-muted-foreground">{t('eval.wizard.advanced.judgeDetailHint')}</div>
            </div>
          )}

          <div className="space-y-1 rounded-lg border border-border p-3">
            <div className="font-semibold">{t('eval.wizard.options.title')}</div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.options.deterministicMode}
                onChange={(e) => props.onOptionsChange({ ...props.options, deterministicMode: e.target.checked })}
              />
              {t('eval.wizard.options.deterministic')}
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1">
                {t('eval.wizard.options.reliability')}
                <Input
                  type="number" min={2} max={10} value={props.options.reliabilityEpochs}
                  onChange={(e) => props.onOptionsChange({ ...props.options, reliabilityEpochs: Number(e.target.value) })}
                  className="h-7 w-16"
                />
              </label>
              <label className="flex items-center gap-1">
                {t('eval.wizard.options.timeout')}
                <Input
                  type="number" min={0.5} max={5} step={0.5} value={props.options.timeoutMultiplier}
                  onChange={(e) => props.onOptionsChange({ ...props.options, timeoutMultiplier: Number(e.target.value) })}
                  className="h-7 w-16"
                />
              </label>
              <label className="flex items-center gap-1">
                {t('eval.wizard.options.perfRepeats')}
                <Input
                  type="number" min={1} max={10} value={props.options.perfRepeats ?? DEFAULT_RUN_OPTIONS.perfRepeats}
                  onChange={(e) => props.onOptionsChange({ ...props.options, perfRepeats: Number(e.target.value) })}
                  className="h-7 w-16"
                />
              </label>
              <label className="flex items-center gap-1">
                {t('eval.wizard.options.seed')}
                <Input
                  type="number" value={props.sampleOrderSeed}
                  onChange={(e) => props.onSeedChange(Number(e.target.value))}
                  className="h-7 w-24"
                />
              </label>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.options.unloadBetweenCandidates}
                onChange={(e) => props.onOptionsChange({ ...props.options, unloadBetweenCandidates: e.target.checked })}
              />
              {t('eval.wizard.options.unload')}
            </label>
          </div>
        </div>
      </details>
    </div>
  );
}
