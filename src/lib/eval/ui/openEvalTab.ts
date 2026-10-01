import { useMemo } from 'react';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { PackScope } from '@/lib/eval/types';

export function useOpenEvalTab() {
  const { openTab } = useWorkspaceTabs();
  const { t } = useLanguage();
  return useMemo(
    () => ({
      openEvalWizard: () =>
        openTab({
          id: 'eval:wizard',
          type: 'eval',
          title: t('eval.common.tab.wizard'),
          meta: { view: 'wizard' },
        }),
      openEvalRun: (runId: string, title?: string) =>
        openTab({
          id: `eval:run:${runId}`,
          type: 'eval',
          title: title ?? t('eval.common.tab.run'),
          meta: { view: 'run', runId },
        }),
      openEvalPacks: () =>
        openTab({
          id: 'eval:packs',
          type: 'eval',
          title: t('eval.common.tab.packs'),
          meta: { view: 'packs' },
        }),
      openEvalPack: (scope: PackScope, packId: string) =>
        openTab({
          id: `eval:pack:${scope}:${packId}`,
          type: 'eval',
          title: packId,
          meta: { view: 'pack', scope, packId },
        }),
      openArenaList: () =>
        openTab({
          id: 'eval:arena',
          type: 'eval',
          title: t('eval.common.tab.arena'),
          meta: { view: 'arena' },
        }),
    }),
    [openTab, t],
  );
}
