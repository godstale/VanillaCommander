import * as sessionsRepo from '@/lib/db/repositories/sessionsRepo';
import * as entriesRepo from '@/lib/db/repositories/entriesRepo';
import { appLogger } from '@/lib/logger/logger';

export interface ToolMetric {
  calls: number;
  successes: number;
  errors: number;
}

export interface LlmCallRecord {
  id: string;
  agentId: string;
  sessionId?: string;
  contextTokens: number;
  outputTokens: number;
  durationMs: number;
  toolCallsCount: number;
  prefillTokens?: number;
  prefillDurationMs?: number;
  prefillSpeed?: number;
  decodingTokens?: number;
  decodingDurationMs?: number;
  decodingSpeed?: number;
  timestamp: string;
}

export interface ErrorRecord {
  id: string;
  timestamp: string;
  agentId: string;
  sessionId?: string;
  source: 'ollama' | 'tool' | 'approval' | 'compaction' | 'system';
  message: string;
  details?: unknown;
}

export interface DetailedAgentStats {
  agentId: string;
  sessionCount: number;
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  avgDurationMs: number;
  toolUsage: Record<string, ToolMetric>;
  recentErrors: ErrorRecord[];
  llmCalls: LlmCallRecord[];
  contextVsDuration: {
    contextTokens: number;
    durationMs: number;
    outputTokens: number;
    timestamp: string;
  }[];
  sessionHistory: {
    sessionId: string;
    title: string;
    messageCount: number;
    tokenCount: number;
    errorCount: number;
    updatedAt: string;
  }[];
}

const memoryErrors: ErrorRecord[] = [];
const memoryLlmCalls: LlmCallRecord[] = [];
const MAX_RECORDS = 500;

export function recordLlmCall(call: Omit<LlmCallRecord, 'id' | 'timestamp'>): LlmCallRecord {
  const record: LlmCallRecord = {
    ...call,
    id: `call-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
  };

  memoryLlmCalls.unshift(record);
  if (memoryLlmCalls.length > MAX_RECORDS) {
    memoryLlmCalls.pop();
  }

  return record;
}

export function recordAgentError(error: Omit<ErrorRecord, 'id' | 'timestamp'>): ErrorRecord {
  const record: ErrorRecord = {
    ...error,
    id: `err-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
  };

  memoryErrors.unshift(record);
  if (memoryErrors.length > MAX_RECORDS) {
    memoryErrors.pop();
  }

  appLogger.error(
    'agent',
    `[${error.source}] ${error.message}`,
    error.details,
    error.sessionId,
    error.agentId,
  );

  return record;
}

export async function computeAgentStats(agentId: string): Promise<DetailedAgentStats> {
  const allSessions = await sessionsRepo.listSessions();
  const agentSessions = allSessions.filter((s) => s.agentId === agentId);

  let totalMessages = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  const toolUsage: Record<string, ToolMetric> = {};

  const sessionHistory: DetailedAgentStats['sessionHistory'] = [];

  for (const s of agentSessions) {
    let entries = await entriesRepo.getEntries(s.id);
    if (entries.length === 0 && !s.id.startsWith('chat:')) {
      const fallback = await entriesRepo.getEntries(`chat:${s.id}`);
      if (fallback.length > 0) {
        entries = fallback;
      }
    }
    let sessionMsgCount = 0;
    let sessionTokenCount = 0;
    let sessionErrorCount = 0;

    for (const entry of entries) {
      if (entry.type === 'message') {
        sessionMsgCount++;
        totalMessages++;
        const msg = entry.message;
        if (msg.role === 'user') {
          userMessages++;
        } else if (msg.role === 'assistant') {
          assistantMessages++;
          if (msg.usage) {
            promptTokens += msg.usage.input || 0;
            completionTokens += msg.usage.output || 0;
            totalTokens += msg.usage.total || 0;
            sessionTokenCount += msg.usage.total || 0;
          }
          if (msg.errorMessage) {
            sessionErrorCount++;
          }
        } else if (msg.role === 'toolResult') {
          const tName = msg.toolName || 'unknown';
          if (!toolUsage[tName]) {
            toolUsage[tName] = { calls: 0, successes: 0, errors: 0 };
          }
          toolUsage[tName].calls++;
          if (msg.isError) {
            toolUsage[tName].errors++;
            sessionErrorCount++;
          } else {
            toolUsage[tName].successes++;
          }
        }
      }
    }

    sessionHistory.push({
      sessionId: s.id,
      title: s.title,
      messageCount: sessionMsgCount,
      tokenCount: sessionTokenCount,
      errorCount: sessionErrorCount,
      updatedAt: s.updatedAt,
    });
  }

  const agentErrors = memoryErrors.filter((e) => e.agentId === agentId);
  const agentCalls = memoryLlmCalls.filter((c) => c.agentId === agentId);

  const totalDuration = agentCalls.reduce((acc, c) => acc + c.durationMs, 0);
  const avgDurationMs = agentCalls.length > 0 ? Math.round(totalDuration / agentCalls.length) : 0;

  const contextVsDuration = agentCalls.map((c) => ({
    contextTokens: c.contextTokens,
    durationMs: c.durationMs,
    outputTokens: c.outputTokens,
    timestamp: c.timestamp,
  }));

  return {
    agentId,
    sessionCount: agentSessions.length,
    totalMessages,
    userMessages,
    assistantMessages,
    totalTokens,
    promptTokens,
    completionTokens,
    avgDurationMs,
    toolUsage,
    recentErrors: agentErrors,
    llmCalls: agentCalls.slice(0, 50),
    contextVsDuration,
    sessionHistory: sessionHistory.slice(0, 15),
  };
}
