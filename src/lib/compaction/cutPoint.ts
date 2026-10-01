import type { AgentMessage } from '@/lib/agent/types';
import { estimateMessageTokens } from './estimate';

/**
 * Valid cut points must only be 'user' or 'assistant' messages.
 * Never 'toolResult' (which would separate toolCalls from their toolResults).
 */
export function findValidCutPoints(messages: AgentMessage[]): number[] {
  const points: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user' || messages[i].role === 'assistant') {
      points.push(i);
    }
  }
  return points;
}

/**
 * Finds the cut point index (the index of the first message to KEEP in the recent window).
 * Messages before this index (from startIndex up to cutPointIndex) will be summarized.
 *
 * Rules (Architecture §9.3):
 * 1. Accumulates tokens backwards from the latest message towards startIndex until keepRecentTokens is reached.
 * 2. Never cuts at a 'toolResult' message.
 * 3. If the cut point lands on an 'assistant' message, rewind to the start of that turn ('user' message)
 *    to preserve turn boundaries.
 */
export function findCutPoint(
  messages: AgentMessage[],
  keepRecentTokens: number,
  startIndex = 0,
): number {
  if (messages.length === 0 || startIndex >= messages.length) {
    return messages.length;
  }

  let accumulated = 0;
  let splitIndex = -1;

  for (let i = messages.length - 1; i >= startIndex; i--) {
    accumulated += estimateMessageTokens(messages[i]);
    if (accumulated >= keepRecentTokens) {
      splitIndex = i;
      break;
    }
  }

  // If budget was not exhausted, keep everything from startIndex
  if (splitIndex === -1 || splitIndex <= startIndex) {
    return startIndex;
  }

  // Ensure splitIndex is never a toolResult
  while (splitIndex > startIndex && messages[splitIndex]?.role === 'toolResult') {
    splitIndex--;
  }

  // Rewind to the turn's user message so turn boundary is clean
  while (splitIndex > startIndex && messages[splitIndex]?.role !== 'user') {
    splitIndex--;
  }

  return Math.max(splitIndex, startIndex);
}
