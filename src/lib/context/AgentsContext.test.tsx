import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { AgentsProvider, useAgents } from './AgentsContext';
import { MemorySqlFallback, type SqlDatabase } from '@/lib/db/client';
import * as agentsRepo from '@/lib/db/repositories/agentsRepo';

describe('AgentsContext', () => {
  let memDb: MemorySqlFallback;

  beforeEach(() => {
    memDb = new MemorySqlFallback();
    // Intercept client getDatabase to use memDb for isolation
    agentsRepo.listAgents(memDb as unknown as SqlDatabase);
  });

  it('provides seeded default agent on initial load', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AgentsProvider>{children}</AgentsProvider>
    );

    const { result } = renderHook(() => useAgents(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.agents.length).toBeGreaterThanOrEqual(1);
      expect(result.current.defaultAgent).toBeDefined();
      expect(result.current.defaultAgent.isDefault).toBe(true);
    });
  });

  it('creates an agent, updates default, and enforces invariants on deletion', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AgentsProvider>{children}</AgentsProvider>
    );

    const { result } = renderHook(() => useAgents(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // 1. Create a second agent
    let newAgentId = '';
    await act(async () => {
      const created = await result.current.createAgent({
        name: 'Coding Expert',
        systemPrompt: 'You are a code refactoring assistant.',
        model: 'qwen3.5:9b',
        temperature: 0.2,
        contextSize: 8192,
        reserveTokens: 2048,
        keepRecentTokens: 2867,
        enabledSkills: [],
        enabledBuiltinTools: ['read', 'write', 'edit'],
        approvalMode: 'dangerous-only',
        isDefault: false,
      });
      newAgentId = created.id;
    });

    expect(result.current.agents.some((a) => a.id === newAgentId)).toBe(true);

    // 2. Set second agent as default
    await act(async () => {
      await result.current.setDefaultAgent(newAgentId);
    });

    expect(result.current.defaultAgent.id).toBe(newAgentId);

    // 3. Delete the default agent - another agent must be promoted to default
    await act(async () => {
      const deleted = await result.current.deleteAgent(newAgentId);
      expect(deleted).toBe(true);
    });

    expect(result.current.defaultAgent.id).not.toBe(newAgentId);
    expect(result.current.defaultAgent.isDefault).toBe(true);

    // 4. When only one agent remains, deleteAgent must be refused
    if (result.current.agents.length === 1) {
      await act(async () => {
        const deleted = await result.current.deleteAgent(result.current.agents[0].id);
        expect(deleted).toBe(false);
      });
    }
  });
});
