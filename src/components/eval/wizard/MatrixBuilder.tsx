import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getProviderPreset, resolveAgentLlmRuntime } from '@/lib/llm/providers';
import { listProviderModels } from '@/lib/llm/providerRuntime';
import type { Agent } from '@/lib/types/agent';
import { expandMatrix, type MatrixAxes } from '@/lib/eval/runner/candidates';

interface MatrixBuilderProps {
  agents: Agent[];
  baseAgentId: string;
  onBaseChange: (id: string) => void;
  axes: MatrixAxes;
  onAxesChange: (axes: MatrixAxes) => void;
  onExpand: (base: Agent, axes: MatrixAxes) => void;
}

function parseNumbers(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

function countMatrixCombos(axes: MatrixAxes): number {
  const dims = [axes.model?.length ?? 0, axes.contextSize?.length ?? 0, axes.temperature?.length ?? 0, axes.reasoning?.length ?? 0, axes.topP?.length ?? 0, axes.maxOutputTokens?.length ?? 0].filter((n) => n > 0);
  if (dims.length === 0) return 0;
  return dims.reduce((a, b) => a * b, 1);
}

const REASONING_OPTS: NonNullable<MatrixAxes['reasoning']> = ['off', 'on:low', 'on:medium', 'on:high', 'default'];

export function MatrixBuilder({ agents, baseAgentId, onBaseChange, axes, onAxesChange, onExpand }: MatrixBuilderProps) {
  const { t } = useLanguage();
  const base = agents.find((a) => a.id === baseAgentId) ?? agents[0];
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [ctxRaw, setCtxRaw] = useState((axes.contextSize ?? []).join(', '));
  const [tempRaw, setTempRaw] = useState((axes.temperature ?? []).join(', '));

  useEffect(() => {
    if (!base) return;
    let alive = true;
    const provider = base.llmProvider ?? 'ollama';
    const runtime = resolveAgentLlmRuntime(
      { llmProvider: provider, llmBaseUrl: base.llmBaseUrl ?? getProviderPreset(provider).defaultBaseUrl },
      undefined,
    );
    listProviderModels(runtime).then(
      (list) => { if (alive) { setModels(list.map((m) => m.name)); setModelsError(null); } },
      (err) => { if (alive) setModelsError(err instanceof Error ? err.message : String(err)); },
    );
    return () => { alive = false; };
  }, [base?.id, base?.llmProvider, base?.llmBaseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const combos = countMatrixCombos(axes);
  const tooMany = combos > 24;

  const preview = useMemo(() => {
    if (!base || combos === 0 || tooMany) return [];
    try {
      return expandMatrix(base, axes).map((c) => c.label);
    } catch {
      return [];
    }
  }, [base, axes, combos, tooMany]);

  function toggleModel(name: string): void {
    const cur = axes.model ?? [];
    onAxesChange({ ...axes, model: cur.includes(name) ? cur.filter((m) => m !== name) : [...cur, name] });
  }

  function toggleReasoning(v: NonNullable<MatrixAxes['reasoning']>[number]): void {
    const cur = axes.reasoning ?? [];
    onAxesChange({ ...axes, reasoning: cur.includes(v) ? cur.filter((r) => r !== v) : [...cur, v] });
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <label className="flex items-center gap-2">
        <span className="w-28 shrink-0 font-semibold">{t('eval.wizard.matrix.base')}</span>
        <select value={base?.id ?? ''} onChange={(e) => onBaseChange(e.target.value)} className="h-7 flex-1 rounded border border-input bg-background px-1">
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.model})</option>)}
        </select>
      </label>
      <div>
        <div className="font-semibold">{t('eval.wizard.matrix.models')}</div>
        <div className="text-muted-foreground">{t('eval.wizard.matrix.modelsHint')}</div>
        {modelsError && <div className="text-destructive">{t('eval.wizard.matrix.modelsFailed', { err: modelsError })}</div>}
        <div className="mt-1 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
          {models.map((m) => {
            const on = (axes.model ?? []).includes(m);
            return (
              <button key={m} type="button" onClick={() => toggleModel(m)} className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${on ? 'border-primary bg-primary/10' : 'border-border'}`}>
                {m}
              </button>
            );
          })}
        </div>
      </div>
      <label className="flex items-center gap-2">
        <span className="w-28 shrink-0 font-semibold">{t('eval.wizard.matrix.ctx')}</span>
        <Input
          value={ctxRaw}
          onChange={(e) => {
            setCtxRaw(e.target.value);
            onAxesChange({ ...axes, contextSize: parseNumbers(e.target.value).length > 0 ? parseNumbers(e.target.value) : undefined });
          }}
          placeholder="8192, 32768"
          className="h-7"
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="w-28 shrink-0 font-semibold">{t('eval.wizard.matrix.temps')}</span>
        <Input
          value={tempRaw}
          onChange={(e) => {
            setTempRaw(e.target.value);
            onAxesChange({ ...axes, temperature: parseNumbers(e.target.value).length > 0 ? parseNumbers(e.target.value) : undefined });
          }}
          placeholder="0, 0.7"
          className="h-7"
        />
      </label>
      <div>
        <div className="font-semibold">reasoning</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {REASONING_OPTS.map((r) => {
            const on = (axes.reasoning ?? []).includes(r);
            return (
              <button key={r} type="button" onClick={() => toggleReasoning(r)} className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${on ? 'border-primary bg-primary/10' : 'border-border'}`}>
                {r}
              </button>
            );
          })}
        </div>
      </div>
      <div className="text-muted-foreground">
        {combos === 0 ? t('eval.wizard.matrix.empty') : t('eval.wizard.matrix.combos', { n: combos })}
      </div>
      {tooMany && <div className="text-destructive">{t('eval.wizard.matrix.tooMany', { n: combos })}</div>}
      {preview.length > 0 && (
        <ul className="max-h-24 list-disc overflow-y-auto pl-5 text-muted-foreground">
          {preview.map((label) => <li key={label}>{label}</li>)}
        </ul>
      )}
      <Button type="button" size="sm" variant="outline" disabled={!base || combos === 0 || tooMany} onClick={() => { if (base) onExpand(base, axes); }}>
        {t('eval.wizard.matrix.add')}
      </Button>
    </div>
  );
}
