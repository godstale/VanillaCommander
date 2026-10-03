import { useState } from 'react';
import { Activity, Bot } from 'lucide-react';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { cn } from '@/lib/utils';
import { AgentEditorTab } from '@/components/workspace/AgentEditorTab';
import { AgentMonitorTab } from '@/components/workspace/AgentMonitorTab';
import { agentWorkbenchView, type AgentWorkbenchView } from '@/lib/agent/agentWorkbench';

/**
 * 에이전트 편집 + 실시간 모니터링을 한 탭 안의 서브탭으로 묶는다.
 * 모니터링은 처음 열 때 마운트하고 이후에는 유지한다(언마운트 시 수집기가 멈추므로).
 */
export function AgentWorkbenchTab({ tab }: { tab: WorkspaceTab }) {
  const { updateTab } = useWorkspaceTabs();
  const { t } = useLanguage();
  const agentId = tab.meta?.agentId as string | undefined;
  const view = agentWorkbenchView(tab);
  const [monitorMounted, setMonitorMounted] = useState(view === 'monitor');

  const selectView = (next: AgentWorkbenchView) => {
    if (next === 'monitor') setMonitorMounted(true);
    if (next !== view) updateTab(tab.id, { meta: { ...tab.meta, view: next } });
  };
  // 이미 열린 탭이 외부(카드 아이콘 등)에서 monitor로 전환되면 마운트한다.
  if (view === 'monitor' && !monitorMounted) setMonitorMounted(true);

  const items: { id: AgentWorkbenchView; label: string; icon: typeof Bot; disabled?: boolean }[] = [
    { id: 'edit', label: t('agentWorkbench.tabEdit'), icon: Bot },
    { id: 'monitor', label: t('agentWorkbench.tabMonitor'), icon: Activity, disabled: !agentId },
  ];

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <div role="tablist" className="flex items-center gap-1 px-4 pt-2 border-b border-border bg-tabbar shrink-0">
        {items.map(({ id, label, icon: Icon, disabled }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            disabled={disabled}
            onClick={() => selectView(id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
              view === id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className={cn('flex-1 min-h-0', view !== 'edit' && 'hidden')}>
        <AgentEditorTab tab={tab} />
      </div>
      {monitorMounted && agentId && (
        <div className={cn('flex-1 min-h-0 overflow-auto', view !== 'monitor' && 'hidden')}>
          <AgentMonitorTab tab={tab} />
        </div>
      )}
    </div>
  );
}

export default AgentWorkbenchTab;
