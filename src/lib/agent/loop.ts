import {
  SYSTEM_AUTO_GUIDE_PREFIX,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type AgentToolCall,
  type AgentToolResult,
  type TokenUsage,
} from '@/lib/agent/types';
import type { AgentHooks } from '@/lib/agent/hooks';
import type { MessageQueue } from '@/lib/agent/queue';
import { type RetryPolicy, withRetry } from '@/lib/agent/retry';
import {
  OllamaContextOverflowError,
  streamChat as defaultStreamChat,
} from '@/lib/llm/ollamaClient';
import { OpenAiContextOverflowError } from '@/lib/llm/openAiCompatibleClient';
import { streamChat as streamOpenAiChat } from '@/lib/llm/openAiCompatibleClient';
import type { LlmProviderKind } from '@/lib/types/agent';
import type { LlmStreamChatFn } from '@/lib/llm/providerRuntime';
import {
  cleanThinkingText,
  mapAgentMessagesToOllama,
  mapAgentMessagesToOpenAi,
  mapAgentToolsToOllama,
  mapAgentToolsToOpenAi,
} from '@/lib/llm/messageMapper';
import { appLogger } from '@/lib/logger/logger';
import { recordAgentError, recordLlmCall } from '@/lib/metrics/agentMetrics';
import { monitoringCollector } from '@/lib/monitoring/monitoringCollector';
import { setAgentPhase } from '@/lib/monitoring/agentPhaseTracker';
import {
  beginConversation,
  buildTurnContribution,
  recordTurn,
} from '@/lib/monitoring/tokenTracker';
import type { LlmPerformanceMetrics } from '@/lib/types/monitoring';

export interface LoopAgentConfig {
  id?: string;
  model: string;
  systemPrompt?: string;
  temperature?: number;
  options?: Record<string, unknown>;
  /** Ollama 최상위 think 값. 메시지 배열과 무관하므로 턴 중간에 바꿔도 prefill 오버헤드 없음. */
  think?: boolean | string | null;
  contextSize?: number;
  reserveTokens?: number;
  keepRecentTokens?: number;
  /** LLM Provider 종류. 미지정 시 'ollama' (기존 동작 유지) */
  provider?: LlmProviderKind;
  /** 클라우드/인증 서버용 API 키 (Ollama는 미사용) */
  apiKey?: string;
  /** 생성 파라미터. undefined = 자동. Provider별 지원 키만 전송한다. */
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  stopSequences?: string[];
  maxOutputTokens?: number;
}

export interface RunAgentLoopOptions {
  agent: LoopAgentConfig;
  sessionId?: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  hooks?: AgentHooks;
  signal: AbortSignal;
  steeringQueue: MessageQueue;
  followUpQueue: MessageQueue;
  emit: (event: AgentEvent) => void;
  baseUrl?: string;
  apiKey?: string;
  retryPolicy?: Partial<RetryPolicy>;
  streamChatFn?: LlmStreamChatFn;
  onRetry?: (attempt: number, maxRetries: number, error: unknown) => void;
}

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentMessage[]> {
  const {
    agent,
    sessionId,
    tools,
    hooks = {},
    signal,
    steeringQueue,
    followUpQueue,
    emit,
    baseUrl,
    retryPolicy,
    onRetry,
  } = options;

  const provider: LlmProviderKind = agent.provider ?? 'ollama';
  const apiKey = options.apiKey ?? agent.apiKey;
  const useOpenAi = provider !== 'ollama';
  const streamChatFn: LlmStreamChatFn =
    options.streamChatFn ?? (useOpenAi ? (streamOpenAiChat as unknown as LlmStreamChatFn) : (defaultStreamChat as unknown as LlmStreamChatFn));

  // Clone messages so caller's original array isn't directly mutated
  const messages: AgentMessage[] = [...options.messages];
  const toolMap = new Map<string, AgentTool>();
  for (const t of tools) {
    toolMap.set(t.name, t);
  }

  emit({ type: 'agent_start' });
  if (agent.id) {
    setAgentPhase(agent.id, 'thinking', `에이전트 루프 시작 (모델: ${agent.model})`, sessionId);
    // "대화" 경계 시작: 이번 prompt() 호출 1건 = 토큰 집계 단위 1건
    beginConversation(agent.id, sessionId);
  }
  appLogger.info(
    'agent',
    `에이전트 루프 시작 (모델: ${agent.model}, 활성 도구: ${tools.length}개)`,
    { model: agent.model, tools: tools.map((t) => t.name), options: agent.options },
    sessionId,
    agent.id,
  );

  let turnIndex = 0;
  let hasFollowUp = true;
  let consecutiveThinkingOnlyCount = 0;

  while (hasFollowUp && !signal.aborted) {
    while (!signal.aborted) {
      turnIndex++;

      // 1. transformContext hook
      let activeMessages = messages;
      if (hooks.transformContext) {
        activeMessages = await hooks.transformContext(messages, signal);
        if (activeMessages && activeMessages.length > 0 && activeMessages !== messages) {
          if (activeMessages.length < messages.length) {
            messages.length = 0;
            messages.push(...activeMessages);
            emit({ type: 'compaction_end', entry: { compactedCount: activeMessages.length } });
          }
        }
      }

      emit({ type: 'turn_start' });
      if (agent.id) {
        setAgentPhase(agent.id, 'thinking', `[Turn #${turnIndex}] Thinking — 프롬프트 분석 및 계획 수립 중`, sessionId);
      }
      appLogger.info(
        'agent',
        `[Turn #${turnIndex}] 턴 시작 (컨텍스트 메시지: ${activeMessages.length}개)`,
        { turnIndex, messageCount: activeMessages.length },
        sessionId,
        agent.id,
      );

      // 2. Prepare LLM request (Provider별 메시지/도구 매핑)
      const ollamaMessages = useOpenAi
        ? (mapAgentMessagesToOpenAi(activeMessages) as unknown as import('@/lib/llm/providerRuntime').LlmChatRequest['messages'])
        : (mapAgentMessagesToOllama(activeMessages) as unknown as import('@/lib/llm/providerRuntime').LlmChatRequest['messages']);
      const ollamaTools = useOpenAi ? mapAgentToolsToOpenAi(tools) : mapAgentToolsToOllama(tools);
      appLogger.info(
        'ollama',
        `[Turn #${turnIndex}] LLM 추론 요청 전송 (모델: ${agent.model}, 입력 메시지: ${ollamaMessages.length}개, 도구: ${ollamaTools.length}개)`,
        {
          turnIndex,
          model: agent.model,
          messages: ollamaMessages,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
          })),
          options: agent.options,
          think: agent.think,
        },
        sessionId,
        agent.id,
      );
      if (agent.id) {
        setAgentPhase(agent.id, 'prefill', `[Turn #${turnIndex}] Prefill — 입력 토큰 병렬 평가 중`, sessionId);
      }

      let assistantContent = '';
      let assistantThinking = '';
      let assistantToolCalls: AgentToolCall[] = [];
      let finalUsage: TokenUsage | undefined;
      let finalMetrics: LlmPerformanceMetrics | undefined;
      let stopReason: 'stop' | 'toolUse' | 'length' | 'aborted' | 'error' = 'stop';
      let errorMessage: string | undefined;

      // Stream assistant response with retry and context overflow recovery
      let overflowRetried = false;

      const executeStreamAttempt = async (): Promise<void> => {
        const streamStartTime = performance.now();
        while (true) {
          try {
            await withRetry(
              async (attempt) => {
                if (attempt > 0) {
                  assistantContent = '';
                  assistantThinking = '';
                  assistantToolCalls = [];
                }

                const stream = streamChatFn(
                  {
                    baseUrl,
                    apiKey,
                    model: agent.model,
                    messages: ollamaMessages,
                    tools: ollamaTools.length > 0 ? ollamaTools : undefined,
                    temperature: agent.temperature,
                    think: agent.think,
                    topP: agent.topP,
                    topK: agent.topK,
                    repeatPenalty: agent.repeatPenalty,
                    frequencyPenalty: agent.frequencyPenalty,
                    presencePenalty: agent.presencePenalty,
                    seed: agent.seed,
                    stopSequences: agent.stopSequences,
                    maxTokens: agent.maxOutputTokens,
                    // 생성 파라미터는 명시 필드로만 전달한다. 각 클라이언트가
                    // 자신의 규격에 맞는 키로 변환하므로, options에 Ollama 전용
                    // 키(num_predict 등)를 섞어 OpenAI 호환 서버에 보내 400이
                    // 나는 일을 피할 수 있다.
                    options: agent.options,
                  },
                  signal,
                );

                for await (const chunk of stream) {
                  if (signal.aborted) {
                    stopReason = 'aborted';
                    break;
                  }

                  if (chunk.content) {
                    assistantContent += chunk.content;
                  }

                  if (chunk.thinking) {
                    assistantThinking += chunk.thinking;
                  }

                  if (chunk.toolCalls && chunk.toolCalls.length > 0) {
                    for (const tc of chunk.toolCalls) {
                      // OpenAI 호환 청크는 index별 id를 유지하므로 id 우선 매칭.
                      // Ollama 네이티브 청크에는 id가 없어 이름 매칭으로 폴백한다.
                      const incomingId = (tc as { id?: string }).id;
                      const existing = assistantToolCalls.find((call) =>
                        incomingId ? call.id === incomingId : call.name === tc.function.name,
                      );
                      if (existing) {
                        existing.arguments = tc.function.arguments;
                      } else {
                        assistantToolCalls.push({
                          id: incomingId || `call_${Math.random().toString(36).slice(2, 11)}`,
                          name: tc.function.name,
                          arguments: tc.function.arguments,
                        });
                      }
                    }
                  }

                  if (chunk.usage) {
                    finalUsage = chunk.usage;
                  }

                  if (chunk.metrics) {
                    finalMetrics = chunk.metrics;
                  }

                  if (agent.id) {
                    if (chunk.thinking) {
                      setAgentPhase(agent.id, 'thinking', `[Turn #${turnIndex}] Thinking — 추론 계획 생성 중`, sessionId);
                    } else if (chunk.toolCalls && chunk.toolCalls.length > 0) {
                      const names = chunk.toolCalls.map((c) => c.function.name).join(', ');
                      setAgentPhase(agent.id, 'executing_tool', `[Turn #${turnIndex}] Executing_Tool — 도구 호출 준비: ${names}`, sessionId);
                    } else if (chunk.content) {
                      setAgentPhase(agent.id, 'decoding', `[Turn #${turnIndex}] Decoding — 토큰 생성 중 (${assistantContent.length}자)`, sessionId);
                    }
                  }

                  const partialAssistant: AgentMessage = {
                    role: 'assistant',
                    content: assistantContent,
                    thinking: assistantThinking || undefined,
                    toolCalls:
                      assistantToolCalls.length > 0
                        ? [...assistantToolCalls]
                        : undefined,
                    usage: finalUsage,
                    stopReason: 'stop',
                  };

                  emit({
                    type: 'message_update',
                    message: partialAssistant,
                    delta: chunk.content || '',
                  });
                }
              },
              retryPolicy,
              signal,
              onRetry,
            );

            // Successfully finished streaming - record metrics
            const durationMs = Math.round(performance.now() - streamStartTime);

            if (agent.id && finalMetrics) {
              monitoringCollector.recordInferenceMetrics(agent.id, finalMetrics);
            }

            // 대화 단위 토큰 집계: 턴마다 usage 실측 + 사고문/본문 비율 안분
            if (agent.id) {
              const turnInput = finalUsage?.input ?? finalMetrics?.promptEvalCount ?? 0;
              const turnOutput = finalUsage?.output ?? finalMetrics?.evalCount ?? 0;
              if (turnInput > 0 || turnOutput > 0) {
                const contribution = buildTurnContribution({
                  inputTokens: turnInput,
                  outputTokens: turnOutput,
                  thinkingChars: assistantThinking.length,
                  contentChars: assistantContent.length,
                });
                recordTurn(agent.id, contribution);
                monitoringCollector.recordTurnTokens(agent.id, contribution);
              }
            }

            if (agent.id) {
              recordLlmCall({
                agentId: agent.id,
                sessionId,
                contextTokens: finalUsage?.input ?? 0,
                outputTokens: finalUsage?.output ?? 0,
                durationMs,
                toolCallsCount: assistantToolCalls.length,
                prefillTokens: finalMetrics?.promptEvalCount,
                prefillDurationMs: finalMetrics?.promptEvalDurationMs,
                prefillSpeed: finalMetrics?.prefillSpeed,
                decodingTokens: finalMetrics?.evalCount,
                decodingDurationMs: finalMetrics?.evalDurationMs,
                decodingSpeed: finalMetrics?.decodingSpeed,
              });
            }

            if (assistantThinking.trim()) {
              appLogger.info(
                'ollama',
                `[Turn #${turnIndex}] LLM 사고 과정(Thinking) 완료 (${assistantThinking.length}자)`,
                {
                  turnIndex,
                  thinking: assistantThinking,
                },
                sessionId,
                agent.id,
              );
            }

            const perfLogSuffix = finalMetrics
              ? `, Prefill: ${finalMetrics.prefillSpeed} t/s (${finalMetrics.promptEvalDurationMs}ms), 디코딩: ${finalMetrics.decodingSpeed} t/s (${finalMetrics.evalDurationMs}ms)`
              : '';

            appLogger.info(
              'ollama',
              `[Turn #${turnIndex}] LLM 응답 생성 완료 (${durationMs}ms, 토큰: 입력 ${finalUsage?.input ?? 0} / 출력 ${finalUsage?.output ?? 0}${assistantToolCalls.length > 0 ? `, 도구 호출: ${assistantToolCalls.length}건` : ''}${perfLogSuffix})`,
              {
                turnIndex,
                durationMs,
                usage: finalUsage,
                metrics: finalMetrics,
                toolCalls: assistantToolCalls.length > 0 ? assistantToolCalls : undefined,
                content: assistantContent || undefined,
                thinking: assistantThinking || undefined,
              },
              sessionId,
              agent.id,
            );

            break;
          } catch (err: unknown) {
            if (signal.aborted) {
              stopReason = 'aborted';
              break;
            }

            // Check for context overflow hook (Ollama/OpenAI 호환 공통)
            if (
              (err instanceof OllamaContextOverflowError ||
                err instanceof OpenAiContextOverflowError) &&
              !overflowRetried &&
              hooks.onContextOverflow
            ) {
              overflowRetried = true;
              emit({ type: 'compaction_start' });
              appLogger.warn(
                'context',
                `[Turn #${turnIndex}] LLM 컨텍스트 초과 오류 발생. 컨텍스트 압축 후 재시도합니다.`,
                { error: err.message },
                sessionId,
                agent.id,
              );
              const compacted = await hooks.onContextOverflow(messages, signal);
              if (compacted && compacted.length > 0) {
                // Replace messages and retry turn
                messages.length = 0;
                messages.push(...compacted);
                emit({ type: 'compaction_end', entry: { compactedCount: compacted.length } });
                const newOllamaMsgs = useOpenAi
                  ? mapAgentMessagesToOpenAi(messages)
                  : mapAgentMessagesToOllama(messages);
                ollamaMessages.length = 0;
                ollamaMessages.push(
                  ...(newOllamaMsgs as unknown as typeof ollamaMessages),
                );
                assistantContent = '';
                assistantThinking = '';
                assistantToolCalls = [];
                continue;
              }
            }

            stopReason = 'error';
            errorMessage = err instanceof Error ? err.message : String(err);
            emit({
              type: 'error',
              error: err instanceof Error ? err : new Error(String(err)),
            });
            throw err;
          }
        }
      };

      try {
        await executeStreamAttempt();
      } catch {
        // Stream failed, assistant message recorded as error if not aborted
        if (signal.aborted) {
          stopReason = 'aborted';
        }
      }

      if (errorMessage) {
        stopReason = 'error';
      } else if (signal.aborted) {
        stopReason = 'aborted';
      } else if (assistantToolCalls.length > 0) {
        stopReason = 'toolUse';
      }

      // Check if model emitted thinking scratchpad but halted before producing tool calls or user content
      const isThinkingOnly =
        !assistantContent.trim() &&
        assistantToolCalls.length === 0 &&
        Boolean(assistantThinking.trim());

      if (
        isThinkingOnly &&
        consecutiveThinkingOnlyCount < 2 &&
        !signal.aborted &&
        stopReason !== 'error'
      ) {
        consecutiveThinkingOnlyCount++;
        appLogger.warn(
          'agent',
          `[Turn #${turnIndex}] 모델이 도구 호출이나 최종 본문 없이 사고 과정(Thinking)만 생성하고 중단되었습니다. 도구 호출/답변 작성을 위해 자동 복구 프롬프트를 전송합니다. (시도 ${consecutiveThinkingOnlyCount}/2)`,
          { turnIndex, thinking: assistantThinking },
          sessionId,
          agent.id,
        );

        const partialAssistantMessage: AgentMessage = {
          role: 'assistant',
          content: '',
          thinking: assistantThinking,
          stopReason: 'stop',
          usage: finalUsage,
        };
        messages.push(partialAssistantMessage);
        emit({ type: 'message_end', message: partialAssistantMessage });

        const recoveryPrompt =
          `${SYSTEM_AUTO_GUIDE_PREFIX}: 사고 과정(Thinking)만 완료되었고 계획한 도구 호출(Tool Call)이나 최종 응답 본문이 생성되지 않았습니다. 지체 없이 계획한 도구(예: read, ls, write 등)를 호출하거나, 추가 도구가 필요 없다면 사용자의 질문에 대한 실질적인 최종 답변 전문을 즉시 작성해 주십시오.`;

        // 자동 복구 안내는 사용자 발화가 아니라 시스템 안내다. user 역할로
        // 남기면 파란 말풍선·프롬프트 히스토리(↑/↓)·매크로 저장에 섞이므로
        // system 역할로 기록해 LLM 컨텍스트에는 포함하되 사용자 기록에서는 제외한다.
        messages.push({ role: 'system', content: recoveryPrompt });
        continue;
      }

      if (!isThinkingOnly) {
        consecutiveThinkingOnlyCount = 0;
      }

      // Fallback: If model finished turn with no text content and no tool calls,
      // but produced thinking text and exhausted retries, use cleaned thinking as content
      if (!assistantContent.trim() && !assistantToolCalls.length && assistantThinking.trim()) {
        assistantContent = cleanThinkingText(assistantThinking);
      }

      const completedAssistantMessage: AgentMessage = {
        role: 'assistant',
        content: assistantContent,
        thinking: assistantThinking || undefined,
        toolCalls:
          assistantToolCalls.length > 0 ? assistantToolCalls : undefined,
        usage: finalUsage,
        stopReason,
        errorMessage,
      };

      messages.push(completedAssistantMessage);
      emit({ type: 'message_end', message: completedAssistantMessage });

      // If aborted or error, break turn loop
      if (stopReason === 'aborted' || stopReason === 'error') {
        break;
      }

      // If no tool calls, check steering or finish turns
      if (!assistantToolCalls || assistantToolCalls.length === 0) {
        const steered = steeringQueue.dequeue();
        if (steered) {
          const steerMsg: AgentMessage = { role: 'user', content: steered };
          messages.push(steerMsg);
          continue;
        }
        break;
      }

      // 3. Execute tool calls
      const toolResults: AgentMessage[] = [];
      const rawResults: AgentToolResult[] = [];

      // Determine execution mode (sequential if any tool requires sequential)
      const hasSequential = assistantToolCalls.some((tc) => {
        const tool = toolMap.get(tc.name);
        return tool?.executionMode === 'sequential';
      });

      const executeSingleTool = async (
        tc: AgentToolCall,
      ): Promise<{ toolResultMsg: AgentMessage; rawResult: AgentToolResult }> => {
        const toolStartTime = performance.now();
        if (agent.id) {
          setAgentPhase(agent.id, 'executing_tool', `[Turn #${turnIndex}] Executing_Tool — '${tc.name}' 실행 중`, sessionId);
        }
        emit({
          type: 'tool_execution_start',
          toolCallId: tc.id,
          toolName: tc.name,
          args: tc.arguments,
        });

        const argSummary =
          tc.arguments && typeof tc.arguments === 'object'
            ? 'query' in tc.arguments
              ? ` (검색어: "${String(tc.arguments.query)}")`
              : 'path' in tc.arguments
              ? ` (경로: "${String(tc.arguments.path)}")`
              : 'command' in tc.arguments
              ? ` (명령: "${String(tc.arguments.command)}")`
              : ''
            : '';

        appLogger.info(
          'tools',
          `[Turn #${turnIndex}] 도구 호출 시작: '${tc.name}'${argSummary}`,
          { turnIndex, toolCallId: tc.id, toolName: tc.name, arguments: tc.arguments },
          options.sessionId,
          agent.id,
        );

        const tool = toolMap.get(tc.name);
        let result: AgentToolResult;

        if (!tool) {
          result = {
            content: `Tool '${tc.name}' not found or not enabled`,
            isError: true,
          };
          appLogger.error('tools', `Tool '${tc.name}' not found`, tc.arguments, options.sessionId, agent.id);
          recordAgentError({
            agentId: agent.id || 'default',
            sessionId: options.sessionId,
            source: 'tool',
            message: `Tool '${tc.name}' not found or not enabled`,
            details: tc.arguments,
          });
        } else {
          // Validate parameters schema
          const parseResult = tool.parameters.safeParse(tc.arguments);
          if (!parseResult.success) {
            result = {
              content: `Invalid parameters for tool '${tc.name}': ${parseResult.error.message}`,
              isError: true,
            };
            appLogger.error('tools', `Tool '${tc.name}' invalid parameters: ${parseResult.error.message}`, tc.arguments, options.sessionId, agent.id);
            recordAgentError({
              agentId: agent.id || 'default',
              sessionId: options.sessionId,
              source: 'tool',
              message: `Invalid parameters for tool '${tc.name}': ${parseResult.error.message}`,
              details: tc.arguments,
            });
          } else {
            // Check beforeToolCall hook
            let blockDecision: { block?: boolean; reason?: string; terminate?: boolean } | undefined;
            if (hooks.beforeToolCall) {
              let approvalTimer: ReturnType<typeof setTimeout> | null = null;
              if (agent.id) {
                approvalTimer = setTimeout(() => {
                  if (agent.id) {
                    setAgentPhase(agent.id, 'waiting_approval', `사용자 승인 대기 중: '${tc.name}'`, sessionId);
                  }
                }, 800);
              }
              try {
                blockDecision = await hooks.beforeToolCall(
                  {
                    toolCallId: tc.id,
                    toolName: tc.name,
                    arguments: tc.arguments,
                    risk: tool.risk,
                  },
                  signal,
                );
              } finally {
                if (approvalTimer) clearTimeout(approvalTimer);
                if (agent.id && blockDecision === undefined) {
                  setAgentPhase(agent.id, 'executing_tool', `[Turn #${turnIndex}] Executing_Tool — '${tc.name}' 실행 중`, sessionId);
                }
              }
            }

            if (blockDecision?.block) {
              result = {
                content:
                  blockDecision.reason ||
                  `Tool execution of '${tc.name}' was blocked by approval policy.`,
                isError: true,
                terminate: blockDecision.terminate,
              };
              appLogger.warn('approval', `Tool '${tc.name}' blocked by user or policy: ${result.content}`, tc.arguments, options.sessionId, agent.id);
            } else {
              try {
                result = await tool.execute(
                  tc.id,
                  parseResult.data,
                  signal,
                  (partial) => {
                    emit({
                      type: 'tool_execution_update',
                      toolCallId: tc.id,
                      partial,
                    });
                  },
                );
              } catch (execErr: unknown) {
                const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
                result = {
                  content: errMsg,
                  isError: true,
                };
                appLogger.error('tools', `Tool '${tc.name}' execution failed: ${errMsg}`, execErr, options.sessionId, agent.id);
                recordAgentError({
                  agentId: agent.id || 'default',
                  sessionId: options.sessionId,
                  source: 'tool',
                  message: `Tool '${tc.name}' execution error: ${errMsg}`,
                  details: execErr,
                });
              }
            }
          }

          // Check afterToolCall hook (e.g. truncation, normalization)
          if (hooks.afterToolCall) {
            const afterResult = await hooks.afterToolCall(
              {
                toolCallId: tc.id,
                toolName: tc.name,
                arguments: tc.arguments,
                result,
              },
              signal,
            );
            if (afterResult) {
              result = { ...result, ...afterResult };
            }
          }
        }

        const isError = Boolean(result.isError);
        const toolDurationMs = Math.round(performance.now() - toolStartTime);
        emit({
          type: 'tool_execution_end',
          toolCallId: tc.id,
          toolName: tc.name,
          result,
          isError,
        });

        if (isError) {
          appLogger.error(
            'tools',
            `[Turn #${turnIndex}] 도구 '${tc.name}' 실행 실패 (${toolDurationMs}ms): ${result.content?.slice(0, 200)}`,
            {
              turnIndex,
              toolCallId: tc.id,
              toolName: tc.name,
              arguments: tc.arguments,
              error: result.content,
              details: result.details,
            },
            options.sessionId,
            agent.id,
          );
        } else {
          appLogger.info(
            'tools',
            `[Turn #${turnIndex}] 도구 '${tc.name}' 실행 완료 (${toolDurationMs}ms)`,
            {
              turnIndex,
              toolCallId: tc.id,
              toolName: tc.name,
              arguments: tc.arguments,
              result: result.content,
              details: result.details,
            },
            options.sessionId,
            agent.id,
          );
        }

        const toolResultMsg: AgentMessage = {
          role: 'toolResult',
          toolCallId: tc.id,
          toolName: tc.name,
          content: result.content,
          isError,
        };

        return { toolResultMsg, rawResult: result };
      };

      if (hasSequential) {
        for (const tc of assistantToolCalls) {
          if (signal.aborted) break;
          const { toolResultMsg, rawResult } = await executeSingleTool(tc);
          toolResults.push(toolResultMsg);
          rawResults.push(rawResult);
        }
      } else {
        // Parallel execution, maintaining exact order of assistantToolCalls
        const execPromises = assistantToolCalls.map((tc) => executeSingleTool(tc));
        const executed = await Promise.all(execPromises);
        for (const item of executed) {
          toolResults.push(item.toolResultMsg);
          rawResults.push(item.rawResult);
        }
      }

      // Append all tool results to messages
      messages.push(...toolResults);

      emit({
        type: 'turn_end',
        message: completedAssistantMessage,
        toolResults,
      });

      if (toolResults.length > 0) {
        appLogger.info(
          'agent',
          `[Turn #${turnIndex}] 도구 실행 결과 ${toolResults.length}건 수집 완료 (다음 추론 턴으로 전달)`,
          {
            turnIndex,
            toolResultsCount: toolResults.length,
            results: toolResults.map((tr) => ({
              toolName: tr.role === 'toolResult' ? tr.toolName : undefined,
              content: tr.content,
              isError: tr.role === 'toolResult' ? tr.isError : false,
            })),
          },
          sessionId,
          agent.id,
        );
      }

      // Check terminate conditions
      const allTerminated =
        rawResults.length > 0 && rawResults.every((r) => r.terminate === true);
      if (allTerminated) {
        break;
      }

      if (hooks.shouldStopAfterTurn) {
        const stop = await hooks.shouldStopAfterTurn({
          messages,
          turnIndex,
        });
        if (stop) {
          break;
        }
      }

      // Check steering queue
      const steered = steeringQueue.dequeue();
      if (steered) {
        messages.push({ role: 'user', content: steered });
      }
    }

    // Check followUp queue
    if (!signal.aborted && !followUpQueue.isEmpty()) {
      const nextFollowUp = followUpQueue.dequeue();
      if (nextFollowUp) {
        messages.push({ role: 'user', content: nextFollowUp });
        hasFollowUp = true;
        continue;
      }
    }
    hasFollowUp = false;
  }

  if (signal.aborted) {
    appLogger.warn(
      'agent',
      '에이전트 실행이 사용자에 의해 중단되었습니다.',
      undefined,
      sessionId,
      agent.id,
    );
  } else {
    appLogger.info(
      'agent',
      `에이전트 실행 루프 완료 (총 ${turnIndex}턴 완료, 최종 메시지: ${messages.length}개)`,
      { totalTurns: turnIndex, totalMessages: messages.length },
      sessionId,
      agent.id,
    );
  }

  if (agent.id) {
    setAgentPhase(agent.id, 'idle', '대기 중 (유휴 상태)', sessionId);
    // "대화" 경계 종료: 턴 누적분을 대화 요약으로 확정하고 원장에 영속화
    await monitoringCollector.finishConversation(agent.id);
  }
  emit({ type: 'agent_end', messages });
  return messages;
}
