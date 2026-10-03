import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { useOpenAgentWorkbench } from '@/lib/agent/agentWorkbench';
import { useAgents } from '@/lib/context/AgentsContext';
import { useStatusBar, type StatusBarItem, type StatusBarSlot } from '@/lib/context/StatusBarContext';
import { useGlobalLlmBusy } from '@/lib/agent/chatQueueManager';
import { checkAgentConnection } from '@/lib/llm/agentStatus';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { cn } from '@/lib/utils';

const LEFT_SLOTS: StatusBarSlot[] = ['agent', 'jobs', 'wiki', 'tab', 'clipboard'];

function SlotItems({ slotItems }: { slotItems: StatusBarItem[] }) {
  return (
    <>
      {slotItems.map((item) => {
        const inner = (
          <span className="flex items-center gap-1 truncate" title={item.title}>
            {item.content}
          </span>
        );
        return item.onClick ? (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            title={item.title}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08] transition-colors cursor-pointer truncate max-w-64"
          >
            {inner}
          </button>
        ) : (
          <span
            key={item.id}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-muted-foreground truncate max-w-64"
          >
            {inner}
          </span>
        );
      })}
    </>
  );
}

/** 기본 퍼블리셔: 기본 에이전트명·연결 상태·실행 중 표시. */
function AgentStatusPublisher() {
  const { t } = useLanguage();
  const { defaultAgent, agents } = useAgents();
  const { publish, clear } = useStatusBar();
  const openAgentWorkbench = useOpenAgentWorkbench();
  const busySessionId = useGlobalLlmBusy();
  const [connByAgent, setConnByAgent] = useState<Record<string, boolean>>({});
  const connected = agents.length === 0 ? null : (connByAgent[defaultAgent.id] ?? null);

  useEffect(() => {
    if (agents.length === 0) return;
    let active = true;
    const check = () => {
      void checkAgentConnection(defaultAgent).then((status) => {
        if (active) {
          setConnByAgent((prev) => ({ ...prev, [defaultAgent.id]: status === 'connected' }));
        }
      });
    };
    check();
    const timer = setInterval(check, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [defaultAgent, agents.length]);

  useEffect(() => {
    if (agents.length === 0) {
      publish('agent', {
        id: 'default-agent',
        content: (
          <>
            <Bot className="h-3 w-3" />
            <span>{t('statusBar.noAgent')}</span>
          </>
        ),
        title: t('statusBar.agent'),
      });
      return () => clear('agent', 'default-agent');
    }
    const dot =
      connected === null ? 'bg-muted-foreground/50' : connected ? 'bg-success' : 'bg-destructive';
    const stateLabel =
      connected === null
        ? t('statusBar.checking')
        : connected
          ? t('statusBar.connected')
          : t('statusBar.disconnected');
    publish('agent', {
      id: 'default-agent',
      content: (
        <>
          <span className={cn('h-2 w-2 rounded-full shrink-0', dot)} />
          <span className="font-medium text-foreground/80">{defaultAgent.name}</span>
          <span className="font-mono opacity-70">{defaultAgent.model}</span>
          {busySessionId !== null && (
            <span className="text-warning font-medium">{t('statusBar.running')}</span>
          )}
        </>
      ),
      title: `${t('statusBar.openAgentEdit')} — ${stateLabel}`,
      onClick: () => openAgentWorkbench(defaultAgent, 'edit'),
    });
    return () => clear('agent', 'default-agent');
  }, [publish, clear, t, agents.length, defaultAgent, connected, busySessionId, openAgentWorkbench]);

  return null;
}

export function StatusBar() {
  const { items } = useStatusBar();

  return (
    <footer
      aria-label="Status Bar"
      className="h-6 w-full shrink-0 flex items-center justify-between gap-2 px-2 bg-titlebar border-t border-border/80 text-muted-foreground select-none overflow-hidden"
    >
      <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
        {LEFT_SLOTS.map((slot) =>
          items[slot].length > 0 ? (
            <div key={slot} className="flex items-center gap-1 min-w-0 shrink-0">
              <SlotItems slotItems={items[slot]} />
            </div>
          ) : null,
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0 min-w-0 max-w-[50%] overflow-hidden">
        <SlotItems slotItems={items.message} />
      </div>
      <AgentStatusPublisher />
    </footer>
  );
}

export default StatusBar;
