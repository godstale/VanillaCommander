import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useEval } from '@/lib/context/EvalContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useOpenEvalTab } from '@/lib/eval/ui/openEvalTab';
import { useEvalLock } from '@/lib/eval/evalLock';
import { loadPack, type LoadedPack, type LoadedPackRef } from '@/lib/eval/packs/packLoader';
import { tauriPackFs } from '@/lib/eval/packs/packFs';
import { preflight, type PreflightReport } from '@/lib/eval/runner/preflight';
import { estimateRun, formatDuration } from '@/lib/eval/runner/estimate';
import { detectableDiff } from '@/lib/eval/scoring/power';
import { listIntegrations } from '@/lib/db/repositories/integrationsRepo';
import type { EvalPackManifest, ExternalIntegration } from '@/lib/eval/types';
import { buildRunConfig, type WizardDraft } from './buildRunConfig';
import { FieldInfo } from './FieldInfo';
import { WeightsAnchorsEditor } from './WeightsAnchorsEditor';
import { ExternalTransferSummary } from './ExternalTransferSummary';

interface StepReviewProps {
  draft: WizardDraft;
  onUpdate: (patch: Partial<WizardDraft>) => void;
  refs: LoadedPackRef[];
  onProfileSaved: (profile: WizardDraft['profile']) => void;
}

export function StepReview({ draft, onUpdate, refs, onProfileSaved }: StepReviewProps) {
  const { t } = useLanguage();
  const { createRun, startRun } = useEval();
  const { closeTab } = useWorkspaceTabs();
  const { openEvalRun } = useOpenEvalTab();
  const lock = useEvalLock();
  const [loaded, setLoaded] = useState<LoadedPack[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [integrations, setIntegrations] = useState<ExternalIntegration[]>([]);
  const [externalDeclined, setExternalDeclined] = useState(false);
  const [codeConfirmed, setCodeConfirmed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdRunId, setCreatedRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const refsKey = refs.map((r) => `${r.scope}:${r.manifest.id}`).join(',');
  const [seenKey, setSeenKey] = useState(refsKey);
  if (seenKey !== refsKey) {
    setSeenKey(refsKey);
    setLoaded(null);
    setLoadError(null);
    setReport(null);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const packs: LoadedPack[] = [];
        for (const ref of refs) {
          packs.push(await loadPack(tauriPackFs, ref));
        }
        if (!alive) return;
        setLoaded(packs);
        const preview = buildRunConfig(draft, packs, draft.sampleOrderSeed);
        const manifests = new Map<string, EvalPackManifest>(
          packs.map((p) => [`${p.scope}:${p.manifest.id}`, p.manifest]),
        );
        try {
          const rep = await preflight(preview, manifests);
          if (!alive) return;
          setReport(rep);
          onUpdate({ externalTransfers: rep.transfers });
        } catch {
          if (alive) setReport({ candidates: [], transfers: [], chatBusy: false });
        }
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    listIntegrations().then(
      (list) => { if (alive) setIntegrations(list); },
      () => undefined,
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey]);

  const packKinds = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of loaded ?? []) m[`${p.scope}:${p.manifest.id}`] = p.manifest.kind;
    return m;
  }, [loaded]);

  const previewConfig = useMemo(
    () => (loaded ? buildRunConfig(draft, loaded, draft.sampleOrderSeed) : null),
    [draft, loaded],
  );

  const eta = useMemo(
    () => (previewConfig ? formatDuration(estimateRun(previewConfig, packKinds, {}).totalSec) : null),
    [previewConfig, packKinds],
  );

  const idSet = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const p of previewConfig?.packs ?? []) m.set(`${p.scope}:${p.packId}`, new Set(p.sampleIds));
    return m;
  }, [previewConfig]);

  const pythonCount = useMemo(() => {
    let n = 0;
    for (const p of loaded ?? []) {
      const ids = idSet.get(`${p.scope}:${p.manifest.id}`);
      for (const s of p.samples) {
        if (ids?.has(s.id) && s.code?.language === 'python') n += 1;
      }
    }
    return n;
  }, [loaded, idSet]);

  const jsCount = useMemo(() => {
    let n = 0;
    for (const p of loaded ?? []) {
      const ids = idSet.get(`${p.scope}:${p.manifest.id}`);
      for (const s of p.samples) {
        if (ids?.has(s.id) && s.code?.language === 'js') n += 1;
      }
    }
    return n;
  }, [loaded, idSet]);

  const needsExternal = (report?.transfers.length ?? 0) > 0 || draft.judge?.target.type === 'integration';
  const needsCode = pythonCount > 0;
  const weightsOk = draft.weightsConfirmedAt.length > 0;
  const externalOk = !needsExternal || draft.externalConfirmedAt !== null || draft.proceedWithoutExternal;
  const codeOk = !needsCode || codeConfirmed;
  const canCreate = weightsOk && externalOk && codeOk && (previewConfig?.packs.length ?? 0) > 0 && (previewConfig?.candidates.length ?? 0) > 0;

  async function handleCreate(): Promise<void> {
    if (!loaded || !canCreate || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const withConfirms: WizardDraft = {
        ...draft,
        codeExecution: needsCode
          ? { runtime: 'python', snippetCount: pythonCount, confirmedAt: new Date().toISOString() }
          : null,
      };
      const config = buildRunConfig(withConfirms, loaded, draft.sampleOrderSeed);
      const runId = await createRun(config);
      setCreatedRunId(runId);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleStartNow(): Promise<void> {
    if (!createdRunId || lock || starting) return;
    const runId = createdRunId;
    const runName = draft.runName;
    // 팝업을 닫고 위자드 탭을 정리한 뒤 실행 탭을 열어 보여준다.
    // startRun은 실행 전체가 끝날 때까지 끝나지 않으므로 기다리지 않고 띄운다.
    setCreatedRunId(null);
    closeTab('eval:wizard');
    openEvalRun(runId, runName);
    setStarting(true);
    try {
      await startRun(runId);
    } finally {
      setStarting(false);
    }
  }

  function handleCloseDialog(): void {
    // 등록은 이미 끝난 상태이므로 팝업을 닫으면 위자드 탭도 함께 닫는다.
    setCreatedRunId(null);
    closeTab('eval:wizard');
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t('eval.wizard.review.title')}</h3>
      <label className="flex items-center gap-2 text-xs">
        <span className="flex w-24 shrink-0 items-center gap-1 font-semibold">
          {t('eval.wizard.review.runName')}
          <FieldInfo label={t('eval.wizard.review.runName')} help={t('eval.wizard.review.runNameHelp')} />
        </span>
        <Input value={draft.runName} onChange={(e) => onUpdate({ runName: e.target.value })} className="h-7" />
      </label>

      <div className="rounded-lg border border-border p-3 text-xs">
        <div className="font-semibold">{t('eval.wizard.review.preflight')}</div>
        {!loaded && !loadError && <div className="text-muted-foreground">{t('eval.wizard.review.loading')}</div>}
        {loadError && <div className="text-destructive">{t('eval.wizard.review.loadFailed', { err: loadError })}</div>}
        {report?.chatBusy && <div className="text-warning">{t('eval.wizard.review.chatBusy')}</div>}
        {report && (
          <table className="mt-1 w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="border-b p-1">#</th>
                <th className="border-b p-1">model</th>
                <th className="border-b p-1">tools</th>
                <th className="border-b p-1">vram</th>
                <th className="border-b p-1">skipped</th>
              </tr>
            </thead>
            <tbody>
              {report.candidates.map((c) => {
                const cand = previewConfig?.candidates[c.candidateIndex];
                return (
                  <tr key={c.candidateIndex}>
                    <td className="border-b p-1 font-mono">{c.candidateIndex}</td>
                    <td className="border-b p-1 font-mono">
                      {cand?.model ?? ''}{' '}
                      {c.modelStatus === 'blocked' && <span className="text-destructive">{t('eval.wizard.review.modelBlocked')}</span>}
                      {c.modelStatus === 'unknown' && <span className="text-muted-foreground">{t('eval.wizard.review.modelUnknown')}</span>}
                    </td>
                    <td className="border-b p-1">{c.toolSupport}</td>
                    <td className="border-b p-1">{c.vram}</td>
                    <td className="border-b p-1">{c.skippedPacks.map((s) => `${s.packId}(${s.reason})`).join(', ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {previewConfig && eta && (
          <div className="mt-2 space-y-0.5 text-muted-foreground">
            <div>{t('eval.wizard.review.eta', { eta })}</div>
            {previewConfig.packs.map((p) => {
              const n = p.sampleIds.length * p.epochs;
              const d = detectableDiff(n);
              return (
                <div key={`${p.scope}:${p.packId}`}>
                  {t('eval.wizard.review.power', {
                    pack: p.packId,
                    n,
                    pct: Number.isNaN(d) ? '?' : (d * 100).toFixed(1),
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <WeightsAnchorsEditor
        profile={draft.profile}
        onChange={(profile) => onUpdate({ profile })}
        confirmed={weightsOk}
        onConfirmChange={(ok, at) => onUpdate({ weightsConfirmedAt: ok && at ? at : '' })}
        onProfileSaved={onProfileSaved}
      />

      <ExternalTransferSummary
        transfers={draft.proceedWithoutExternal ? [] : (report?.transfers ?? draft.externalTransfers)}
        integrations={integrations}
        consented={draft.externalConfirmedAt !== null}
        onConsentChange={(ok, at) => onUpdate({ externalConfirmedAt: ok ? (at ?? new Date().toISOString()) : null })}
        declined={externalDeclined}
        onDecline={() => setExternalDeclined(true)}
        proceedWithoutExternal={draft.proceedWithoutExternal}
        onProceedWithoutChange={(v) => onUpdate({ proceedWithoutExternal: v })}
      />

      {(pythonCount > 0 || jsCount > 0) && (
        <div className="space-y-1 rounded-lg border border-border p-3 text-xs">
          <div className="font-semibold">{t('eval.wizard.code.title')}</div>
          {pythonCount > 0 && <div className="text-warning">{t('eval.wizard.code.pythonNotice', { n: pythonCount })}</div>}
          {jsCount > 0 && <div className="text-muted-foreground">{t('eval.wizard.code.jsNotice', { n: jsCount })}</div>}
          {needsCode && (
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" checked={codeConfirmed} onChange={(e) => setCodeConfirmed(e.target.checked)} />
              {t('eval.wizard.code.confirmed')}
            </label>
          )}
        </div>
      )}

      {!canCreate && <div className="text-xs text-muted-foreground">{t('eval.wizard.create.confirmFirst')}</div>}
      {createError && <div className="text-xs text-destructive">{t('eval.wizard.create.failed', { err: createError })}</div>}
      <Button type="button" size="sm" disabled={!canCreate || creating || !loaded} onClick={() => void handleCreate()}>
        {creating ? t('eval.wizard.create.creating') : t('eval.wizard.create.run')}
      </Button>

      <Dialog open={createdRunId !== null} onOpenChange={(next) => { if (!next) handleCloseDialog(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">{t('eval.wizard.create.done')}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">{t('eval.wizard.create.doneDesc')}</p>
          {lock && <div className="text-xs text-warning">{t('eval.wizard.create.locked')}</div>}
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" onClick={handleCloseDialog}>
              {t('eval.wizard.create.startLater')}
            </Button>
            <Button type="button" size="sm" disabled={lock !== null || starting} onClick={() => void handleStartNow()}>
              {t('eval.wizard.create.startNow')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
