import type { AgentMessage, AgentToolResult, RiskLevel } from './types';

export interface BeforeToolCallContext {
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  risk: RiskLevel;
}

export interface AfterToolCallContext {
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  result: AgentToolResult;
}

export interface ShouldStopAfterTurnContext {
  turnIndex: number;
  messages: AgentMessage[];
}

export interface AgentHooks {
  beforeToolCall?(
    ctx: BeforeToolCallContext,
    signal: AbortSignal,
  ): Promise<{ block?: boolean; reason?: string; terminate?: boolean } | undefined>;

  afterToolCall?(
    ctx: AfterToolCallContext,
    signal: AbortSignal,
  ): Promise<Partial<AgentToolResult> | undefined>;

  transformContext?(
    messages: AgentMessage[],
    signal: AbortSignal,
  ): Promise<AgentMessage[]>;

  shouldStopAfterTurn?(
    ctx: ShouldStopAfterTurnContext,
  ): boolean | Promise<boolean>;

  /** 컨텍스트 초과로 요청이 거부됐을 때. 축소된 컨텍스트를 반환하면 루프가 1회 재시도한다 (§9.5). */
  onContextOverflow?(
    messages: AgentMessage[],
    signal: AbortSignal,
  ): Promise<AgentMessage[] | undefined>;
}

export function composeHooks(...hookList: (AgentHooks | undefined)[]): AgentHooks {
  const activeHooks = hookList.filter((h): h is AgentHooks => h !== undefined);

  return {
    async beforeToolCall(ctx, signal) {
      let terminate = false;
      for (const h of activeHooks) {
        if (!h.beforeToolCall) continue;
        const res = await h.beforeToolCall(ctx, signal);
        if (res?.block) {
          return res; // Short-circuit evaluation on block
        }
        if (res?.terminate) {
          terminate = true;
        }
      }
      return terminate ? { terminate: true } : undefined;
    },

    async afterToolCall(ctx, signal) {
      let mergedResult: Partial<AgentToolResult> = {};
      let currentResult: AgentToolResult = { ...ctx.result };

      for (const h of activeHooks) {
        if (!h.afterToolCall) continue;
        const patch = await h.afterToolCall(
          { ...ctx, result: currentResult },
          signal,
        );
        if (patch) {
          mergedResult = { ...mergedResult, ...patch };
          currentResult = { ...currentResult, ...patch };
        }
      }
      return Object.keys(mergedResult).length > 0 ? mergedResult : undefined;
    },

    async transformContext(messages, signal) {
      let current = messages;
      for (const h of activeHooks) {
        if (!h.transformContext) continue;
        current = await h.transformContext(current, signal);
      }
      return current;
    },

    async shouldStopAfterTurn(ctx) {
      for (const h of activeHooks) {
        if (!h.shouldStopAfterTurn) continue;
        const stop = await h.shouldStopAfterTurn(ctx);
        if (stop) return true;
      }
      return false;
    },

    async onContextOverflow(messages, signal) {
      for (const h of activeHooks) {
        if (!h.onContextOverflow) continue;
        const res = await h.onContextOverflow(messages, signal);
        if (res) return res;
      }
      return undefined;
    },
  };
}
