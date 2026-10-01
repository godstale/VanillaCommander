import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Bot, Cpu, Sparkles, MessageSquare, Terminal, Zap, Layers, Activity } from 'lucide-react';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import type { ReasoningEffort, ReasoningMode } from '@/lib/types/agent';
import { chatConfigSignature, DEFAULT_TEMPERATURE } from '@/lib/types/agent';
import { useAgents } from '@/lib/context/AgentsContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useWorkspace } from '@/lib/context/WorkspaceContext';
import { useChatSessions } from '@/lib/context/ChatSessionsContext';
import { useSafeSkills } from '@/lib/context/SkillsContext';
import { useChat } from '@/hooks/useChat';
import { useChatQueue, chatQueueManager } from '@/lib/agent/chatQueueManager';
import { ChatQueueFloatingDock } from '@/components/chat/ChatQueueFloatingDock';
import { MessageList } from '@/components/chat/MessageList';
import { ChatInput } from '@/components/chat/ChatInput';
import { ChatMacroDialog } from '@/components/chat/ChatMacroDialog';
import {
  deleteChatMacro,
  loadChatMacros,
  migrateLegacySessionLog,
  saveChatMacro,
  type ChatMacro,
} from '@/lib/chat/chatMacros';
import { ChatExecutionLog } from '@/components/chat/ChatExecutionLog';
import { ErrorBanner } from '@/components/chat/ErrorBanner';
import { EvalLockBanner } from '@/components/eval/EvalLockBanner';
import { evalLock } from '@/lib/eval/evalLock';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import * as sessionsRepo from '@/lib/db/repositories/sessionsRepo';
import { setActiveApprovalMode } from '@/lib/approval/register';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { getProviderPreset } from '@/lib/llm/providers';
import { monitoringCollector } from '@/lib/monitoring/monitoringCollector';
import { cn } from '@/lib/utils';

export interface ChatTabProps {
  tab: WorkspaceTab;
}

export function ChatTab({ tab }: ChatTabProps) {
  const { t } = useLanguage();
  const { getAgent, defaultAgent, loading: agentsLoading } = useAgents();
  const { settings } = useSettings();
  const { updateTab, openTab } = useWorkspaceTabs();
  const { workspaceRoot } = useWorkspace();
  const { sessions, refreshSessions, updateSessionTitle } = useChatSessions();
  const skillsCtx = useSafeSkills();

  const sessionId = (tab.meta?.sessionId as string) || (tab.id.startsWith('chat:') ? tab.id.slice(5) : tab.id);

  const {
    queue: queuedItems,
    isPaused,
    busySessionId,
    isLockedByOtherSession,
    isThisSessionBusy,
    enqueue,
    removeItem,
    clearQueue,
    dequeueItem,
    resumeQueue,
    pauseQueue,
  } = useChatQueue(sessionId);

  const busySession = useMemo(() => {
    if (!busySessionId) return null;
    return sessions.find((s) => s.id === busySessionId);
  }, [sessions, busySessionId]);
  const busySessionTitle = busySession?.title || t('chatTab.otherSession');

  const tabAgentId = tab.meta?.agentId as string | undefined;

  // 채팅 화면은 하나의 에이전트 설정에 귀속된다. 에이전트 전환 UI는 제공하지 않으며,
  // effectiveAgentId는 탭 meta → 세션 저장값 → 기본 에이전트 순으로 고정된다.
  const session = useMemo(
    () => sessions.find((s) => s.id === sessionId),
    [sessions, sessionId],
  );
  const effectiveAgentId = tabAgentId ?? session?.agentId ?? defaultAgent.id;
  const isAgentDeleted =
    !agentsLoading && !!effectiveAgentId && !getAgent(effectiveAgentId);
  // 세션 단위 reasoning/effort 오버라이드. 'agent'면 Agent 기본 설정을 따른다.
  // think 최상위 필드로만 전달되므로 변경해도 시스템 프롬프트가 변하지 않아 prefill 오버헤드가 없다.
  const [reasoningOverride, setReasoningOverride] = useState<ReasoningMode | 'agent'>('agent');
  const [effortOverride, setEffortOverride] = useState<ReasoningEffort | 'agent'>('agent');
  const [viewMode, setViewMode] = useState<'chat' | 'log'>('chat');
  const [yoloMode, setYoloMode] = useState<boolean>(false);
  const [compactDialogOpen, setCompactDialogOpen] = useState<boolean>(false);
  const [compactCustomInstruction, setCompactCustomInstruction] = useState<string>('');
  const [isCompacting, setIsCompacting] = useState<boolean>(false);

  const [sessionWorkspaceRoot, setSessionWorkspaceRoot] = useState<string | null>(null);
  const [customInputHeight, setCustomInputHeight] = useState<number | null>(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = inputContainerRef.current?.getBoundingClientRect().height ?? 110;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaY = startYRef.current - moveEvent.clientY;
      const minH = 80;
      const maxH = Math.min(window.innerHeight * 0.75, 600);
      const nextHeight = Math.max(minH, Math.min(maxH, startHeightRef.current + deltaY));
      setCustomInputHeight(Math.round(nextHeight));
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleResetInputHeight = () => {
    setCustomInputHeight(null);
  };

  const activeAgent = getAgent(effectiveAgentId) || defaultAgent;
  const providerPreset = getProviderPreset(activeAgent.llmProvider);

  const [isMonitoringActive, setIsMonitoringActive] = useState<boolean>(() =>
    monitoringCollector.isRunning(activeAgent.id),
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external collector running flag on agent switch
    setIsMonitoringActive(monitoringCollector.isRunning(activeAgent.id));
    const timer = setInterval(() => {
      setIsMonitoringActive(monitoringCollector.isRunning(activeAgent.id));
    }, 2000);
    const unsubscribe = monitoringCollector.subscribe(activeAgent.id, () => {
      setIsMonitoringActive(true);
    });
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [activeAgent.id]);

  const handleOpenMonitor = useCallback(() => {
    openTab({
      id: `agent-monitor:${activeAgent.id}`,
      type: 'agent-monitor',
      title: t('agentList.monitor', { name: activeAgent.name }),
      meta: { agentId: activeAgent.id },
    });
  }, [openTab, activeAgent.id, activeAgent.name, t]);

  // Session row is created lazily on first send (handleSendMessage), so opening
  // a chat tab never registers it in the conversation list. Here we only
  // restore the workspace root for existing sessions.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await sessionsRepo.getSession(sessionId);
        if (!cancelled && existing?.workspaceRoot) {
          setSessionWorkspaceRoot(existing.workspaceRoot);
        }
      } catch (err) {
        console.error('Failed to load session workspace root:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // If the tab closes (or app unmounts) without any message ever sent, make
  // sure no empty history row survives. With lazy creation there is normally
  // no DB row at all; this only covers legacy rows / races.
  useEffect(() => {
    return () => {
      void (async () => {
        try {
          const existing = await sessionsRepo.getSession(sessionId);
          if (!existing) return;
          const { countEntries } = await import('@/lib/db/repositories/entriesRepo');
          const n = await countEntries(sessionId);
          if (n === 0) {
            await sessionsRepo.deleteSession(sessionId);
            try {
              await refreshSessions();
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore cleanup failure
        }
      })();
    };
  }, [sessionId, refreshSessions]);

  const effectiveCwd = workspaceRoot ?? sessionWorkspaceRoot ?? undefined;

  const thinkOverride = useMemo(() => ({
    reasoning: reasoningOverride === 'agent' ? undefined : reasoningOverride,
    effort: effortOverride === 'agent' ? undefined : effortOverride,
  }), [reasoningOverride, effortOverride]);

  const {
    messages,
    isStreaming,
    contextUsage,
    effectiveThink,
    configSnapshot,
    sendMessage,
    steer,
    stop,
    error,
    retry,
    compact,
    clearChat,
    injectInfoMessage,
    injectConfigNotice,
  } = useChat(sessionId, activeAgent, {
    cwd: effectiveCwd,
    thinkOverride,
    // 구 Agent(Provider 미설정)는 전역 Ollama 주소를 그대로 사용한다.
    // Agent 고유 llmBaseUrl이 있으면 useChat 내부에서 그쪽이 우선한다.
    baseUrl: settings.ollamaBaseUrl,
    globalCompactionDefaults: {
      defaultContextSize: settings.defaultContextSize,
      defaultReserveTokens: settings.defaultReserveTokens,
      defaultKeepRecentTokens: settings.defaultKeepRecentTokens,
    },
  });

  // 실행 설정이 바뀌면 채팅 중간에 안내를 표시한다.
  // 스냅샷이 각 사용자 말풍선에 이미 기록되므로 안내는 UI 전용(미저장)이다.
  const prevConfigSigRef = useRef<string | null>(null);
  useEffect(() => {
    const sig = chatConfigSignature(configSnapshot);
    if (prevConfigSigRef.current === null) {
      prevConfigSigRef.current = sig;
      return;
    }
    if (prevConfigSigRef.current === sig) return;
    prevConfigSigRef.current = sig;
    // 빈 채팅·삭제된 에이전트·스트리밍 중(셀렉터 잠금으로 원칙상 불가)의
    // 변경은 안내하지 않는다. 다음 턴부터 새 설정이 적용된다.
    if (messages.length === 0 || isAgentDeleted || isStreaming) return;
    injectConfigNotice(configSnapshot, t('chatTab.configChanged'));
  }, [configSnapshot, messages.length, isAgentDeleted, isStreaming, injectConfigNotice, t]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      // 삭제된 에이전트 설정의 채팅은 대화를 지속할 수 없다.
      // 평가 실행 중에는 전송·큐잉 모두 금지된다(D5).
      if (isAgentDeleted || evalLock.get()) return;
      chatQueueManager.setSessionBusy(sessionId);
      const isFirstUserMessage = messages.filter((m) => m.role === 'user').length === 0;

      // Ensure session in DB and context
      try {
        const existing = await sessionsRepo.getSession(sessionId);
        if (!existing) {
          await sessionsRepo.createSession({
            id: sessionId,
            agentId: activeAgent.id,
            workspaceRoot: workspaceRoot ?? null,
            title: tab.title || t('chatTab.newChat'),
          });
          await refreshSessions();
        }
      } catch (err) {
        console.error('Failed to ensure session before sending message:', err);
      }

      await sendMessage(text);

      // If this is the first message, extract title and sync to tab & sessions list
      if (isFirstUserMessage) {
        const clean = text.replace(/^[/#]\w+:\w+\s*/, '').replace(/\s+/g, ' ').trim();
        const snippet = clean.length > 22 ? clean.slice(0, 22) + '...' : clean;
        if (snippet) {
          try {
            await updateSessionTitle(sessionId, snippet);
            updateTab(tab.id, { title: snippet });
            await refreshSessions();
          } catch (err) {
            console.error('Failed to update session title:', err);
          }
        }
      }
    },
    [messages, sessionId, activeAgent.id, workspaceRoot, tab.title, tab.id, sendMessage, updateSessionTitle, updateTab, refreshSessions, t, isAgentDeleted],
  );

  const handleSlashCommand = useCallback(
    async (command: string, args?: string): Promise<boolean> => {
      switch (command) {
        case 'clear':
          await clearChat();
          injectInfoMessage(t('chatTab.cleared'));
          return true;

        case 'usage': {
          const limit = contextUsage?.limit || activeAgent.contextSize || 8192;
          const tokens = contextUsage?.tokens || 0;
          const pct = Math.round((tokens / limit) * 100);
          const userCount = messages.filter((m) => m.role === 'user').length;
          const assistantCount = messages.filter((m) => m.role === 'assistant').length;

          injectInfoMessage(
            `### 📊 ${t('chatTab.usageTitle')}\n` +
            `- **${t('chatTab.usageTokens')}**: \`${tokens.toLocaleString()} / ${limit.toLocaleString()}\` (${pct}%)\n` +
            `- **${t('chatTab.userTurns', { n: userCount })}**\n` +
            `- **${t('chatTab.assistantTurns', { n: assistantCount })}**\n` +
            `- **${t('chatTab.activeModel')}**: \`${activeAgent.model}\``,
          );
          return true;
        }

        case 'agent':
          injectInfoMessage(
            `### 🤖 ${t('chatTab.agentTitle')} (\`${activeAgent.name}\`)\n` +
            `- **${t('chatTab.provider')}**: \`${providerPreset.label}\`\n` +
            `- **${t('chatTab.modelId')}**: \`${activeAgent.model}\`\n` +
            `- **${t('chatTab.approvalMode')}**: \`${yoloMode ? 'never (YOLO)' : activeAgent.approvalMode}\`\n` +
            `- **${t('chatTab.contextSize')}**: \`${(activeAgent.contextSize || 8192).toLocaleString()} tokens\`\n` +
            `- **${t('chatTab.temperature')}**: \`${activeAgent.temperature ?? DEFAULT_TEMPERATURE}\`\n` +
            `- **${t('chatTab.reasoning')}**: \`${activeAgent.reasoning ?? 'default'}\` / \`${activeAgent.reasoningEffort ?? 'medium'}\` → think: \`${String(effectiveThink ?? 'default')}\`\n` +
            `- **${t('chatTab.generation')}**: \`top-p ${activeAgent.topP ?? 'auto'} · top-k ${activeAgent.topK ?? 'auto'} · repeat ${activeAgent.repeatPenalty ?? 'auto'} · freq ${activeAgent.frequencyPenalty ?? 'auto'} · pres ${activeAgent.presencePenalty ?? 'auto'} · seed ${activeAgent.seed ?? 'auto'} · max ${activeAgent.maxOutputTokens ?? 'auto'}\`\n` +
            `- **${t('chatTab.enabledTools')}**: \`${(activeAgent.enabledBuiltinTools || []).join(', ')}\``,
          );
          return true;

        case 'yolo': {
          const next = !yoloMode;
          setYoloMode(next);
          setActiveApprovalMode(next ? 'never' : activeAgent.approvalMode);
          injectInfoMessage(
            next
              ? t('chatTab.yoloOn')
              : t('chatTab.yoloOff'),
          );
          return true;
        }

        case 'settings':
          openTab({
            id: `agent-editor:${activeAgent.id}`,
            type: 'agent-editor',
            title: t('chatTab.editAgent', { name: activeAgent.name }),
            meta: { agentId: activeAgent.id },
          });
          return true;

        case 'skills': {
          const skillsList = skillsCtx?.skills || [];
          if (skillsList.length === 0) {
            injectInfoMessage(t('chatTab.noSkills'));
          } else {
            const skillLines = skillsList
              .map((s) => `- **/skill:${s.name}**: ${s.description} (${s.source === 'workspace' ? t('chatInput.sourceWorkspace') : t('chatInput.sourceGlobal')})`)
              .join('\n');
            injectInfoMessage(`### 🧩 ${t('chatTab.skillsHeader', { n: skillsList.length })}\n${skillLines}`);
          }
          return true;
        }

        case 'pwd':
          injectInfoMessage(
            t('chatTab.pwd', { dir: workspaceRoot || t('chatTab.pwdEmpty') }),
          );
          return true;

        case 'compact':
          if (args) {
            setCompactCustomInstruction(args);
          }
          setCompactDialogOpen(true);
          return true;

        case 'status':
          injectInfoMessage(
            `### 🏰 ${t('chatTab.appInfo')}\n` +
            `- **${t('chatTab.version')}**: \`0.1.0\` (Tauri 2 + React 19)\n` +
            `- **${t('chatTab.endpoint')}**: \`http://localhost:11434\`\n` +
            `- **${t('chatTab.workspace', { value: workspaceRoot || t('chatTab.workspaceEmpty') })}**\n` +
            `- **${t('chatTab.approvalPolicy')}**: \`${yoloMode ? 'never (YOLO)' : activeAgent.approvalMode}\``,
          );
          return true;

        default:
          return false;
      }
    },
    [
      clearChat,
      injectInfoMessage,
      contextUsage,
      activeAgent,
      providerPreset.label,
      messages,
      yoloMode,
      effectiveThink,
      openTab,
      skillsCtx?.skills,
      workspaceRoot,
      t,
    ],
  );

  const handleExecuteCompaction = async () => {
    if (isAgentDeleted) {
      setCompactDialogOpen(false);
      return;
    }
    setIsCompacting(true);
    try {
      await compact(compactCustomInstruction.trim() || undefined);
      setCompactDialogOpen(false);
      setCompactCustomInstruction('');
      injectInfoMessage(t('chatTab.compactDone'));
    } catch (err) {
      console.error('Compaction dialog error:', err);
    } finally {
      setIsCompacting(false);
    }
  };

  // Queue processing logic: sequentially execute queued items in FIFO order
  const isProcessingQueueRef = useRef(false);

  const processNextQueueItem = useCallback(async () => {
    if (isStreaming || isProcessingQueueRef.current || isAgentDeleted) return;
    const nextItem = chatQueueManager.peek(sessionId);
    if (!nextItem) {
      chatQueueManager.setSessionIdle(sessionId);
      return;
    }

    isProcessingQueueRef.current = true;
    const item = chatQueueManager.dequeue(sessionId);
    if (!item) {
      isProcessingQueueRef.current = false;
      return;
    }

    try {
      if (item.type === 'slash_command' && item.commandName) {
        await handleSlashCommand(item.commandName, item.commandArgs);
      } else {
        await handleSendMessage(item.text);
      }
    } catch (err) {
      console.error('Error executing queued item:', err);
    } finally {
      isProcessingQueueRef.current = false;
    }
  }, [isStreaming, sessionId, handleSlashCommand, handleSendMessage, isAgentDeleted]);

  // Synchronize LLM streaming execution state with ChatQueueManager
  // Ensures any session running LLM inference immediately locks all other chat sessions even with 0 queued items
  useEffect(() => {
    chatQueueManager.setSessionRunning(sessionId, isStreaming);
  }, [sessionId, isStreaming]);

  // When error halts LLM execution and queued items remain, pause queue for user decision
  useEffect(() => {
    if (error && queuedItems.length > 0) {
      pauseQueue();
    }
  }, [error, queuedItems.length, pauseQueue]);

  useEffect(() => {
    if (!isStreaming && queuedItems.length > 0) {
      // If queue is paused, wait for user intervention!
      if (isPaused) return;

      const timer = setTimeout(() => {
        void processNextQueueItem();
      }, 0);
      return () => clearTimeout(timer);
    } else if (!isStreaming && queuedItems.length === 0) {
      if (chatQueueManager.getBusySessionId() === sessionId) {
        chatQueueManager.setSessionIdle(sessionId);
      }
    }
  }, [isStreaming, queuedItems.length, isPaused, processNextQueueItem, sessionId]);

  const handleStop = useCallback(() => {
    stop();
    chatQueueManager.setSessionRunning(sessionId, false);
    if (queuedItems.length > 0) {
      pauseQueue();
    } else {
      chatQueueManager.setSessionIdle(sessionId);
    }
  }, [stop, sessionId, queuedItems.length, pauseQueue]);

  const handleResumeQueue = useCallback(async () => {
    resumeQueue();
    const timer = setTimeout(() => {
      void processNextQueueItem();
    }, 0);
    return () => clearTimeout(timer);
  }, [resumeQueue, processNextQueueItem]);

  const handleRunItem = useCallback(
    async (itemId: string) => {
      if (isAgentDeleted) return;
      resumeQueue();
      const item = dequeueItem(itemId);
      if (!item) return;

      try {
        if (item.type === 'slash_command' && item.commandName) {
          await handleSlashCommand(item.commandName, item.commandArgs);
        } else {
          await handleSendMessage(item.text);
        }
      } catch (err) {
        console.error('Error running selected queued item:', err);
      }
    },
    [resumeQueue, dequeueItem, handleSlashCommand, handleSendMessage, isAgentDeleted],
  );

  // Conversation macros: user prompts bundled into one auto-input unit.
  // Load enqueues everything paused so the user reviews/runs via the queue dock.
  const userPromptCount = messages.filter((m) => m.role === 'user').length;
  const [macros, setMacros] = useState<ChatMacro[]>([]);
  const [macroDialogOpen, setMacroDialogOpen] = useState(false);

  useEffect(() => {
    migrateLegacySessionLog(sessionId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate macro list on session switch
    setMacros(loadChatMacros());
  }, [sessionId]);

  const handleSaveLog = useCallback(() => {
    if (isAgentDeleted) return;
    const items = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content.trim())
      .filter((s) => s.length > 0);
    if (items.length === 0) return;
    // 시스템 자동 안내 등은 role이 system이라 위 필터에서 이미 제외된다.
    // 저장된 매크로는 프롬프트 히스토리(↑/↓)의 대상이 아니다.
    const macro = saveChatMacro(items, { agentId: effectiveAgentId });
    if (!macro) return;
    setMacros(loadChatMacros());
    injectInfoMessage(t('chatInput.macroSaved', { name: macro.name, n: items.length }));
  }, [messages, effectiveAgentId, injectInfoMessage, t, isAgentDeleted]);

  const handleLoadLog = useCallback(() => {
    if (isAgentDeleted || evalLock.get()) return;
    setMacros(loadChatMacros());
    setMacroDialogOpen(true);
  }, [isAgentDeleted]);

  const handleSelectMacro = useCallback((macro: ChatMacro) => {
    if (isAgentDeleted || evalLock.get()) return;
    const items = macro.items.filter((s) => s.trim().length > 0);
    if (items.length === 0) {
      injectInfoMessage(t('chatInput.noSavedLog'));
      return;
    }
    for (const itemText of items) {
      const slashMatch = itemText.match(/^\/(\w+)(?:\s+([\s\S]*))?$/);
      if (slashMatch) {
        enqueue({
          text: itemText,
          type: 'slash_command',
          commandName: slashMatch[1].toLowerCase(),
          commandArgs: slashMatch[2]?.trim(),
        });
      } else {
        enqueue({ text: itemText, type: 'message' });
      }
    }
    pauseQueue();
    setMacroDialogOpen(false);
    injectInfoMessage(t('chatInput.logLoaded', { n: items.length }));
  }, [enqueue, pauseQueue, injectInfoMessage, t, isAgentDeleted]);

  const handleDeleteMacro = useCallback((id: string) => {
    setMacros(deleteChatMacro(id));
  }, []);

  useEffect(() => {
    return () => {
      chatQueueManager.setSessionRunning(sessionId, false);
      if (chatQueueManager.getBusySessionId() === sessionId) {
        chatQueueManager.clearQueue(sessionId);
        chatQueueManager.setSessionIdle(sessionId);
      }
    };
  }, [sessionId]);

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/40 text-xs shrink-0 select-none">
        <div className="flex items-center gap-2 font-medium min-w-0">
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <span className="truncate">{tab.title}</span>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-md font-mono shrink-0">
            <Sparkles className="h-3 w-3 text-warning" />
            <span className="font-semibold text-foreground">{activeAgent.name}</span>
            <span className="text-muted-foreground/60">•</span>
            <span>{providerPreset.label}</span>
            <span className="text-muted-foreground/60">•</span>
            <Cpu className="h-3 w-3" />
            <span>{activeAgent.model}</span>
          </div>

          {yoloMode && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/20 text-destructive border border-destructive/30 text-[10px] font-semibold animate-pulse">
              <Zap className="h-3 w-3 fill-current" />
              <span>YOLO</span>
            </div>
          )}
        </div>

        {/* View Switcher Button (대화 보기 / 상세 로그 보기) */}
        <div className="flex items-center rounded-lg bg-muted/60 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setViewMode('chat')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              viewMode === 'chat'
                ? 'bg-background text-foreground font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>{t('chatTab.viewChat')}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('log')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              viewMode === 'log'
                ? 'bg-background text-foreground font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>{t('chatTab.viewLog')}</span>
          </button>
        </div>
      </div>

      {/* Error banner if present */}
      <ErrorBanner error={error} onRetry={() => { if (!isAgentDeleted) void retry(); }} />

      {/* 평가 실행 중 배너: 전송·큐잉 차단 안내 (P10-03, D5) */}
      <EvalLockBanner />

      {/* Deleted-agent notice: 기록은 읽을 수 있지만 대화를 지속할 수 없다 */}
      {isAgentDeleted && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-destructive bg-destructive/10 border-b border-destructive/20 font-medium shrink-0 select-none">
          <Bot className="h-3.5 w-3.5 shrink-0" />
          <span>{t('chatTab.agentDeleted')}</span>
        </div>
      )}

      {/* Content Area: Chat Messages OR Detailed Execution Log */}
      <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Monitoring status floating button (top-left) */}
        <button
          type="button"
          onClick={handleOpenMonitor}
          title={isMonitoringActive ? t('chatTab.monitoringOn') : t('chatTab.monitoringOff')}
          aria-label={isMonitoringActive ? t('chatTab.monitoringOn') : t('chatTab.monitoringOff')}
          className={`absolute left-3 top-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-medium shadow-md backdrop-blur transition-all hover:scale-105 active:scale-95 cursor-pointer ${
            isMonitoringActive
              ? 'bg-success/15 border-success/40 text-success'
              : 'bg-card/90 border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className="relative flex h-2 w-2">
            {isMonitoringActive && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                isMonitoringActive ? 'bg-success' : 'bg-muted-foreground/50'
              }`}
            />
          </span>
          <Activity className="h-3 w-3" />
          <span>{isMonitoringActive ? t('chatTab.monitoringActive') : t('chatTab.monitoringIdle')}</span>
        </button>
        {viewMode === 'chat' ? (
          <MessageList messages={messages} isStreaming={isStreaming} fallbackConfig={configSnapshot} />
        ) : (
          <ChatExecutionLog sessionId={tab.id} messages={messages} />
        )}
      </div>

      {/* Floating Queue UI Dock when there are queued items */}
      <ChatQueueFloatingDock
        items={queuedItems}
        isPaused={isPaused}
        onRemoveItem={removeItem}
        onClearQueue={clearQueue}
        onResumeQueue={handleResumeQueue}
        onRunItem={handleRunItem}
      />

      {/* Resizable handle for Chat Input Area */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('chatTab.resizeLabel')}
        onMouseDown={handleResizeStart}
        onDoubleClick={handleResetInputHeight}
        className="group relative h-2 -my-1 z-10 cursor-row-resize flex items-center justify-center hover:bg-primary/20 transition-colors select-none"
        title={t('chatTab.resizeTitle')}
      >
        <div className="w-10 h-1 rounded-full bg-border/80 group-hover:bg-primary transition-colors" />
      </div>

      {/* Input area */}
      <div
        ref={inputContainerRef}
        style={customInputHeight ? { height: `${customInputHeight}px` } : undefined}
        className={cn(
          'p-3 border-t border-border bg-card/20 shrink-0',
          customInputHeight ? 'flex flex-col overflow-hidden' : '',
        )}
      >
        <ChatInput
          onSend={handleSendMessage}
          onSteer={steer}
          onStop={handleStop}
          onCompact={compact}
          onOpenCompactDialog={() => setCompactDialogOpen(true)}
          onSlashCommand={handleSlashCommand}
          onQueue={enqueue}
          onSaveLog={handleSaveLog}
          onLoadLog={handleLoadLog}
          canSaveLog={userPromptCount > 0 && !isAgentDeleted}
          hasSavedLog={macros.length > 0}
          isStreaming={isStreaming}
          isLockedByOtherSession={isLockedByOtherSession}
          isThisSessionBusy={isThisSessionBusy || isStreaming || queuedItems.length > 0}
          busySessionTitle={busySessionTitle}
          agentReasoning={activeAgent.reasoning ?? 'default'}
          contextUsage={contextUsage}
          yoloMode={yoloMode}
          reasoningOverride={reasoningOverride}
          effortOverride={effortOverride}
          onReasoningOverrideChange={setReasoningOverride}
          onEffortOverrideChange={setEffortOverride}
          customHeight={customInputHeight ? Math.max(60, customInputHeight - 24) : null}
          isAgentDeleted={isAgentDeleted}
          sessionId={sessionId}
        />
      </div>

      {/* Manual Compaction Dialog */}
      <Dialog open={compactDialogOpen} onOpenChange={setCompactDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <Layers className="h-5 w-5 text-primary" />
              <DialogTitle className="text-base font-semibold">{t('chatTab.compactTitle')}</DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
              {t('chatTab.compactDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="p-3 rounded-lg bg-muted/40 border border-border/70 space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('chatTab.currentContext')}</span>
                <span className="font-semibold text-foreground">
                  {contextUsage?.tokens.toLocaleString() || 0} / {contextUsage?.limit.toLocaleString() || 8192} tokens
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('chatTab.messageCount')}</span>
                <span className="font-semibold text-foreground">{t('chatTab.messageUnit', { n: messages.length })}</span>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">
                {t('chatTab.customLabel')}
              </label>
              <input
                type="text"
                value={compactCustomInstruction}
                onChange={(e) => setCompactCustomInstruction(e.target.value)}
                placeholder={t('chatTab.customPlaceholder')}
                className="w-full px-2.5 py-1.5 rounded-md border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCompactDialogOpen(false)}
              disabled={isCompacting}
            >
              {t('chatTab.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleExecuteCompaction}
              disabled={isCompacting}
              className="gap-1.5 bg-primary text-primary-foreground"
            >
              {isCompacting ? (
                <span>{t('chatTab.compacting')}</span>
              ) : (
                <>
                  <Layers className="h-3.5 w-3.5" />
                  <span>{t('chatTab.compactRun')}</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Saved macro list: selecting one queues all of its prompts, deletion allowed */}
      <ChatMacroDialog
        open={macroDialogOpen}
        onOpenChange={setMacroDialogOpen}
        macros={macros}
        onSelect={handleSelectMacro}
        onDelete={handleDeleteMacro}
      />
    </div>
  );
}

export default ChatTab;

