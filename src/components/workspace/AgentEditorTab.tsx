import { useState } from 'react';
import { Bot, CheckCircle2, MessageSquare } from 'lucide-react';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import type { Agent } from '@/lib/types/agent';
import { useAgents } from '@/lib/context/AgentsContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useChatSessions } from '@/lib/context/ChatSessionsContext';
import { useGlobalLlmBusy } from '@/lib/agent/chatQueueManager';
import { Button } from '@/components/ui/button';
import { AgentEditorForm } from '@/components/agents/AgentEditorForm';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface AgentEditorTabProps {
  tab: WorkspaceTab;
}

export function AgentEditorTab({ tab }: AgentEditorTabProps) {
  const { getAgent } = useAgents();
  const { updateTab, closeTab, openTab } = useWorkspaceTabs();
  const { sessions } = useChatSessions();
  const busySessionId = useGlobalLlmBusy();

  const rawId = (tab.meta?.agentId as string | undefined) ||
    (tab.id.startsWith('agent-editor:') ? tab.id.slice('agent-editor:'.length) : undefined);
  const isNew = !rawId || rawId.startsWith('new-');
  const existingAgent = isNew ? undefined : getAgent(rawId);
  const mode: 'create' | 'edit' = existingAgent ? 'edit' : (isNew ? 'create' : 'edit');

  // 채팅 중(해당 에이전트를 쓰는 세션이 LLM 동작/대기 큐 상태)에는 저장을 제한한다.
  // 바쁜 세션이 목록에 없으면(다른 워크스페이스 등) 보수적으로 잠근다.
  const busySession = busySessionId ? sessions.find((s: { id: string }) => s.id === busySessionId) : undefined;
  const saveLocked =
    mode === 'edit' &&
    !!existingAgent &&
    busySessionId !== null &&
    (!busySession || busySession.agentId === existingAgent.id);

  const [saveFeedback, setSaveFeedback] = useState(false);
  const { t } = useLanguage();

  const handleSave = (saved: Agent) => {
    updateTab(tab.id, {
      title: t('agentList.edit', { name: saved.name }),
      meta: { agentId: saved.id },
    });
    setSaveFeedback(true);
    setTimeout(() => setSaveFeedback(false), 3000);
  };

  const handleCancel = () => {
    closeTab(tab.id);
  };

  const handleStartChat = () => {
    if (!existingAgent) return;
    const sessionId = crypto.randomUUID();
    openTab({
      id: `chat:${sessionId}`,
      type: 'chat',
      title: t('agentList.chatWith', { name: existingAgent.name }),
      meta: { sessionId, agentId: existingAgent.id },
    });
  };

  return (
    <div className="flex flex-col h-full w-full bg-editor overflow-hidden">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-tabbar shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center text-primary">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">
              {mode === 'edit' && existingAgent
                ? t('agentEditor.editTitle', { name: existingAgent.name })
                : t('agentEditor.createTitle')}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {mode === 'edit'
                ? t('agentEditor.editDesc')
                : t('agentEditor.createDesc')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saveFeedback && (
            <span className="flex items-center gap-1 text-xs text-success font-medium animate-fade-in">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{t('agentEditor.saved')}</span>
            </span>
          )}
          <Button
            type="button"
            size="sm"
            onClick={handleStartChat}
            disabled={!existingAgent}
            title={!existingAgent ? t('agentEditor.saveFirst') : undefined}
            className="gap-1.5 text-xs cursor-pointer"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>{t('agentEditor.startChat')}</span>
          </Button>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="flex-1 overflow-y-auto p-6">
        <AgentEditorForm
          mode={mode}
          initialAgent={existingAgent}
          saveLocked={saveLocked}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}

export default AgentEditorTab;
