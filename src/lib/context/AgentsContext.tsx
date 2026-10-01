import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import type { Agent } from '@/lib/types/agent';
import { DEFAULT_AGENT } from '@/lib/agent/defaultAgent';
import * as agentsRepo from '@/lib/db/repositories/agentsRepo';

export interface AgentsContextValue {
  agents: Agent[];
  defaultAgent: Agent;
  loading: boolean;
  refreshAgents: () => Promise<void>;
  createAgent: (
    agentData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ) => Promise<Agent>;
  updateAgent: (
    id: string,
    updates: Partial<Omit<Agent, 'id' | 'createdAt'>>,
  ) => Promise<Agent>;
  deleteAgent: (id: string) => Promise<boolean>;
  setDefaultAgent: (id: string) => Promise<void>;
  getAgent: (id: string) => Agent | undefined;
  /** 삭제된 에이전트까지 포함한既知 이름 조회. 대화/모니터링 목록의 취소선 표시에 사용한다. */
  getKnownAgentName: (id: string) => string | undefined;
}

const KNOWN_AGENT_NAMES_KEY = 'fortress_known_agent_names';

function loadKnownAgentNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KNOWN_AGENT_NAMES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v.length > 0) out[k] = v;
      }
      return out;
    }
  } catch {
    // ignore malformed storage
  }
  return {};
}

function persistKnownAgentNames(map: Record<string, string>): void {
  try {
    localStorage.setItem(KNOWN_AGENT_NAMES_KEY, JSON.stringify(map));
  } catch {
    // 저장 실패는 무시한다 (표시용 캐시이므로)
  }
}

export const AgentsContext = createContext<AgentsContextValue | undefined>(undefined);

export function AgentsProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>([DEFAULT_AGENT]);
  const [loading, setLoading] = useState(true);
  // 삭제 후에도 대화 목록에서 이름을 표시하기 위한 id → name 캐시 (localStorage 영속).
  const [knownNames, setKnownNames] = useState<Record<string, string>>(
    loadKnownAgentNames,
  );

  const rememberNames = useCallback((list: Agent[]) => {
    setKnownNames((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const a of list) {
        if (next[a.id] !== a.name) {
          next[a.id] = a.name;
          changed = true;
        }
      }
      if (changed) persistKnownAgentNames(next);
      return changed ? next : prev;
    });
  }, []);

  const refreshAgents = useCallback(async () => {
    try {
      let list = await agentsRepo.listAgents();

      // If DB has 0 agents, seed DEFAULT_AGENT
      if (list.length === 0) {
        await agentsRepo.createAgent({
          ...DEFAULT_AGENT,
          isDefault: true,
        });
        list = await agentsRepo.listAgents();
      } else {
        // Auto-migrate: ensure agents with web_search also have web_fetch enabled
        for (const ag of list) {
          if (
            ag.enabledBuiltinTools?.includes('web_search') &&
            !ag.enabledBuiltinTools.includes('web_fetch')
          ) {
            const updated = [...ag.enabledBuiltinTools, 'web_fetch' as const];
            try {
              await agentsRepo.updateAgent(ag.id, { enabledBuiltinTools: updated });
              ag.enabledBuiltinTools = updated;
            } catch {
              // ignore transient error
            }
          }
        }
      }

      setAgents(list);
      rememberNames(list);
    } catch (err) {
      console.error('Failed to load agents from repository:', err);
    } finally {
      setLoading(false);
    }
  }, [rememberNames]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (active) {
        await refreshAgents();
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshAgents]);

  const getKnownAgentName = useCallback(
    (id: string): string | undefined => {
      const live = agents.find((a) => a.id === id);
      if (live) return live.name;
      return knownNames[id];
    },
    [agents, knownNames],
  );

  const defaultAgent = useMemo(() => {
    return agents.find((a) => a.isDefault) || agents[0] || DEFAULT_AGENT;
  }, [agents]);

  const getAgent = useCallback(
    (id: string): Agent | undefined => {
      return agents.find((a) => a.id === id);
    },
    [agents],
  );

  const create = useCallback(
    async (
      agentData: Omit<Agent, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
    ): Promise<Agent> => {
      const id = agentData.id || `agent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const created = await agentsRepo.createAgent({
        ...agentData,
        id,
      });
      await refreshAgents();
      return created;
    },
    [refreshAgents],
  );

  const update = useCallback(
    async (
      id: string,
      updates: Partial<Omit<Agent, 'id' | 'createdAt'>>,
    ): Promise<Agent> => {
      const updated = await agentsRepo.updateAgent(id, updates);
      await refreshAgents();
      return updated;
    },
    [refreshAgents],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      if (agents.length <= 1) {
        // Last remaining agent cannot be deleted
        return false;
      }
      await agentsRepo.deleteAgent(id);
      await refreshAgents();
      return true;
    },
    [agents.length, refreshAgents],
  );

  const setDefault = useCallback(
    async (id: string): Promise<void> => {
      await agentsRepo.updateAgent(id, { isDefault: true });
      await refreshAgents();
    },
    [refreshAgents],
  );

  return (
    <AgentsContext.Provider
      value={{
        agents,
        defaultAgent,
        loading,
        refreshAgents,
        createAgent: create,
        updateAgent: update,
        deleteAgent: remove,
        setDefaultAgent: setDefault,
        getAgent,
        getKnownAgentName,
      }}
    >
      {children}
    </AgentsContext.Provider>
  );
}

export function useAgents(): AgentsContextValue {
  const ctx = useContext(AgentsContext);
  if (!ctx) {
    throw new Error('useAgents must be used within an AgentsProvider');
  }
  return ctx;
}
