import { useMemo } from 'react';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { PackScope } from '@/lib/eval/types';
import type { WorkspaceTabType } from '@/lib/types/workspaceTab';

// P11-01: 'eval' 탭 타입은 유니온에서 제거됨. 이 파일은 P11-03에서 삭제 예정이라
// 전환기 컴파일 유지용 상수 하나로 캐스트한다.
const LEGACY_EVAL_TAB_TYPE = 'eval' as unknown as WorkspaceTabType;

export function useOpenEvalTab() {
  const { openTab } = useWorkspaceTabs();
  const { t } = useLanguage();
  return useMemo(
    () => ({
      openEvalWizard: () =>
        openTab({
          id: 'eval:wizard',
          type: LEGACY_EVAL_TAB_TYPE,
          title: t('eval.common.tab.wizard'),
          meta: { view: 'wizard' },
        }),
      openEvalRun: (runId: string, title?: string) =>
        openTab({
          id: `eval:run:${runId}`,
          type: LEGACY_EVAL_TAB_TYPE,
          title: title ?? t('eval.common.tab.run'),
          meta: { view: 'run', runId },
        }),
      openEvalPacks: () =>
        openTab({
          id: 'eval:packs',
          type: LEGACY_EVAL_TAB_TYPE,
          title: t('eval.common.tab.packs'),
          meta: { view: 'packs' },
        }),
      openEvalPack: (scope: PackScope, packId: string) =>
        openTab({
          id: `eval:pack:${scope}:${packId}`,
          type: LEGACY_EVAL_TAB_TYPE,
          title: packId,
          meta: { view: 'pack', scope, packId },
        }),
      openArenaList: () =>
        openTab({
          id: 'eval:arena',
          type: LEGACY_EVAL_TAB_TYPE,
          title: t('eval.common.tab.arena'),
          meta: { view: 'arena' },
        }),
    }),
    [openTab, t],
  );
}
