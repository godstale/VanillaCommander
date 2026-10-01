import type { ZodTypeAny, z } from 'zod';
import type { ChatConfigSnapshot } from '@/lib/types/agent';

export type RiskLevel = 'low' | 'high' | 'critical';

/** LLM 턴 중간에 주입되는 자동 복구 안내의 접두사. 시스템 메시지로 취급한다. */
export const SYSTEM_AUTO_GUIDE_PREFIX = '[시스템 자동 안내]';

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export type AgentMessage =
  | { role: 'system'; content: string; sections?: Record<string, string>; config?: ChatConfigSnapshot }
  | { role: 'user'; content: string; config?: ChatConfigSnapshot }
  | {
      role: 'assistant';
      content: string;
      thinking?: string;
      toolCalls?: AgentToolCall[];
      usage?: TokenUsage;
      stopReason: 'stop' | 'toolUse' | 'length' | 'aborted' | 'error';
      errorMessage?: string;
    }
  | {
      role: 'toolResult';
      toolCallId: string;
      toolName: string;
      content: string;
      isError: boolean;
    };

export interface AgentToolResult {
  content: string; // Text passed to LLM context (truncated)
  details?: unknown; // Raw details for UI logs / viewers
  isError?: boolean;
  terminate?: boolean; // If all batch results terminate, turn loop terminates
}

export interface AgentTool<S extends ZodTypeAny = ZodTypeAny> {
  name: string; // Name exposed to LLM
  label: string; // UI display label
  description: string;
  parameters: S;
  risk: RiskLevel;
  executionMode?: 'sequential' | 'parallel';
  execute(
    toolCallId: string,
    params: z.infer<S>,
    signal: AbortSignal,
    onUpdate?: (partial: AgentToolResult) => void,
  ): Promise<AgentToolResult>;
}

export interface ApprovalRequest {
  id: string;
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  risk: RiskLevel;
  description: string;
}

export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'turn_start' }
  | { type: 'message_start'; message: AgentMessage }
  | { type: 'message_update'; message: AgentMessage; delta: string }
  | { type: 'message_end'; message: AgentMessage }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_execution_update'; toolCallId: string; partial: AgentToolResult }
  | { type: 'tool_execution_end'; toolCallId: string; toolName?: string; result: AgentToolResult; isError: boolean }
  | { type: 'turn_end'; message: AgentMessage; toolResults: AgentMessage[] }
  | { type: 'agent_end'; messages: AgentMessage[] }
  | { type: 'compaction_start' }
  | { type: 'compaction_end'; entry: unknown }
  | { type: 'approval_request'; request: ApprovalRequest }
  | { type: 'error'; error: Error };
