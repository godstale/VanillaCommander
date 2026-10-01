import { describe, expect, it, beforeEach } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import type { ExternalIntegration } from '@/lib/eval/types';
import {
  appendAudit,
  clearAudit,
  deleteIntegration,
  getIntegrationSettings,
  listAudit,
  listIntegrations,
  saveIntegration,
  saveIntegrationSettings,
} from './integrationsRepo';

function makeIntegration(overrides: Partial<ExternalIntegration> = {}): ExternalIntegration {
  const now = new Date().toISOString();
  return {
    id: 'int-1',
    name: 'Test API',
    kind: 'llm-api',
    enabled: true,
    llm: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    allowedPurposes: ['judge'],
    allowedDataClasses: ['public-bundled'],
    consent: {
      version: 'consent-v1',
      grantedAt: now,
      purposes: ['judge'],
      dataClasses: ['public-bundled'],
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('integrationsRepo', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
  });

  it('returns default settings when none saved', async () => {
    const settings = await getIntegrationSettings();
    expect(settings.masterEnabled).toBe(false);
    expect(settings.trustedLanHosts).toEqual([]);
    expect(settings.allowLocalCodeExecution).toBe(false);
  });

  it('saves and lists integrations', async () => {
    await saveIntegration(makeIntegration());
    await saveIntegration(makeIntegration({ id: 'int-2', name: 'AAA CLI', kind: 'agent-cli' }));
    const list = await listIntegrations();
    expect(list).toHaveLength(2);
    // sorted by name
    expect(list[0].name).toBe('AAA CLI');
    await deleteIntegration('int-1');
    expect(await listIntegrations()).toHaveLength(1);
  });

  it('round-trips settings', async () => {
    await saveIntegrationSettings({
      masterEnabled: true,
      trustedLanHosts: ['192.168.1.10'],
      allowLocalCodeExecution: true,
    });
    const settings = await getIntegrationSettings();
    expect(settings.masterEnabled).toBe(true);
    expect(settings.trustedLanHosts).toEqual(['192.168.1.10']);
  });

  it('appends and lists audit entries with filter', async () => {
    await appendAudit({
      integrationId: 'int-1',
      purpose: 'judge',
      dataClasses: ['public-bundled'],
      runId: null,
      requestCount: 3,
      bytesSent: 1024,
      status: 'ok',
      error: null,
    });
    await appendAudit({
      integrationId: 'int-2',
      purpose: 'candidate',
      dataClasses: ['personal'],
      runId: 'run-1',
      requestCount: 1,
      bytesSent: 100,
      status: 'error',
      error: 'timeout',
    });
    expect(await listAudit()).toHaveLength(2);
    expect(await listAudit({ integrationId: 'int-1' })).toHaveLength(1);
    expect(await listAudit({ limit: 1 })).toHaveLength(1);
    await clearAudit();
    expect(await listAudit()).toHaveLength(0);
  });
});
