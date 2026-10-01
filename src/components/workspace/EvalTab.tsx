import type { PackScope } from '@/lib/eval/types';
import type { WorkspaceTab, EvalTabView } from '@/lib/types/workspaceTab';
import { useEval } from '@/lib/context/EvalContext';
import { useOpenEvalTab } from '@/lib/eval/ui/openEvalTab';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { EvalRunWizard } from '@/components/eval/wizard/EvalRunWizard';
import { EvalRunProgress } from '@/components/eval/progress/EvalRunProgress';
import { EvalReport } from '@/components/eval/report/EvalReport';
import { PackManager } from '@/components/eval/packs/PackManager';
import { PackEditor } from '@/components/eval/packs/PackEditor';
import { SaveCaseDialog } from '@/components/eval/packs/SaveCaseDialog';
import { ArenaView } from '@/components/eval/arena/ArenaView';

export interface EvalTabProps {
  tab: WorkspaceTab;
}

function RunView({ runId }: { runId: string }) {
  const { runs } = useEval();
  const run = runs.find((r) => r.id === runId);
  if (run?.status === 'completed') {
    return <EvalReport runId={runId} />;
  }
  return <EvalRunProgress runId={runId} />;
}

function PackView({ scope, packId }: { scope: PackScope; packId: string }) {
  const { t } = useLanguage();
  const { openEvalPack, openEvalPacks } = useOpenEvalTab();
  if (scope === 'builtin') {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <p className="text-xs text-muted-foreground">{t('eval.packs.builtinReadonly')}</p>
        <PackManager onEdit={(s, id) => openEvalPack(s, id)} />
      </div>
    );
  }
  return (
    <PackEditor
      scope={scope}
      packId={packId}
      onSaved={() => openEvalPacks()}
      onClose={() => openEvalPacks()}
    />
  );
}

export function EvalTab({ tab }: EvalTabProps) {
  const { t } = useLanguage();
  const { packs } = useEval();
  const { openEvalPack } = useOpenEvalTab();
  const view = (tab.meta?.view as EvalTabView | undefined) ?? 'wizard';

  let content: React.ReactNode;
  switch (view) {
    case 'wizard':
      content = <EvalRunWizard />;
      break;
    case 'run':
      content =
        typeof tab.meta?.runId === 'string' ? (
          <RunView runId={tab.meta.runId} />
        ) : (
          <Placeholder view={view} />
        );
      break;
    case 'packs':
      content = <PackManager onEdit={(s, id) => openEvalPack(s, id)} />;
      break;
    case 'pack':
      content =
        typeof tab.meta?.packId === 'string' && typeof tab.meta?.scope === 'string' ? (
          <PackView scope={tab.meta.scope as PackScope} packId={tab.meta.packId} />
        ) : (
          <Placeholder view={view} />
        );
      break;
    case 'arena':
      content = <ArenaView />;
      break;
    default:
      content = <Placeholder view={view} />;
      break;
  }

  const projectPacks = packs.filter((p) => p.scope === 'project');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">{content}</div>
      <SaveCaseDialog projectPacks={projectPacks} />
    </div>
  );

  function Placeholder({ view: v }: { view: string }) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-medium text-foreground">
          {t('tabPlaceholder.type')} eval:{v}
        </p>
        <p className="max-w-md text-xs text-muted-foreground">{t('tabPlaceholder.desc')}</p>
      </div>
    );
  }
}
