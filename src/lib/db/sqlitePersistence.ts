import * as entriesRepo from '@/lib/db/repositories/entriesRepo';
import { buildLlmContext } from '@/lib/db/buildContext';
import type { AgentMessage } from '@/lib/agent/types';
import type { MessageEntry } from '@/lib/types/chat';

export interface ChatPersistence {
  loadMessages(sessionId: string): Promise<AgentMessage[]>;
  saveUserMessage?(sessionId: string, userMessage: AgentMessage): Promise<void>;
  saveTurn?(
    sessionId: string,
    turnMessagesOrUserMessage: AgentMessage[] | AgentMessage,
    maybeTurnMessages?: AgentMessage[],
  ): Promise<void>;
}

export class SqlitePersistence implements ChatPersistence {
  async loadMessages(sessionId: string): Promise<AgentMessage[]> {
    try {
      const entries = await entriesRepo.getEntries(sessionId);
      return buildLlmContext(entries);
    } catch {
      return [];
    }
  }

  async saveUserMessage(
    sessionId: string,
    userMessage: AgentMessage,
  ): Promise<void> {
    try {
      const entry: Omit<MessageEntry, 'seq'> = {
        id: crypto.randomUUID(),
        sessionId,
        parentId: null,
        type: 'message',
        createdAt: new Date().toISOString(),
        message: userMessage,
      };
      await entriesRepo.appendEntries(sessionId, [entry]);
    } catch (err) {
      console.error(
        `Failed to save user message for session "${sessionId}":`,
        err,
      );
    }
  }

  async saveTurn(
    sessionId: string,
    turnMessagesOrUserMessage: AgentMessage[] | AgentMessage,
    maybeTurnMessages?: AgentMessage[],
  ): Promise<void> {
    try {
      let turnMessages: AgentMessage[];
      if (Array.isArray(turnMessagesOrUserMessage)) {
        turnMessages = turnMessagesOrUserMessage;
      } else if (maybeTurnMessages) {
        turnMessages = maybeTurnMessages;
      } else {
        turnMessages = [];
      }

      const toSave: Omit<MessageEntry, 'seq'>[] = [];
      const now = new Date().toISOString();

      for (const msg of turnMessages) {
        if (msg.role === 'assistant') {
          // Architecture §4.3, §8.3: do not persist aborted or error assistant messages
          if (msg.stopReason === 'aborted' || msg.stopReason === 'error') {
            continue;
          }
        }
        toSave.push({
          id: crypto.randomUUID(),
          sessionId,
          parentId: null,
          type: 'message',
          createdAt: now,
          message: msg,
        });
      }

      if (toSave.length > 0) {
        await entriesRepo.appendEntries(sessionId, toSave);
      }
    } catch (err) {
      console.error(`Failed to save turn for session "${sessionId}":`, err);
    }
  }
}

export const defaultSqlitePersistence = new SqlitePersistence();
