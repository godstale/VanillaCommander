import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { ChatSession, ChatSessionOrigin } from '@/lib/types/chat';
import * as sessionsRepo from '@/lib/db/repositories/sessionsRepo';
import * as entriesRepo from '@/lib/db/repositories/entriesRepo';
import * as agentsRepo from '@/lib/db/repositories/agentsRepo';
import { DEFAULT_AGENT } from '@/lib/agent/defaultAgent';
import { useWorkspace } from '@/lib/context/WorkspaceContext';

export interface ChatSessionsContextValue {
  sessions: ChatSession[];
  isLoading: boolean;
  activeSessionId: string | null;
  refreshSessions: () => Promise<void>;
  createSession: (opts?: {
    title?: string;
    workspaceRoot?: string;
    agentId?: string;
    origin?: ChatSessionOrigin;
  }) => Promise<ChatSession>;
  deleteSession: (id: string) => Promise<void>;
  clearSessions: () => Promise<void>;
  updateSessionTitle: (id: string, title: string) => Promise<void>;
  selectSession: (id: string | null) => void;
}

const ChatSessionsContext = createContext<ChatSessionsContextValue | null>(null);

export function ChatSessionsProvider({ children }: { children: ReactNode }) {
  const { workspaceRoot } = useWorkspace();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const refreshSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await sessionsRepo.listSessions();
      // P11-15: 탐색기·매크로 등 숨은 세션은 대화 목록에 노출하지 않는다.
      let filtered = list.filter((s) => (s.origin ?? 'chat') === 'chat');
      filtered = workspaceRoot
        ? // Show sessions matching this workspace root, or global sessions
          filtered.filter(
            (s) => s.workspaceRoot === workspaceRoot || !s.workspaceRoot,
          )
        : filtered;
      // Empty sessions (no entries, i.e. chat tab opened but no message sent yet)
      // must not appear in the conversation list. Prune stale ones (>60s old to
      // avoid racing an in-flight first send) and hide the rest.
      try {
        const now = Date.now();
        const checks = await Promise.all(
          filtered.map(async (s) => {
            try {
              const n = await entriesRepo.countEntries(s.id);
              return { session: s, count: n };
            } catch {
              return { session: s, count: 1 };
            }
          }),
        );
        const visible: ChatSession[] = [];
        for (const { session, count } of checks) {
          if (count === 0) {
            const ageMs = now - new Date(session.createdAt).getTime();
            if (Number.isFinite(ageMs) && ageMs > 60_000) {
              try {
                await sessionsRepo.deleteSession(session.id);
              } catch {
                // ignore prune failure, just hide below
              }
            }
            continue;
          }
          visible.push(session);
        }
        filtered = visible;
      } catch {
        // entry-count lookup failed: fall back to unfiltered list
      }
      if (workspaceRoot) {
        setSessions(filtered);
      } else {
        setSessions(filtered);
      }
    } catch (err) {
      console.error('Failed to load chat sessions:', err);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (active) {
        await refreshSessions();
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshSessions]);

  const createSession = useCallback(
    async (opts?: {
      title?: string;
      workspaceRoot?: string;
      agentId?: string;
      origin?: ChatSessionOrigin;
    }): Promise<ChatSession> => {
      let agentId = opts?.agentId;
      if (!agentId) {
        try {
          const def = await agentsRepo.getDefaultAgent();
          agentId = def?.id ?? DEFAULT_AGENT.id;
        } catch {
          agentId = DEFAULT_AGENT.id;
        }
      }

      const id = crypto.randomUUID();
      const newSession = await sessionsRepo.createSession({
        id,
        agentId,
        workspaceRoot: opts?.workspaceRoot ?? workspaceRoot ?? null,
        origin: opts?.origin ?? 'chat',
        title: opts?.title || '새로운 대화',
      });

      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      return newSession;
    },
    [workspaceRoot],
  );

  const deleteSession = useCallback(
    async (id: string): Promise<void> => {
      await sessionsRepo.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setActiveSessionId((prev) => (prev === id ? null : prev));
    },
    [],
  );

  const clearSessions = useCallback(async (): Promise<void> => {
    const ids = sessions.map((s) => s.id);
    for (const id of ids) {
      try {
        await sessionsRepo.deleteSession(id);
      } catch (err) {
        console.error('Failed to delete chat session during clear-all:', err);
      }
    }
    setSessions([]);
    setActiveSessionId(null);
  }, [sessions]);

  const updateSessionTitle = useCallback(
    async (id: string, title: string): Promise<void> => {
      const updated = await sessionsRepo.updateSession(id, { title });
      setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
    },
    [],
  );

  const value = useMemo(
    () => ({
      sessions,
      isLoading,
      activeSessionId,
      refreshSessions,
      createSession,
      deleteSession,
      clearSessions,
      updateSessionTitle,
      selectSession: setActiveSessionId,
    }),
    [
      sessions,
      isLoading,
      activeSessionId,
      refreshSessions,
      createSession,
      deleteSession,
      clearSessions,
      updateSessionTitle,
    ],
  );

  return (
    <ChatSessionsContext.Provider value={value}>
      {children}
    </ChatSessionsContext.Provider>
  );
}

export function useChatSessions(): ChatSessionsContextValue {
  const ctx = useContext(ChatSessionsContext);
  if (!ctx) {
    throw new Error('useChatSessions must be used within a ChatSessionsProvider');
  }
  return ctx;
}

export function useSafeChatSessions(): ChatSessionsContextValue | null {
  return useContext(ChatSessionsContext);
}
