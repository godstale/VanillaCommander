import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Agent, ReasoningEffort, ReasoningMode } from '@/lib/types/agent';
import { captureChatConfigSnapshot, resolveThinkValue } from '@/lib/types/agent';
import type { ChatConfigSnapshot } from '@/lib/types/agent';
import type { AgentEvent, AgentMessage } from '@/lib/agent/types';
import { SYSTEM_AUTO_GUIDE_PREFIX } from '@/lib/agent/types';
import type { SkillManifest } from '@/lib/types/skill';
import type { ContextFileItem } from '@/lib/skills/contextFiles';
import { FortressAgent } from '@/lib/agent/agent';
import { getBuiltinTools } from '@/lib/tools/registry';
import { buildSystemPromptSections, formatSystemPrompt } from '@/lib/prompt/buildSystemPrompt';
import { getVisualizationPromptSection } from '@/lib/prompt/visualizationSection';
import { diffSections } from '@/lib/prompt/diffSections';
import { useSafeSkills } from '@/lib/context/SkillsContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import {
  getStreamChatFn,
  resolveAgentLlmRuntime,
  type LlmStreamChatFn,
} from '@/lib/llm/providerRuntime';

import {
  type ChatPersistence,
  defaultSqlitePersistence,
} from '@/lib/db/sqlitePersistence';
import { setActiveCompactionSession } from '@/lib/compaction/register';
import { resolveCompactionSettings } from '@/lib/compaction/settings';
import { prepareCompaction, executeCompact } from '@/lib/compaction/compact';
import { approvalBus } from '@/lib/approval/approvalBus';
import { setActiveApprovalMode } from '@/lib/approval/register';
import * as entriesRepo from '@/lib/db/repositories/entriesRepo';
import { buildLlmContext } from '@/lib/db/buildContext';
import { appLogger } from '@/lib/logger/logger';
import { bindSessionToAgent } from '@/lib/monitoring/agentPhaseTracker';
import { monitoringCollector } from '@/lib/monitoring/monitoringCollector';
import { isAutoMonitorEnabled } from '@/lib/types/agent';
import { evalLock } from '@/lib/eval/evalLock';

export type { ChatPersistence };

export interface UseChatOptions {
  persistence?: ChatPersistence;
  baseUrl?: string;
  /** 클라우드/인증 서버용 API 키 (Agent 고유값이 있으면 그쪽이 우선) */
  apiKey?: string;
  streamChatFn?: LlmStreamChatFn;
  cwd?: string;
  skills?: SkillManifest[];
  contextFiles?: ContextFileItem[];
  /** 전역 압축 기본값 (SettingsModel). 0=auto 항목의 단계표 해석에 쓴다. */
  globalCompactionDefaults?: {
    defaultContextSize?: number;
    defaultReserveTokens?: number;
    defaultKeepRecentTokens?: number;
  };
  /**
   * 세션 단위 reasoning 오버라이드 (채팅 화면의 effort 셀렉터).
   * undefined 필드는 Agent 기본값을 따른다. think는 요청 최상위 필드로만 전달되므로
   * 여기서 값을 바꿔도 시스템 프롬프트/메시지가 변하지 않아 prefill 오버헤드가 없다.
   */
  thinkOverride?: {
    reasoning?: ReasoningMode;
    effort?: ReasoningEffort;
  };
}

export interface UseChatReturn {
  messages: AgentMessage[];
  isStreaming: boolean;
  contextUsage: { tokens: number; limit: number };
  /** 현재 턴에 적용되는 Ollama think 값 (Agent 기본값 + 세션 오버라이드 해석 결과) */
  effectiveThink: boolean | string | undefined;
  /** 전송 시점에 캡처한 유효 실행 설정 (말풍선 [i]·변경 안내의 기준) */
  configSnapshot: ChatConfigSnapshot;
  sendMessage: (text: string) => Promise<void>;
  steer: (text: string) => void;
  stop: () => void;
  error: Error | null;
  retry: () => Promise<void>;
  compact: (customInstructions?: string) => Promise<void>;
  clearChat: () => Promise<void>;
  injectInfoMessage: (content: string) => void;
  /** 설정 변경 안내를 채팅 중간에 표시한다 (UI 전용, 저장·LLM 전송 없음). */
  injectConfigNotice: (snapshot: ChatConfigSnapshot, summary: string) => void;
}

export function useChat(
  sessionId: string,
  agentConfig: Agent,
  options: UseChatOptions = {},
): UseChatReturn {
  const persistence = options.persistence ?? defaultSqlitePersistence;
  const skillsCtx = useSafeSkills();
  const workspaceCtx = useSafeWorkspace();
  const effectiveCwd = options.cwd ?? workspaceCtx?.workspaceRoot ?? undefined;

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [contextTokens, setContextTokens] = useState<number>(0);
  const lastPromptRef = useRef<string>('');
  const persistedCountRef = useRef<number>(0);

  const contextLimit = useMemo(() => {
    // 0 = auto → 전역 기본값(없으면 8192)으로 폴백한다.
    if (agentConfig.contextSize > 0) return agentConfig.contextSize;
    return options.globalCompactionDefaults?.defaultContextSize || 8192;
  }, [agentConfig.contextSize, options.globalCompactionDefaults?.defaultContextSize]);

  const compactionSettings = useMemo(() => {
    return resolveCompactionSettings(agentConfig, options.globalCompactionDefaults);
  }, [agentConfig, options.globalCompactionDefaults]);

  // Agent의 LLM Provider 설정을 실제 접속 정보로 해석한다.
  // Agent 고유값이 있으면 우선하고, 없으면 useChat 옵션(전역 설정 전달용)을 사용한다.
  const llmRuntime = useMemo(() => {
    return resolveAgentLlmRuntime(
      {
        llmProvider: agentConfig.llmProvider,
        llmBaseUrl: agentConfig.llmBaseUrl ?? options.baseUrl,
        llmApiKey: agentConfig.llmApiKey ?? options.apiKey,
      },
      options.baseUrl,
    );
  }, [agentConfig.llmProvider, agentConfig.llmBaseUrl, agentConfig.llmApiKey, options.baseUrl, options.apiKey]);

  useEffect(() => {
    setActiveCompactionSession({
      sessionId,
      model: agentConfig.model,
      baseUrl: llmRuntime.baseUrl,
      apiKey: llmRuntime.apiKey,
      provider: llmRuntime.kind,
      settings: compactionSettings,
    });
  }, [sessionId, agentConfig.model, llmRuntime, compactionSettings]);

  // Build tools from agent's enabledBuiltinTools
  const tools = useMemo(() => {
    return getBuiltinTools(agentConfig.enabledBuiltinTools, {
      workspaceRoot: effectiveCwd,
    });
  }, [agentConfig.enabledBuiltinTools, effectiveCwd]);

  // Read skills and context files from options or context
  const rawSkills = useMemo(() => {
    return options.skills ?? skillsCtx?.activeSkillsForPrompt ?? [];
  }, [options.skills, skillsCtx?.activeSkillsForPrompt]);

  const rawContextFiles = useMemo(() => {
    return options.contextFiles ?? skillsCtx?.contextFiles ?? [];
  }, [options.contextFiles, skillsCtx?.contextFiles]);

  // Filter skills by agentConfig.enabledSkills if specified
  const filteredSkills = useMemo(() => {
    if (agentConfig.enabledSkills && agentConfig.enabledSkills.length > 0) {
      const allowed = new Set(agentConfig.enabledSkills);
      return rawSkills.filter((s) => allowed.has(s.name));
    }
    return rawSkills;
  }, [rawSkills, agentConfig.enabledSkills]);

  // Construct system prompt using section builder
  const currentSections = useMemo(() => {
    return buildSystemPromptSections({
      agent: {
        systemPrompt: agentConfig.systemPrompt,
      },
      tools,
      contextFiles: rawContextFiles,
      skills: filteredSkills,
      visualization: getVisualizationPromptSection(),
      cwd: effectiveCwd,
    });
  }, [agentConfig.systemPrompt, tools, rawContextFiles, filteredSkills, effectiveCwd]);

  const systemPrompt = useMemo(() => {
    return formatSystemPrompt(currentSections);
  }, [currentSections]);

  // Keep latest refs to prevent tearing down the agent on parent re-renders.
  // (자동 모니터링 헬퍼보다 먼저 선언·동기화한다 — ref를 캡처한 훅보다
  //  수정 이펙트가 뒤에 오면 react-hooks/immutability 위반이 된다.)
  const agentConfigRef = useRef(agentConfig);
  const systemPromptRef = useRef(systemPrompt);
  const toolsRef = useRef(tools);
  const optionsRef = useRef(options);

  useEffect(() => {
    agentConfigRef.current = agentConfig;
    systemPromptRef.current = systemPrompt;
    toolsRef.current = tools;
    optionsRef.current = options;
  });

  // Agent instance ref
  const agentRef = useRef<FortressAgent | null>(null);
  const llmRuntimeRef = useRef(llmRuntime);
  const cwdRef = useRef(effectiveCwd);
  useEffect(() => {
    llmRuntimeRef.current = llmRuntime;
    cwdRef.current = effectiveCwd;
  }, [llmRuntime, effectiveCwd]);

  // 자동 모니터링으로 시작된 에이전트 id. 자동 중단 시 이 id만 정리하며,
  // 사용자가 모니터 탭에서 수동으로 시작한 수집은 건드리지 않는다.
  const autoMonitorAgentIdRef = useRef<string | null>(null);

  const startAutoMonitoring = useCallback(() => {
    const cfg = agentConfigRef.current;
    if (!isAutoMonitorEnabled(cfg)) return;
    try {
      monitoringCollector.startAuto(
        cfg,
        llmRuntimeRef.current.baseUrl,
        monitoringCollector.getInterval(cfg.id),
        cwdRef.current ?? null,
      );
      autoMonitorAgentIdRef.current = cfg.id;
    } catch {
      // 모니터링 시작 실패(연결 불가 등)는 대화 진행에 영향을 주지 않는다.
    }
  }, []);

  const stopAutoMonitoring = useCallback(() => {
    const id = autoMonitorAgentIdRef.current ?? agentConfigRef.current.id;
    autoMonitorAgentIdRef.current = null;
    try {
      monitoringCollector.stopAuto(id);
    } catch {
      // ignore
    }
  }, []);

  // Event handler for agent notifications
  const handleAgentEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'agent_start':
        setIsStreaming(true);
        setError(null);
        startAutoMonitoring();
        break;

      case 'message_update': {
        setMessages((prev) => {
          const lastIdx = prev.length - 1;
          const lastMsg = prev[lastIdx];
          if (lastMsg && lastMsg.role === 'assistant') {
            const updated = [...prev];
            updated[lastIdx] = event.message;
            return updated;
          }
          return [...prev, event.message];
        });
        break;
      }

      case 'message_end': {
        if (event.message.role === 'assistant' && event.message.usage) {
          setContextTokens(event.message.usage.total);
        }
        setMessages((prev) => {
          const lastIdx = prev.length - 1;
          const lastMsg = prev[lastIdx];
          if (lastMsg && lastMsg.role === 'assistant') {
            const updated = [...prev];
            updated[lastIdx] = event.message;
            return updated;
          }
          return [...prev, event.message];
        });
        break;
      }

      case 'tool_execution_end': {
        // Add toolResult message as soon as execution finishes
        const toolResultMsg: AgentMessage = {
          role: 'toolResult',
          toolCallId: event.toolCallId,
          toolName: event.toolName || event.toolCallId,
          content: event.result.content,
          isError: event.isError,
        };
        setMessages((prev) => [...prev, toolResultMsg]);
        break;
      }

      case 'turn_end': {
        const turnMsgs = [event.message, ...(event.toolResults || [])];
        persistedCountRef.current += turnMsgs.length;
        void persistence.saveTurn?.(sessionId, turnMsgs);
        break;
      }

      case 'agent_end': {
        setIsStreaming(false);
        stopAutoMonitoring();
        // 시스템 프롬프트 등 내부 system 메시지는 UI에서 숨기되, 자동 복구
        // 안내(system 역할)는 별색 시스템 말풍선으로 보여주고 영속화한다.
        const visibleMessages = event.messages.filter(
          (m) => m.role !== 'system' || m.content.startsWith(SYSTEM_AUTO_GUIDE_PREFIX),
        );
        setMessages(visibleMessages);
        if (visibleMessages.length > persistedCountRef.current) {
          const unpersisted = visibleMessages.slice(persistedCountRef.current);
          persistedCountRef.current = visibleMessages.length;
          void persistence.saveTurn?.(sessionId, unpersisted);
        }
        break;
      }

      case 'compaction_end': {
        void persistence.loadMessages(sessionId).then((loaded) => {
          setMessages(loaded);
          persistedCountRef.current = loaded.length;
        });
        break;
      }

      case 'error': {
        setIsStreaming(false);
        setError(event.error);
        stopAutoMonitoring();
        break;
      }
    }
  }, [persistence, sessionId, startAutoMonitoring, stopAutoMonitoring]);

  const eventHandlerRef = useRef(handleAgentEvent);
  useEffect(() => {
    eventHandlerRef.current = handleAgentEvent;
  }, [handleAgentEvent]);

  // Agent 기본값 + 세션 오버라이드를 Ollama think 값으로 해석.
  // 메시지 배열에 손대지 않으므로 동적 변경 시에도 prefill 토큰이 늘지 않는다.
  const effectiveThink = useMemo(() => {
    return resolveThinkValue(
      options.thinkOverride?.reasoning ?? agentConfig.reasoning,
      options.thinkOverride?.effort ?? agentConfig.reasoningEffort,
    );
  }, [options.thinkOverride?.reasoning, options.thinkOverride?.effort, agentConfig.reasoning, agentConfig.reasoningEffort]);

  // 세션 오버라이드/Agent 설정이 바뀌면 실행 중인 인스턴스에도 즉시 반영.
  // 다음 LLM 호출(다음 턴)부터 적용되며, 진행 중인 스트림은 끊지 않는다.
  useEffect(() => {
    agentRef.current?.setThink(effectiveThink);
  }, [effectiveThink]);

  // 전송 시점의 유효 실행 설정. 사용자 메시지 스냅샷·변경 감지의 기준이다.
  const configSnapshot = useMemo(() => {
    return captureChatConfigSnapshot(
      agentConfig,
      {
        reasoning: options.thinkOverride?.reasoning,
        effort: options.thinkOverride?.effort,
      },
      effectiveThink,
    );
  }, [
    agentConfig,
    options.thinkOverride?.reasoning,
    options.thinkOverride?.effort,
    effectiveThink,
  ]);

  const createAgentInstance = useCallback(
    (initial: AgentMessage[]) => {
      const cfg = agentConfigRef.current;
      const opts = optionsRef.current;
      const effectiveNumCtx =
        cfg.contextSize > 0 ? cfg.contextSize : (contextLimit > 0 ? contextLimit : 8192);
      const runtime = resolveAgentLlmRuntime(
        {
          llmProvider: cfg.llmProvider,
          llmBaseUrl: cfg.llmBaseUrl ?? opts.baseUrl,
          llmApiKey: cfg.llmApiKey ?? opts.apiKey,
        },
        opts.baseUrl,
      );

      const newAgent = new FortressAgent({
        sessionId,
        agent: {
          id: cfg.id,
          model: cfg.model,
          systemPrompt: systemPromptRef.current,
          temperature: cfg.temperature,
          think: resolveThinkValue(
            opts.thinkOverride?.reasoning ?? cfg.reasoning,
            opts.thinkOverride?.effort ?? cfg.reasoningEffort,
          ),
          options: {
            num_ctx: effectiveNumCtx,
          },
          contextSize: effectiveNumCtx,
          reserveTokens: cfg.reserveTokens,
          keepRecentTokens: cfg.keepRecentTokens,
          provider: runtime.kind,
          apiKey: runtime.apiKey,
          topP: cfg.topP,
          topK: cfg.topK,
          repeatPenalty: cfg.repeatPenalty,
          frequencyPenalty: cfg.frequencyPenalty,
          presencePenalty: cfg.presencePenalty,
          seed: cfg.seed,
          stopSequences: cfg.stopSequences,
          maxOutputTokens: cfg.maxOutputTokens,
        },
        tools: toolsRef.current,
        baseUrl: runtime.baseUrl,
        apiKey: runtime.apiKey,
        initialMessages: initial,
        streamChatFn: getStreamChatFn(runtime, opts.streamChatFn),
      });

      newAgent.subscribe((e) => eventHandlerRef.current(e));
      return newAgent;
    },
    [sessionId, contextLimit],
  );

  // Initialize agent when sessionId changes
  useEffect(() => {
    let cancelled = false;

    // Load initial messages from persistence
    persistence.loadMessages(sessionId).then((loaded) => {
      if (cancelled) return;
      setMessages(loaded);
      persistedCountRef.current = loaded.length;
      agentRef.current = createAgentInstance(loaded);
    });

    return () => {
      cancelled = true;
      approvalBus.abortAll();
      if (agentRef.current) {
        agentRef.current.abort();
        agentRef.current = null;
      }
      stopAutoMonitoring();
    };
  }, [sessionId, createAgentInstance, persistence, stopAutoMonitoring]);

  // Sync active approval mode
  useEffect(() => {
    setActiveApprovalMode(agentConfig.approvalMode);
  }, [agentConfig.approvalMode]);

  // Inject diff updates when system prompt sections change dynamically
  const prevSectionsRef = useRef<Record<string, string>>(currentSections);
  useEffect(() => {
    const prev = prevSectionsRef.current;
    if (prev && Object.keys(prev).length > 0) {
      const diff = diffSections(prev, currentSections);
      const changedKeys = Object.keys(diff);
      if (changedKeys.length > 0 && messages.length > 0) {
        const diffText = Object.entries(diff)
          .map(([k, v]) => (v === null ? `<${k}>\n(This section has been removed)\n</${k}>` : v))
          .join('\n\n');

        if (diffText.trim()) {
          const updateMsg: AgentMessage = {
            role: 'system',
            content: `[System prompt updated]\n\n${diffText}`,
            sections: currentSections,
          };
          setMessages((prevMsgs) => [...prevMsgs, updateMsg]);
          if (agentRef.current) {
            agentRef.current.setMessages([...agentRef.current.getMessages(), updateMsg]);
          }
        }
      }
    }
    prevSectionsRef.current = currentSections;
  }, [currentSections, messages.length]);

  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      if (!text.trim()) return;
      // 평가 실행 중에는 어떤 채팅도 LLM으로 전송·큐잉하지 않는다(D5).
      // UI(입력 비활성화·배너)가 1차 방어선이며, 이 가드는 최후 방어선이다.
      // useChat에는 번역 컨텍스트가 없으므로 조용히 복귀한다(알림은 UI 층이 담당).
      if (evalLock.get()) return;
      lastPromptRef.current = text;
      setError(null);
      bindSessionToAgent(sessionId, agentConfigRef.current.id);
      // 자동 모니터링 on이면 대화 시작 시 모니터링 상태로 전환한다.
      startAutoMonitoring();

      // Eagerly show user message in UI (전송 시점의 실행 설정을 함께 기록)
      const snapshot = captureChatConfigSnapshot(
        agentConfigRef.current,
        {
          reasoning: optionsRef.current.thinkOverride?.reasoning,
          effort: optionsRef.current.thinkOverride?.effort,
        },
        resolveThinkValue(
          optionsRef.current.thinkOverride?.reasoning ?? agentConfigRef.current.reasoning,
          optionsRef.current.thinkOverride?.effort ?? agentConfigRef.current.reasoningEffort,
        ),
      );
      const userMsg: AgentMessage = { role: 'user', content: text, config: snapshot };
      setMessages((prev) => [...prev, userMsg]);
      persistedCountRef.current += 1;
      await persistence.saveUserMessage?.(sessionId, userMsg);

      appLogger.info(
        'chat',
        `사용자 질문/요청: "${text.length > 120 ? text.slice(0, 120) + '...' : text}"`,
        { role: 'user', prompt: text, fullPrompt: text },
        sessionId,
        agentConfigRef.current.id,
      );

      if (!agentRef.current) {
        agentRef.current = createAgentInstance(messages);
      }

      try {
        await agentRef.current.prompt(text);
      } catch (err) {
        const errObj = err instanceof Error ? err : new Error(String(err));
        setError(errObj);
        stopAutoMonitoring();
        appLogger.error(
          'chat',
          `대화 처리 중 오류 발생: ${errObj.message}`,
          { error: errObj.message, stack: errObj.stack, prompt: text },
          sessionId,
          agentConfigRef.current.id,
        );
      }
    },
    [createAgentInstance, messages, persistence, sessionId, startAutoMonitoring, stopAutoMonitoring],
  );

  const steer = useCallback((text: string) => {
    if (agentRef.current) {
      agentRef.current.steer(text);
    }
  }, []);

  const stop = useCallback(() => {
    approvalBus.abortAll();
    if (agentRef.current) {
      agentRef.current.abort();
    }
    setIsStreaming(false);
    // 사용자 중단도 LLM 작업 완료로 보고 자동 모니터링을 중단한다.
    stopAutoMonitoring();
  }, [stopAutoMonitoring]);

  const retry = useCallback(async () => {
    if (lastPromptRef.current) {
      setError(null);
      await sendMessage(lastPromptRef.current);
    }
  }, [sendMessage]);

  const compact = useCallback(
    async (customInstructions?: string): Promise<void> => {
      try {
        const entries = await entriesRepo.getEntries(sessionId);
        const prep = prepareCompaction(sessionId, entries, compactionSettings);
        if (!prep) return;
        await executeCompact(prep, {
          model: agentConfig.model,
          baseUrl: llmRuntime.baseUrl,
          apiKey: llmRuntime.apiKey,
          provider: llmRuntime.kind,
          reason: 'manual',
          customInstructions,
          streamChatFn: options.streamChatFn,
        });
        const updated = await entriesRepo.getEntries(sessionId);
        const newMessages = buildLlmContext(updated);
        setMessages(newMessages);
        if (agentRef.current) {
          agentRef.current.setMessages(newMessages);
        }
      } catch (err) {
        console.error('Manual compaction failed:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [
      sessionId,
      compactionSettings,
      agentConfig.model,
      llmRuntime,
      options.streamChatFn,
    ],
  );

  const clearChat = useCallback(async (): Promise<void> => {
    try {
      setMessages([]);
      if (agentRef.current) {
        agentRef.current.setMessages([]);
      }
      await entriesRepo.deleteEntriesForSession(sessionId);
      setContextTokens(0);
      appLogger.info(
        'chat',
        '대화 내역이 초기화되었습니다. (실행 상세 로그는 SQLite에 안전하게 보존됩니다.)',
        undefined,
        sessionId,
        agentConfig.id,
      );
    } catch (err) {
      console.error('Failed to clear chat:', err);
    }
  }, [agentConfig.id, sessionId]);

  const injectInfoMessage = useCallback((content: string): void => {
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content,
        stopReason: 'stop',
      },
    ]);
  }, []);

  const injectConfigNotice = useCallback(
    (snapshot: ChatConfigSnapshot, summary: string): void => {
      // UI 전용 안내다. 저장하지 않고 에이전트 메모리에도 넣지 않으므로
      // LLM 컨텍스트·DB에 영향을 주지 않는다.
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: summary,
          config: snapshot,
        },
      ]);
    },
    [],
  );

  return {
    messages,
    isStreaming,
    contextUsage: { tokens: contextTokens, limit: contextLimit },
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
  };
}
