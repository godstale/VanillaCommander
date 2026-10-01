import type { AgentMessage, TokenUsage } from '@/lib/agent/types';
import type {
  Entry,
  CompactionEntry,
  CustomEntry,
  MessageEntry,
} from '@/lib/types/chat';
import type { CompactionSettings } from './settings';
import { findCutPoint } from './cutPoint';
import {
  serializeMessagesForSummary,
  extractFileOps,
  type FileOps,
} from './serialize';
import {
  COMPACTION_SYSTEM_PROMPT,
  buildCompactionUserPrompt,
} from './prompts';
import { estimateContextTokens } from './estimate';
import { streamChat } from '@/lib/llm/ollamaClient';
import { streamChat as streamOpenAiChat } from '@/lib/llm/openAiCompatibleClient';
import type { LlmStreamChatFn } from '@/lib/llm/providerRuntime';
import type { LlmProviderKind } from '@/lib/types/agent';
import * as entriesRepo from '@/lib/db/repositories/entriesRepo';

export interface CompactionPreparation {
  sessionId: string;
  messagesToSummarize: AgentMessage[];
  serializedText: string;
  previousSummary?: string;
  firstKeptEntryId: string;
  fileOps: FileOps;
  tokensBefore: number;
}

export type CompactionReason = 'manual' | 'threshold' | 'overflow';

export interface CompactOptions {
  model: string;
  baseUrl?: string;
  apiKey?: string;
  provider?: LlmProviderKind;
  reason?: CompactionReason;
  customInstructions?: string;
  streamChatFn?: LlmStreamChatFn;
}

/**
 * Prepares compaction data from entries and settings.
 * Returns null if no messages qualify for summarization.
 */
export function prepareCompaction(
  sessionId: string,
  entries: Entry[],
  settings: CompactionSettings,
): CompactionPreparation | null {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);

  // Extract all message entries and their corresponding entry IDs
  const messageEntries: { entry: MessageEntry; message: AgentMessage }[] = [];
  let lastCompaction: CompactionEntry | null = null;

  for (const item of sorted) {
    if (item.type === 'message') {
      messageEntries.push({
        entry: item as MessageEntry,
        message: (item as MessageEntry).message,
      });
    } else if (item.type === 'compaction') {
      lastCompaction = item as CompactionEntry;
    }
  }

  if (messageEntries.length === 0) return null;

  // Determine startIndex: if there was a previous compaction, start from its firstKeptEntryId
  let startIndex = 0;
  if (lastCompaction) {
    const idx = messageEntries.findIndex(
      (m) => m.entry.id === lastCompaction?.firstKeptEntryId,
    );
    if (idx >= 0) {
      startIndex = idx;
    }
  }

  const allMessages = messageEntries.map((m) => m.message);
  const cutPoint = findCutPoint(
    allMessages,
    settings.keepRecentTokens,
    startIndex,
  );

  // If cutPoint didn't advance past startIndex, there is nothing new to summarize
  if (cutPoint <= startIndex) {
    return null;
  }

  const messagesToSummarize = allMessages.slice(startIndex, cutPoint);
  const serializedText = serializeMessagesForSummary(messagesToSummarize);
  const fileOps = extractFileOps(messagesToSummarize, lastCompaction?.details);
  const tokensBefore = estimateContextTokens(allMessages).tokens;

  // The first kept entry is the message entry at index cutPoint
  const firstKeptEntry =
    cutPoint < messageEntries.length
      ? messageEntries[cutPoint].entry
      : messageEntries[messageEntries.length - 1].entry;

  return {
    sessionId,
    messagesToSummarize,
    serializedText,
    previousSummary: lastCompaction?.summary,
    firstKeptEntryId: firstKeptEntry.id,
    fileOps,
    tokensBefore,
  };
}

/**
 * Executes the LLM summarization call and stores the compaction and notice entries.
 */
export async function executeCompact(
  preparation: CompactionPreparation,
  options: CompactOptions,
  signal?: AbortSignal,
): Promise<{
  compactionEntry: CompactionEntry;
  noticeEntry: CustomEntry;
  summary: string;
}> {
  const fileOpsXml = [
    '<read-files>',
    ...preparation.fileOps.readFiles.map((f) => `  ${f}`),
    '</read-files>',
    '<modified-files>',
    ...preparation.fileOps.modifiedFiles.map((f) => `  ${f}`),
    '</modified-files>',
  ].join('\n');

  const userPrompt = buildCompactionUserPrompt(
    preparation.serializedText,
    preparation.previousSummary,
    options.customInstructions,
    fileOpsXml,
  );

  const streamFn: LlmStreamChatFn =
    options.streamChatFn ??
    ((options.provider && options.provider !== 'ollama' ? streamOpenAiChat : streamChat) as unknown as LlmStreamChatFn);
  const stream = streamFn(
    {
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages: [
        { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
    },
    signal,
  );

  let summary = '';
  let usage: TokenUsage | undefined;

  for await (const chunk of stream) {
    if (chunk.content) {
      summary += chunk.content;
    }
    if (chunk.usage) {
      usage = chunk.usage;
    }
  }

  summary = summary.trim();

  // Create entries to append
  const compactionEntryData: Omit<CompactionEntry, 'seq'> = {
    id: crypto.randomUUID(),
    sessionId: preparation.sessionId,
    parentId: null,
    type: 'compaction',
    createdAt: new Date().toISOString(),
    summary,
    firstKeptEntryId: preparation.firstKeptEntryId,
    tokensBefore: preparation.tokensBefore,
    usage,
    details: preparation.fileOps,
  };

  const noticeEntryData: Omit<CustomEntry, 'seq'> = {
    id: crypto.randomUUID(),
    sessionId: preparation.sessionId,
    parentId: null,
    type: 'custom',
    customType: 'compaction_notice',
    createdAt: new Date().toISOString(),
    payload: {
      reason: options.reason ?? 'threshold',
      tokensBefore: preparation.tokensBefore,
      summary,
    },
  };

  const [savedCompaction, savedNotice] = await entriesRepo.appendEntries(
    preparation.sessionId,
    [compactionEntryData, noticeEntryData],
  );

  return {
    compactionEntry: savedCompaction as CompactionEntry,
    noticeEntry: savedNotice as CustomEntry,
    summary,
  };
}
