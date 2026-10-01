import type {
  Entry,
  CompactionEntry,
  CustomEntry,
  MessageEntry,
} from '@/lib/types/chat';
import type { AgentMessage } from '@/lib/agent/types';

export type TimelineItem =
  | { type: 'message'; entryId: string; message: AgentMessage }
  | { type: 'compaction'; entryId: string; entry: CompactionEntry }
  | { type: 'custom'; entryId: string; entry: CustomEntry };

/**
 * Validates that every assistant message with toolCalls is immediately followed
 * by corresponding toolResult messages.
 * If broken (corrupted or orphaned), strips the toolCalls from the assistant message
 * and emits a warning log to prevent LLM API failure.
 */
function sanitizeToolCallInvariants(messages: AgentMessage[]): AgentMessage[] {
  const result: AgentMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const current = messages[i];

    if (current.role === 'assistant' && current.toolCalls && current.toolCalls.length > 0) {
      const toolCalls = current.toolCalls;
      let valid = true;

      // Check if subsequent messages contain all required toolResults
      for (let tcIdx = 0; tcIdx < toolCalls.length; tcIdx++) {
        const nextMsg = messages[i + 1 + tcIdx];
        if (
          !nextMsg ||
          nextMsg.role !== 'toolResult' ||
          nextMsg.toolCallId !== toolCalls[tcIdx].id
        ) {
          valid = false;
          break;
        }
      }

      if (!valid) {
        console.warn(
          'Invariant violation: assistant message with toolCalls missing corresponding toolResult. Stripping toolCalls.',
          current,
        );
        const sanitized = { ...current };
        delete sanitized.toolCalls;
        result.push(sanitized);
      } else {
        result.push(current);
      }
    } else {
      result.push(current);
    }
  }

  return result;
}

/**
 * Reconstructs the list of AgentMessages to send to the LLM from stored entries.
 * Rules:
 * 1. Order by seq ascending.
 * 2. Find the last compaction entry. If none, all message entries form the context.
 * 3. If compaction exists: [summary message] + (messages starting from firstKeptEntryId onwards).
 * 4. Custom entries are excluded from the LLM context.
 * 5. Sanitize toolCall-toolResult invariant pairs.
 */
export function buildLlmContext(entries: Entry[]): AgentMessage[] {
  if (entries.length === 0) return [];

  // 1. Sort entries by seq ascending
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);

  // 2. Find the last compaction entry
  let lastCompaction: CompactionEntry | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].type === 'compaction') {
      lastCompaction = sorted[i] as CompactionEntry;
      break;
    }
  }

  const rawMessages: AgentMessage[] = [];

  if (!lastCompaction) {
    // No compaction: keep all message entries
    for (const entry of sorted) {
      if (entry.type === 'message') {
        rawMessages.push((entry as MessageEntry).message);
      }
    }
  } else {
    // Compaction exists
    // Add the summary as a system message
    rawMessages.push({
      role: 'system',
      content: `Below is a summary of the earlier conversation:\n\n${lastCompaction.summary}`,
    });

    // Find the first kept entry's index or seq
    const firstKeptEntry = sorted.find(
      (e) => e.id === lastCompaction?.firstKeptEntryId,
    );

    const minSeq = firstKeptEntry ? firstKeptEntry.seq : lastCompaction.seq;

    for (const entry of sorted) {
      if (entry.type === 'message' && entry.seq >= minSeq) {
        rawMessages.push((entry as MessageEntry).message);
      }
    }
  }

  // 5. Invariant validation & sanitization
  return sanitizeToolCallInvariants(rawMessages);
}

/**
 * Reconstructs the complete UI timeline for user presentation (including original history,
 * compaction notices/banners, and custom entries).
 */
export function buildUiTimeline(entries: Entry[]): TimelineItem[] {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);

  return sorted.map((entry) => {
    switch (entry.type) {
      case 'message':
        return {
          type: 'message',
          entryId: entry.id,
          message: (entry as MessageEntry).message,
        };
      case 'compaction':
        return {
          type: 'compaction',
          entryId: entry.id,
          entry: entry as CompactionEntry,
        };
      case 'custom':
        return {
          type: 'custom',
          entryId: entry.id,
          entry: entry as CustomEntry,
        };
    }
  });
}
