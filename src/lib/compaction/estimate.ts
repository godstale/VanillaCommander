import type { AgentMessage } from '@/lib/agent/types';
import type { CompactionSettings } from './settings';

export interface ContextEstimate {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number;
}

/**
 * Heuristically estimates token count for a message using ceil(chars / 4).
 * Includes content, thinking, and tool call payload strings.
 */
export function estimateMessageTokens(msg: AgentMessage): number {
  let charCount = msg.content ? msg.content.length : 0;

  if (msg.role === 'assistant') {
    if (msg.thinking) {
      charCount += msg.thinking.length;
    }
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      charCount += JSON.stringify(msg.toolCalls).length;
    }
  }

  if (charCount === 0) return 0;
  return Math.ceil(charCount / 4);
}

/**
 * Estimates context token count according to Architecture §9.2:
 * 1. Scans messages in reverse to find the most recent assistant message with usage.total.
 *    Messages with stopReason 'aborted' or 'error' are skipped.
 * 2. Messages after that index are estimated with ceil(chars / 4).
 * 3. If no usage is found, the entire context is estimated with ceil(chars / 4).
 */
export function estimateContextTokens(
  messages: AgentMessage[],
): ContextEstimate {
  let lastUsageIndex = -1;
  let usageTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (
      msg.role === 'assistant' &&
      msg.usage &&
      msg.usage.total > 0 &&
      msg.stopReason !== 'aborted' &&
      msg.stopReason !== 'error'
    ) {
      lastUsageIndex = i;
      usageTokens = msg.usage.total;
      break;
    }
  }

  let trailingTokens = 0;
  const startIndex = lastUsageIndex >= 0 ? lastUsageIndex + 1 : 0;

  for (let i = startIndex; i < messages.length; i++) {
    trailingTokens += estimateMessageTokens(messages[i]);
  }

  const tokens = usageTokens + trailingTokens;

  return {
    tokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex,
  };
}

/**
 * Determines whether compaction is triggered:
 * contextTokens > contextSize - reserveTokens
 */
export function shouldCompact(
  contextTokens: number,
  contextSize: number,
  settingsOrReserve: CompactionSettings | number,
): boolean {
  const reserveTokens =
    typeof settingsOrReserve === 'number'
      ? settingsOrReserve
      : settingsOrReserve.reserveTokens;

  const threshold = contextSize - reserveTokens;
  return contextTokens > threshold;
}
