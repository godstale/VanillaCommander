import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isModelMatching, checkAgentConnection, checkAllAgentsConnection } from './agentStatus';
import * as ollamaClient from './ollamaClient';
import type { Agent } from '@/lib/types/agent';

describe('agentStatus', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('isModelMatching', () => {
    it('matches identical model names', () => {
      expect(isModelMatching('qwen2.5:7b', 'qwen2.5:7b')).toBe(true);
    });

    it('matches with and without :latest tag', () => {
      expect(isModelMatching('llama3:latest', 'llama3')).toBe(true);
      expect(isModelMatching('llama3', 'llama3:latest')).toBe(true);
    });

    it('handles case-insensitivity', () => {
      expect(isModelMatching('Qwen2.5:7B', 'qwen2.5:7b')).toBe(true);
    });

    it('returns false for mismatched models', () => {
      expect(isModelMatching('llama3', 'llama2')).toBe(false);
      expect(isModelMatching('', 'llama3')).toBe(false);
    });
  });

  const mockAgent: Agent = {
    id: 'agent-1',
    name: 'Test Agent',
    systemPrompt: 'prompt',
    model: 'qwen2.5:7b',
    temperature: 0.7,
    contextSize: 4096,
    reserveTokens: 1000,
    keepRecentTokens: 500,
    enabledSkills: [],
    enabledBuiltinTools: ['read'],
    approvalMode: 'dangerous-only',
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  describe('checkAgentConnection', () => {
    it('returns connected when model is in listModels', async () => {
      vi.spyOn(ollamaClient, 'listModels').mockResolvedValue([
        { name: 'qwen2.5:7b', size: 1000, digest: 'abc', modified_at: '' },
      ]);

      const status = await checkAgentConnection(mockAgent);
      expect(status).toBe('connected');
    });

    it('falls back to showModel if not in listModels', async () => {
      vi.spyOn(ollamaClient, 'listModels').mockResolvedValue([]);
      vi.spyOn(ollamaClient, 'showModel').mockResolvedValue({
        contextLength: 4096,
        supportsTools: true,
      });

      const status = await checkAgentConnection(mockAgent);
      expect(status).toBe('connected');
    });

    it('returns disconnected when listModels and showModel fail', async () => {
      vi.spyOn(ollamaClient, 'listModels').mockRejectedValue(new Error('Network error'));
      vi.spyOn(ollamaClient, 'showModel').mockRejectedValue(new Error('Network error'));

      const status = await checkAgentConnection(mockAgent);
      expect(status).toBe('disconnected');
    });
  });

  describe('checkAllAgentsConnection', () => {
    it('checks all agents correctly against listModels', async () => {
      vi.spyOn(ollamaClient, 'listModels').mockResolvedValue([
        { name: 'qwen2.5:7b', size: 1000, digest: 'abc', modified_at: '' },
      ]);

      const agent2: Agent = { ...mockAgent, id: 'agent-2', model: 'missing-model' };
      vi.spyOn(ollamaClient, 'showModel').mockRejectedValue(new Error('Not found'));

      const statuses = await checkAllAgentsConnection([mockAgent, agent2]);
      expect(statuses['agent-1']).toBe('connected');
      expect(statuses['agent-2']).toBe('disconnected');
    });

    it('marks all as disconnected if listModels throws connection error', async () => {
      vi.spyOn(ollamaClient, 'listModels').mockRejectedValue(new Error('Ollama offline'));

      const statuses = await checkAllAgentsConnection([mockAgent]);
      expect(statuses['agent-1']).toBe('disconnected');
    });
  });
});
