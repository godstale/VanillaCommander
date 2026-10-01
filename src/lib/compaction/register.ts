import { registerHooks } from '@/lib/agent/hookRegistry';
import type { AgentMessage } from '@/lib/agent/types';
import type { LlmProviderKind } from '@/lib/types/agent';
import { estimateContextTokens, shouldCompact } from './estimate';
import { resolveCompactionSettings, type CompactionSettings } from './settings';
import { prepareCompaction, executeCompact } from './compact';
import * as entriesRepo from '@/lib/db/repositories/entriesRepo';
import { buildLlmContext } from '@/lib/db/buildContext';
import { appLogger } from '@/lib/logger/logger';

let currentSessionId: string | null = null;
let currentModel = 'qwen3.5:9b';
let currentBaseUrl: string | undefined;
let currentApiKey: string | undefined;
let currentProvider: LlmProviderKind = 'ollama';
let currentSettings: CompactionSettings = resolveCompactionSettings();

/**
 * Updates the active session metadata for compaction hooks.
 */
export function setActiveCompactionSession(opts: {
  sessionId: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  provider?: LlmProviderKind;
  settings?: CompactionSettings;
}): void {
  currentSessionId = opts.sessionId;
  currentModel = opts.model;
  currentBaseUrl = opts.baseUrl;
  currentApiKey = opts.apiKey;
  if (opts.provider) currentProvider = opts.provider;
  if (opts.settings) {
    currentSettings = opts.settings;
  }
}

async function performCompaction(
  reason: 'threshold' | 'overflow',
  signal?: AbortSignal,
  messagesToSync?: AgentMessage[],
): Promise<AgentMessage[] | null> {
  if (!currentSessionId) return null;

  try {
    const entries = await entriesRepo.getEntries(currentSessionId);

    // Sync any messages from active memory that have not yet been persisted to entries table
    if (messagesToSync && messagesToSync.length > 0) {
      const existingMessageCount = entries.filter((e) => e.type === 'message').length;
      const nonSystemMessages = messagesToSync.filter((m) => m.role !== 'system');
      if (nonSystemMessages.length > existingMessageCount) {
        const missing = nonSystemMessages.slice(existingMessageCount);
        const toAppend = missing.map((msg) => ({
          id: crypto.randomUUID(),
          sessionId: currentSessionId!,
          parentId: null,
          type: 'message' as const,
          createdAt: new Date().toISOString(),
          message: msg,
        }));
        await entriesRepo.appendEntries(currentSessionId, toAppend);
      }
    }

    const fullEntries = await entriesRepo.getEntries(currentSessionId);
    if (fullEntries.length === 0) return null;

    const prep = prepareCompaction(currentSessionId, fullEntries, currentSettings);
    if (!prep) return null;

    appLogger.warn(
      'context',
      `컨텍스트 자동 압축 시작 (사유: ${reason}, 압축 전 토큰 추정치: ${prep.tokensBefore})`,
      { reason, tokensBefore: prep.tokensBefore, messagesCount: fullEntries.length },
      currentSessionId,
    );

    const result = await executeCompact(
      prep,
      {
        model: currentModel,
        baseUrl: currentBaseUrl,
        apiKey: currentApiKey,
        provider: currentProvider,
        reason,
      },
      signal,
    );

    appLogger.info(
      'context',
      `컨텍스트 자동 압축 완료 (요약 생성됨)`,
      { summaryPreview: result.summary.slice(0, 200) },
      currentSessionId,
    );

    const updatedEntries = await entriesRepo.getEntries(currentSessionId);
    return buildLlmContext(updatedEntries);
  } catch (err) {
    console.error(`Compaction failed (${reason}):`, err);
    appLogger.error(
      'context',
      `컨텍스트 압축 실패 (${reason}): ${err instanceof Error ? err.message : String(err)}`,
      err,
      currentSessionId,
    );
    return null;
  }
}

// Register compaction hooks into the runtime registry
registerHooks('compaction', {
  async transformContext(
    messages: AgentMessage[],
    signal?: AbortSignal,
  ): Promise<AgentMessage[]> {
    const est = estimateContextTokens(messages);
    if (shouldCompact(est.tokens, currentSettings.contextSize, currentSettings)) {
      const compacted = await performCompaction('threshold', signal, messages);
      if (compacted) {
        return compacted;
      }
    }
    return messages;
  },

  async onContextOverflow(
    messages: AgentMessage[],
    signal?: AbortSignal,
  ): Promise<AgentMessage[] | undefined> {
    const compacted = await performCompaction('overflow', signal, messages);
    return compacted ?? undefined;
  },
});
