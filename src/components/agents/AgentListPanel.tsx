import { useState, useEffect, useCallback } from 'react';
import { Bot, Plus, Sparkles, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAgents } from '@/lib/context/AgentsContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { AgentCard } from './AgentCard';
import type { Agent, AgentConnectionStatus } from '@/lib/types/agent';
import { checkAllAgentsConnection, checkAgentConnection } from '@/lib/llm/agentStatus';

export function AgentListPanel() {
  const { agents, loading, createAgent, setDefaultAgent, deleteAgent } = useAgents();
  const { openTab } = useWorkspaceTabs();
  const { settings } = useSettings();
  const { t } = useLanguage();

  const [statuses, setStatuses] = useState<Record<string, AgentConnectionStatus>>({});
  const [checkingMap, setCheckingMap] = useState<Record<string, boolean>>({});
  const [isCheckingAll, setIsCheckingAll] = useState(false);

  // Check connection for all agents
  const handleCheckAll = useCallback(async () => {
    if (agents.length === 0) return;
    setIsCheckingAll(true);
    try {
      const results = await checkAllAgentsConnection(agents, settings.ollamaBaseUrl);
      setStatuses((prev) => ({ ...prev, ...results }));
    } catch (err) {
      console.error('Failed to check all agents connection:', err);
    } finally {
      setIsCheckingAll(false);
    }
  }, [agents, settings.ollamaBaseUrl]);

  // Check connection for single agent
  const handleCheckSingle = useCallback(
    async (agent: Agent) => {
      setCheckingMap((prev) => ({ ...prev, [agent.id]: true }));
      try {
        const result = await checkAgentConnection(agent, settings.ollamaBaseUrl);
        setStatuses((prev) => ({ ...prev, [agent.id]: result }));
      } catch (err) {
        console.error(`Failed to check connection for agent ${agent.name}:`, err);
        setStatuses((prev) => ({ ...prev, [agent.id]: 'disconnected' }));
      } finally {
        setCheckingMap((prev) => ({ ...prev, [agent.id]: false }));
      }
    },
    [settings.ollamaBaseUrl],
  );

  // Automatically check connection when agents are loaded or changed
  useEffect(() => {
    if (loading || agents.length === 0) return;

    let cancelled = false;

    checkAllAgentsConnection(agents, settings.ollamaBaseUrl)
      .then((results) => {
        if (!cancelled) {
          setStatuses((prev) => ({ ...prev, ...results }));
        }
      })
      .catch((err) => {
        console.error('Failed to check all agents connection:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [loading, agents, settings.ollamaBaseUrl]);

  const handleCreateAgent = () => {

    openTab({
      id: `agent-editor:new-${Date.now()}`,
      type: 'agent-editor',
      title: t('agentList.newAgent'),
    });
  };

  const handleStartChat = (agent: Agent) => {
    // Lazy session: DB row is created on first send, so empty tabs never pollute history.
    const sessionId = crypto.randomUUID();
    openTab({
      id: `chat:${sessionId}`,
      type: 'chat',
      title: t('agentList.chatWith', { name: agent.name }),
      meta: { sessionId, agentId: agent.id },
    });
  };

  const handleOpenMonitor = (agent: Agent) => {
    openTab({
      id: `agent-monitor:${agent.id}`,
      type: 'agent-monitor',
      title: t('agentList.monitor', { name: agent.name }),
      meta: { agentId: agent.id },
    });
  };

  // P11-01: 'agent-stats' 탭은 제거됨. 통계·로그 버튼은 P11-20에서 삭제 예정이라,
  // 그전까지는 에이전트 모니터 탭으로 연결한다.
  const handleShowStats = (agent: Agent) => {
    openTab({
      id: `agent-monitor:${agent.id}`,
      type: 'agent-monitor',
      title: t('agentList.stats', { name: agent.name }),
      meta: { agentId: agent.id },
    });
  };

  const handleShowLogs = (agent: Agent) => {
    openTab({
      id: `agent-monitor:${agent.id}`,
      type: 'agent-monitor',
      title: t('agentList.log', { name: agent.name }),
      meta: { agentId: agent.id },
    });
  };

  const handleEditAgent = (agent: Agent) => {
    openTab({
      id: `agent-editor:${agent.id}`,
      type: 'agent-editor',
      title: t('agentList.edit', { name: agent.name }),
      meta: { agentId: agent.id },
    });
  };

  const handleSetDefault = async (agent: Agent) => {
    try {
      await setDefaultAgent(agent.id);
    } catch (err) {
      console.error('Failed to set default agent:', err);
    }
  };

  const handleDelete = async (agent: Agent) => {
    try {
      await deleteAgent(agent.id);
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  };

  const handleDuplicate = async (agent: Agent) => {
    try {
      await createAgent({
        name: t('agentCard.duplicateName', { name: agent.name }),
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        temperature: agent.temperature,
        contextSize: agent.contextSize,
        reserveTokens: agent.reserveTokens,
        keepRecentTokens: agent.keepRecentTokens,
        enabledSkills: [...agent.enabledSkills],
        enabledBuiltinTools: [...agent.enabledBuiltinTools],
        approvalMode: agent.approvalMode,
        reasoning: agent.reasoning ?? 'default',
        reasoningEffort: agent.reasoningEffort ?? 'medium',
        isDefault: false,
      });
    } catch (err) {
      console.error('Failed to duplicate agent:', err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-panel select-none">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5" />
          {t('agentList.title')}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
            onClick={handleCheckAll}
            disabled={isCheckingAll || loading}
            title={t('agentList.checkAll')}
            aria-label={t('agentList.checkAll')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isCheckingAll ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground hover:bg-accent"
            onClick={handleCreateAgent}
            title={t('agentList.add')}
            aria-label={t('agentList.add')}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {loading ? (
          <div className="py-8 text-center text-xs text-muted-foreground animate-pulse">
            {t('agentList.loading')}
          </div>
        ) : agents.length === 0 ? (
          <div className="py-12 px-4 flex flex-col items-center justify-center text-center text-muted-foreground space-y-3">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
              <Bot className="h-5 w-5 opacity-50" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-foreground">{t('agentList.empty')}</p>
              <p className="text-[11px] text-muted-foreground max-w-xs">
                {t('agentList.emptyDesc')}
              </p>
            </div>
            <Button
              size="sm"
              onClick={handleCreateAgent}
              className="text-xs flex items-center gap-1.5 mt-2 bg-primary text-primary-foreground"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{t('agentList.createFirst')}</span>
            </Button>
          </div>
        ) : (
          agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              status={statuses[agent.id] ?? 'unknown'}
              isChecking={!!checkingMap[agent.id] || isCheckingAll}
              onCheckConnection={handleCheckSingle}
              onOpenMonitor={handleOpenMonitor}
              isOnlyAgent={agents.length <= 1}
              onStartChat={handleStartChat}
              onShowStats={handleShowStats}
              onShowLogs={handleShowLogs}
              onEdit={handleEditAgent}
              onDuplicate={handleDuplicate}
              onSetDefault={handleSetDefault}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default AgentListPanel;
