import { useCallback } from 'react';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export type AgentWorkbenchView = 'edit' | 'monitor';

/** 탭의 현재 서브탭. 예전 `agent-monitor` 탭은 모니터링으로 열린다. */
export function agentWorkbenchView(tab: Pick<WorkspaceTab, 'type' | 'meta'>): AgentWorkbenchView {
  const v = tab.meta?.view;
  if (v === 'edit' || v === 'monitor') return v;
  return tab.type === 'agent-monitor' ? 'monitor' : 'edit';
}

/** 에이전트당 하나의 탭(`agent-editor:<id>`)을 열고 원하는 서브탭으로 전환한다. */
export function useOpenAgentWorkbench() {
  const { openTab, updateTab } = useWorkspaceTabs();
  const { t } = useLanguage();
  return useCallback(
    (agent: { id: string; name: string }, view: AgentWorkbenchView) => {
      const id = openTab({
        id: `agent-editor:${agent.id}`,
        type: 'agent-editor',
        title: t('agentWorkbench.tabTitle', { name: agent.name }),
        meta: { agentId: agent.id, view },
      });
      // 이미 열려 있던 탭이면 openTab은 meta를 바꾸지 않으므로 서브탭을 직접 전환한다.
      updateTab(id, { meta: { agentId: agent.id, view } });
    },
    [openTab, updateTab, t],
  );
}
