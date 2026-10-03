import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Bot, Cpu, Sparkles, MessageSquare, Terminal, Zap, Layers, Activity } from 'lucide-react';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import type { ReasoningEffort, ReasoningMode } from '@/lib/types/agent';
import type { Agent } from '@/lib/types/agent';
import { chatConfigSignature, DEFAULT_TEMPERATURE } from '@/lib/types/agent';
import { useAgents } from '@/lib/context/AgentsContext';
import { useSettings } from '@/lib/context/SettingsContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { useWorkspace } from '@/lib/context/WorkspaceContext';
import { useChatSessions } from '@/lib/context/ChatSessionsContext';
import { useStatusBar } from '@/lib/context/StatusBarContext';
import { useSafeSkills } from '@/lib/context/SkillsContext';
import { useChat } from '@/hooks/useChat';
import { useChatQueue, chatQueueManager } from '@/lib/agent/chatQueueManager';
import { ChatQueueFloatingDock } from '@/components/chat/ChatQueueFloatingDock';
import { MessageList } from '@/components/chat/MessageList';
import { ChatInput } from '@/components/chat/ChatInput';
import { ChatMacroDialog } from '@/components/chat/ChatMacroDialog';
import { useMacros } from '@/lib/macros/useMacros';
import {
  migrateLegacySessionLog,
} from '@/lib/macros/chatMacros';
import { buildMacroName, type Macro } from '@/lib/macros/types';
import { ChatExecutionLog } from '@/components/chat/ChatExecutionLog';
import { ErrorBanner } from '@/components/chat/ErrorBanner';
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
import { AgentFallbackDialog } from '@/components/agents/AgentFallbackDialog';
import {
  buildCandidates,
  checkCandidatesHealth,
  getStoredFallbackAgentId,
  storeFallbackAgentId,
  type FallbackCandidate,
} from '@/lib/agent/resolveAgent';
import { checkAgentConnection } from '@/lib/llm/agentStatus';
import { resolveVisionSupport, type VisionVerdict } from '@/lib/llm/vision';
import { createWikiTool } from '@/lib/tools/wiki';
import type { AgentMessage } from '@/lib/agent/types';
import { cn } from '@/lib/utils';

export interface ChatTabProps {
  tab: WorkspaceTab;
  /** 탐색기 도크처럼 좁은 공간에 들어갈 때 헤더를 말줄임표 위주로 압축한다. */
  dense?: boolean;
}

export function ChatTab({ tab, dense = false }: ChatTabProps) {
  const { t } = useLanguage();
  const { getAgent, defaultAgent, agents, loading: agentsLoading } = useAgents();
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
  const { notify } = useStatusBar();

  // P11-25: 전송 직전 폴백 결정. 선택은 tab meta에 이번 세션 한정으로 기록한다.
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [fallbackCandidates, setFallbackCandidates] = useState<FallbackCandidate[]>([]);
  const [fallbackAgentName, setFallbackAgentName] = useState('');
  const fallbackResolveRef = useRef<((proceed: boolean) => void) | null>(null);

  // P11-26: 귀속 에이전트의 비전 판정. 이미지 첨부 시 전송 게이트로 쓴다.
  const [visionVerdict, setVisionVerdict] = useState<VisionVerdict>('unknown');
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 비동기 판정 전 로딩 상태로 초기화
    setVisionVerdict('unknown');
    void resolveVisionSupport(activeAgent).then((v) => {
      if (!cancelled) setVisionVerdict(v);
    });
    return () => {
      cancelled = true;
    };
  }, [activeAgent]);

  const applySessionAgent = useCallback((agentId: string) => {
    updateTab(tab.id, { meta: { ...(tab.meta ?? {}), agentId } });
  }, [updateTab, tab.id, tab.meta]);

  const finishFallback = useCallback((proceed: boolean) => {
    setFallbackOpen(false);
    const resolve = fallbackResolveRef.current;
    fallbackResolveRef.current = null;
    resolve?.(proceed);
  }, []);

  const handleFallbackPick = useCallback((agent: Agent, opts: { dontAsk: boolean }) => {
    if (opts.dontAsk) {
      storeFallbackAgentId(agent.id);
    }
    applySessionAgent(agent.id);
    notify(t('agentFallback.switched', { name: agent.name }));
    finishFallback(false);
  }, [applySessionAgent, notify, t, finishFallback]);

  const handleFallbackCancel = useCallback(() => {
    finishFallback(false);
  }, [finishFallback]);

  const resolveSendAgent = useCallback(async (agent: Agent): Promise<boolean> => {
    try {
      if ((await checkAgentConnection(agent)) === 'connected') return true;
    } catch {
      return false;
    }
    // 저장된 폴백(로컬만)이 살아 있으면 조용히 적용한다.
    try {
      const storedId = getStoredFallbackAgentId();
      const stored = storedId ? getAgent(storedId) : undefined;
      if (stored) {
        const storedStatus = await checkAgentConnection(stored);
        if (storedStatus === 'connected') {
          applySessionAgent(stored.id);
          notify(t('agentFallback.switched', { name: stored.name }));
          return false;
        }
      }
    } catch {
      // fall through to dialog
    }
    const statuses = await checkCandidatesHealth(agents, checkAgentConnection);
    setFallbackCandidates(buildCandidates(agents, statuses, agent.id));
    setFallbackAgentName(agent.name);
    setFallbackOpen(true);
    return new Promise<boolean>((resolve) => {
      fallbackResolveRef.current = resolve;
    });
  }, [agents, getAgent, applySessionAgent, notify, t]);

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
    onResolveSendAgent: resolveSendAgent,
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
    async (text: string, images?: string[]) => {
      // 삭제된 에이전트 설정의 채팅은 대화를 지속할 수 없다.
      if (isAgentDeleted) return;
      // P11-26: 비전 미지원 에이전트에 이미지를 보내면 폴백 다이얼로그로
      // 비전 에이전트를 제안한다. 이번 전송은 중단하고 사용자가 다시 보낸다.
      if (images && images.length > 0 && visionVerdict === 'no') {
        try {
          const statuses = await checkCandidatesHealth(agents, checkAgentConnection);
          setFallbackCandidates(buildCandidates(agents, statuses, activeAgent.id));
          setFallbackAgentName(activeAgent.name);
          setFallbackOpen(true);
        } catch (err) {
          console.error('Failed to open vision fallback dialog:', err);
        }
        return;
      }
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
            origin: 'chat',
            title: tab.title || t('chatTab.newChat'),
          });
          await refreshSessions();
        }
      } catch (err) {
        console.error('Failed to ensure session before sending message:', err);
      }

      await sendMessage(text, images && images.length > 0 ? { images } : undefined);

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
    [messages, sessionId, activeAgent.id, activeAgent.name, agents, visionVerdict, workspaceRoot, tab.title, tab.id, sendMessage, updateSessionTitle, updateTab, refreshSessions, t, isAgentDeleted],
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
        await handleSendMessage(item.text, item.images);
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
          await handleSendMessage(item.text, item.images);
        }
      } catch (err) {
        console.error('Error running selected queued item:', err);
      }
    },
    [resumeQueue, dequeueItem, handleSlashCommand, handleSendMessage, isAgentDeleted],
  );

  // P11-26: 어시스턴트 응답을 위키에 저장한다 (이미지 원본 경로는 출처 기록 불가 —
  // 입력 단계 data URL이므로 본문만 저장하고 출처는 세션 제목으로 남긴다).
  const [isSavingToWiki, setIsSavingToWiki] = useState(false);
  const handleSaveToWiki = useCallback(async (message: AgentMessage) => {
    if (message.role !== 'assistant' || !message.content.trim()) return;
    setIsSavingToWiki(true);
    try {
      const tool = createWikiTool({ workspaceRoot: effectiveCwd });
      const firstLine = message.content.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 60);
      const result = await tool.execute(
        crypto.randomUUID(),
        { action: 'ingest', title: firstLine || t('chat.wikiUntitled'), content: message.content },
        new AbortController().signal,
      );
      injectInfoMessage(t('chat.wikiSaved', { detail: result.content }));
    } catch (err) {
      injectInfoMessage(t('chat.wikiSaveFailed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsSavingToWiki(false);
    }
  }, [effectiveCwd, injectInfoMessage, t]);

  // Conversation macros: user prompts bundled into one auto-input unit.
  // Load enqueues everything paused so the user reviews/runs via the queue dock.
  // P11-40: DB 저장소를 쓴다 (localStorage는 최초 1회 이관 후 미사용).
  const userPromptCount = messages.filter((m) => m.role === 'user').length;
  const { macros, create: createMacro, remove: removeMacro } = useMacros();
  const [macroDialogOpen, setMacroDialogOpen] = useState(false);

  useEffect(() => {
    migrateLegacySessionLog(sessionId);
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
    void (async () => {
      const macro = await createMacro({
        name: buildMacroName(items, macros.map((m) => m.name)),
        prompts: items,
        agentId: effectiveAgentId,
        runRoot: '',
        schedule: { kind: 'none' },
      });
      injectInfoMessage(t('chatInput.macroSaved', { name: macro.name, n: items.length }));
    })();
  }, [messages, effectiveAgentId, injectInfoMessage, t, isAgentDeleted, createMacro, macros]);

  const handleLoadLog = useCallback(() => {
    if (isAgentDeleted) return;
    setMacroDialogOpen(true);
  }, [isAgentDeleted]);

  const handleSelectMacro = useCallback((macro: Macro) => {
    if (isAgentDeleted) return;
    const items = macro.prompts.filter((s) => s.trim().length > 0);
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
    void removeMacro(id);
  }, [removeMacro]);

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
    <div className="flex flex-col h-full w-full min-w-0 bg-editor overflow-hidden">
      {/* Header bar: 좁은 도크에서도 깨지지 않도록 전부 truncate + 필요 정보만 표시 */}
      <div className="flex items-center gap-2 px-2 py-2 border-b border-border bg-tabbar text-xs shrink-0 select-none min-w-0">
        <div className="flex items-center gap-1.5 font-medium min-w-0 flex-1 overflow-hidden">
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <span className="truncate min-w-0 max-w-32" title={tab.title}>{tab.title}</span>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-md font-mono shrink-0 min-w-0 max-w-full overflow-hidden whitespace-nowrap">
            <Sparkles className="h-3 w-3 text-warning shrink-0" />
            <span className="font-semibold text-foreground truncate min-w-0" title={activeAgent.name}>{activeAgent.name}</span>
            {!dense && (
              <>
                <span className="text-muted-foreground/60 shrink-0">•</span>
                <span className="truncate" title={providerPreset.label}>{providerPreset.label}</span>
                <span className="text-muted-foreground/60 shrink-0">•</span>
                <Cpu className="h-3 w-3 shrink-0" />
                <span className="truncate" title={activeAgent.model}>{activeAgent.model}</span>
              </>
            )}
          </div>

          {yoloMode && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/20 text-destructive border border-destructive/30 text-[10px] font-semibold animate-pulse shrink-0">
              <Zap className="h-3 w-3 fill-current" />
              <span>YOLO</span>
            </div>
          )}
        </div>

        {/* View Switcher Button (대화 보기 / 상세 로그 보기) */}
        <div className="flex items-center rounded-lg bg-muted/60 p-0.5 text-xs shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('chat')}
            title={t('chatTab.viewChat')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors cursor-pointer ${
              viewMode === 'chat'
                ? 'bg-background text-foreground font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0" />
            {!dense && <span className="truncate">{t('chatTab.viewChat')}</span>}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('log')}
            title={t('chatTab.viewLog')}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors cursor-pointer ${
              viewMode === 'log'
                ? 'bg-background text-foreground font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Terminal className="h-3.5 w-3.5 shrink-0" />
            {!dense && <span className="truncate">{t('chatTab.viewLog')}</span>}
          </button>
        </div>
      </div>

      {/* Error banner if present */}
      <ErrorBanner error={error} onRetry={() => { if (!isAgentDeleted) void retry(); }} />

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
          <MessageList
            messages={messages}
            isStreaming={isStreaming}
            fallbackConfig={configSnapshot}
            onSaveToWiki={handleSaveToWiki}
            isSavingToWiki={isSavingToWiki}
          />
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
          cwd={effectiveCwd}
          vision={visionVerdict}
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

      {/* P11-25: 기본 에이전트 장애 시 폴백 선택 */}
      <AgentFallbackDialog
        open={fallbackOpen}
        candidates={fallbackCandidates}
        failedAgentName={fallbackAgentName}
        onPick={handleFallbackPick}
        onCancel={handleFallbackCancel}
      />
    </div>
  );
}

export default ChatTab;

