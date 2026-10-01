import type { AgentEvent, AgentMessage, AgentTool } from '@/lib/agent/types';
import { type AgentHooks, composeHooks } from '@/lib/agent/hooks';
import { getRegisteredHooks } from '@/lib/agent/hookRegistry';
import { createMessageQueue, type MessageQueue } from '@/lib/agent/queue';
import type { RetryPolicy } from '@/lib/agent/retry';
import { runAgentLoop, type LoopAgentConfig } from '@/lib/agent/loop';
import type { LlmStreamChatFn } from '@/lib/llm/providerRuntime';

export interface FortressAgentConfig {
  sessionId?: string;
  agent: LoopAgentConfig;
  tools?: AgentTool[];
  hooks?: AgentHooks;
  baseUrl?: string;
  apiKey?: string;
  retryPolicy?: Partial<RetryPolicy>;
  initialMessages?: AgentMessage[];
  streamChatFn?: LlmStreamChatFn;
}

export type AgentState = 'idle' | 'running';

export class FortressAgent {
  private config: FortressAgentConfig;
  private hooks: AgentHooks;
  private messages: AgentMessage[];
  private steeringQueue: MessageQueue;
  private followUpQueue: MessageQueue;
  private listeners: Set<(event: AgentEvent) => void> = new Set();
  private abortController: AbortController | null = null;
  private currentState: AgentState = 'idle';
  private idleResolvers: Array<() => void> = [];

  constructor(config: FortressAgentConfig) {
    this.config = config;
    this.hooks = composeHooks(getRegisteredHooks(), config.hooks ?? {});
    this.messages = config.initialMessages ? [...config.initialMessages] : [];
    this.steeringQueue = createMessageQueue();
    this.followUpQueue = createMessageQueue();
  }

  get state(): AgentState {
    return this.currentState;
  }

  getMessages(): AgentMessage[] {
    return [...this.messages];
  }

  setMessages(messages: AgentMessage[]): void {
    this.messages = [...messages];
  }

  /**
   * Ollama `think` 값을 실행 중에 변경한다. 같은 객체를 직접 갱신하므로
   * 스트리밍 중이라도 다음 LLM 호출(다음 턴)부터 새 값이 적용된다.
   * 메시지/시스템 프롬프트를 건드리지 않아 prefill 오버헤드가 없다.
   */
  setThink(think: boolean | string | null | undefined): void {
    this.config.agent.think = think;
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in agent event listener:', err);
      }
    }
  }

  steer(text: string): void {
    this.steeringQueue.enqueue(text);
  }

  followUp(text: string): void {
    this.followUpQueue.enqueue(text);
  }

  abort(): void {
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }
  }

  async waitForIdle(): Promise<void> {
    if (this.currentState === 'idle') {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  async prompt(text: string): Promise<AgentMessage[]> {
    if (this.currentState === 'running') {
      // If already running, steer the input
      this.steer(text);
      return this.messages;
    }

    this.currentState = 'running';
    this.abortController = new AbortController();

    const userMessage: AgentMessage = {
      role: 'user',
      content: text,
    };
    this.messages.push(userMessage);

    // If system prompt is specified and not present in messages yet, prepend it
    if (this.config.agent.systemPrompt && !this.messages.some((m) => m.role === 'system')) {
      this.messages.unshift({
        role: 'system',
        content: this.config.agent.systemPrompt,
      });
    }

    try {
      const updatedMessages = await runAgentLoop({
        agent: this.config.agent,
        sessionId: this.config.sessionId,
        messages: this.messages,
        tools: this.config.tools ?? [],
        hooks: this.hooks,
        signal: this.abortController.signal,
        steeringQueue: this.steeringQueue,
        followUpQueue: this.followUpQueue,
        emit: (event) => this.emit(event),
        baseUrl: this.config.baseUrl,
        apiKey: this.config.apiKey ?? this.config.agent.apiKey,
        retryPolicy: this.config.retryPolicy,
        streamChatFn: this.config.streamChatFn,
      });

      this.messages = updatedMessages;
      return this.messages;
    } finally {
      this.currentState = 'idle';
      this.abortController = null;
      const resolvers = [...this.idleResolvers];
      this.idleResolvers.length = 0;
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }
}
