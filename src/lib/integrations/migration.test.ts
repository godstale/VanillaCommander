import { describe, it, expect, beforeEach } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import {
  deleteIntegration,
  listIntegrations,
  saveIntegration,
} from '@/lib/db/repositories/integrationsRepo';
import * as agentsRepo from '@/lib/db/repositories/agentsRepo';
import { migrateLlmApiToAgents } from './migration';
import { CONSENT_TEXT_VERSION } from './types';

const now = new Date().toISOString();

describe('migrateLlmApiToAgents', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
  });

  it('converts llm-api records to cloud agents and removes them', async () => {
    await saveIntegration({
      id: 'ext-1',
      name: 'My Cloud',
      kind: 'llm-api',
      enabled: true,
      llm: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
      allowedPurposes: ['chat-agent'],
      allowedDataClasses: ['personal'],
      consent: {
        version: CONSENT_TEXT_VERSION,
        grantedAt: now,
        purposes: ['chat-agent'],
        dataClasses: ['personal'],
      },
      createdAt: now,
      updatedAt: now,
    });
    await saveIntegration({
      id: 'ext-2',
      name: 'My CLI',
      kind: 'agent-cli',
      enabled: true,
      cli: {
        executablePath: '/usr/bin/agent',
        args: ['run'],
        promptVia: 'stdin',
        outputFormat: 'text',
        timeoutMs: 5000,
      },
      allowedPurposes: ['chat-agent'],
      allowedDataClasses: ['personal'],
      consent: null,
      createdAt: now,
      updatedAt: now,
    });

    const migrated = await migrateLlmApiToAgents();
    expect(migrated).toBe(1);

    const agents = await agentsRepo.listAgents();
    const converted = agents.find((a) => a.name === 'My Cloud');
    expect(converted).toBeDefined();
    expect(converted?.llmProvider).toBe('openai');
    expect(converted?.model).toBe('gpt-4o-mini');
    expect(converted?.isDefault).toBe(false);

    const remaining = await listIntegrations();
    expect(remaining.map((r) => r.id)).toEqual(['ext-2']);

    // 재실행해도 no-op이다.
    expect(await migrateLlmApiToAgents()).toBe(0);
    await deleteIntegration('ext-2');
  });
});
