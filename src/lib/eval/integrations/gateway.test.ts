import { describe, expect, it, vi } from 'vitest';
import { CONSENT_TEXT_VERSION } from '../constants';
import type {
  DataClass,
  ExternalIntegration,
  IntegrationPurpose,
  IntegrationSettings,
} from '../types';
import {
  callIntegration,
  checkPermission,
  flushAuditBatches,
  measureRequestBytes,
  type GatewayDeps,
} from './gateway';

function makeIntegration(overrides?: Partial<ExternalIntegration>): ExternalIntegration {
  return {
    id: 'int-1',
    name: 'Test',
    kind: 'llm-api',
    enabled: true,
    llm: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    allowedPurposes: ['judge'],
    allowedDataClasses: ['public-bundled'],
    consent: {
      version: CONSENT_TEXT_VERSION,
      grantedAt: new Date().toISOString(),
      purposes: ['judge'],
      dataClasses: ['public-bundled'],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const SETTINGS_ON: IntegrationSettings = {
  masterEnabled: true,
  trustedLanHosts: [],
  allowLocalCodeExecution: false,
};

describe('checkPermission 5-step denials', () => {
  const base = makeIntegration();
  const purpose: IntegrationPurpose = 'judge';
  const data: DataClass[] = ['public-bundled'];

  it('denies when master switch is off', () => {
    expect(
      checkPermission(base, { ...SETTINGS_ON, masterEnabled: false }, purpose, data),
    ).toEqual({ ok: false, reasonKey: 'eval.integrations.denied.masterOff' });
  });

  it('denies when the integration is disabled', () => {
    expect(
      checkPermission({ ...base, enabled: false }, SETTINGS_ON, purpose, data),
    ).toEqual({ ok: false, reasonKey: 'eval.integrations.denied.disabled' });
  });

  it('denies without consent', () => {
    expect(checkPermission({ ...base, consent: null }, SETTINGS_ON, purpose, data)).toEqual({
      ok: false,
      reasonKey: 'eval.integrations.denied.noConsent',
    });
  });

  it('denies on stale consent version', () => {
    const stale = makeIntegration({
      consent: {
        version: 'consent-v0',
        grantedAt: new Date().toISOString(),
        purposes: ['judge'],
        dataClasses: ['public-bundled'],
      },
    });
    expect(checkPermission(stale, SETTINGS_ON, purpose, data)).toEqual({
      ok: false,
      reasonKey: 'eval.integrations.denied.staleConsent',
    });
  });

  it('denies a disallowed purpose', () => {
    expect(checkPermission(base, SETTINGS_ON, 'candidate', data)).toEqual({
      ok: false,
      reasonKey: 'eval.integrations.denied.purpose',
    });
  });

  it('denies widened data classes', () => {
    expect(checkPermission(base, SETTINGS_ON, purpose, ['public-bundled', 'personal'])).toEqual({
      ok: false,
      reasonKey: 'eval.integrations.denied.dataClass',
    });
  });

  it('allows a fully permitted call', () => {
    expect(checkPermission(base, SETTINGS_ON, purpose, data)).toEqual({ ok: true });
  });
});

describe('measureRequestBytes', () => {
  it('sums UTF-8 bytes of messages', () => {
    const enc = new TextEncoder();
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '가나다' },
    ];
    const expected =
      enc.encode('user\nhello').length + enc.encode('assistant\n가나다').length;
    expect(measureRequestBytes(messages)).toBe(expected);
  });
});

describe('callIntegration', () => {
  function depsWith(integration: ExternalIntegration, extra?: Partial<GatewayDeps>): {
    deps: GatewayDeps;
    audit: ReturnType<typeof vi.fn>;
  } {
    const audit = vi.fn().mockResolvedValue(undefined);
    const deps: GatewayDeps = {
      loadIntegration: async () => integration,
      loadSettings: async () => SETTINGS_ON,
      audit: audit as GatewayDeps['audit'],
      ...extra,
    };
    return { deps, audit };
  }

  it('never fetches/invokes on denial', async () => {
    const integration = makeIntegration({ enabled: false });
    const streamFn = vi.fn();
    const cliRun = vi.fn();
    const { deps, audit } = depsWith(integration, { streamFn, cliRun });
    const res = await callIntegration(
      'int-1',
      { purpose: 'judge', dataClasses: ['public-bundled'], messages: [{ role: 'user', content: 'x' }] },
      undefined,
      deps,
    );
    expect(res.ok).toBe(false);
    expect(streamFn).not.toHaveBeenCalled();
    expect(cliRun).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it('collects llm-api text and audits bytes (no runId → immediate)', async () => {
    const integration = makeIntegration();
    async function* chunks() {
      yield { content: 'hel', done: false };
      yield { content: 'lo', done: true };
    }
    const streamFn = vi.fn().mockReturnValue(chunks());
    const { deps, audit } = depsWith(integration, { streamFn });
    const messages = [{ role: 'user', content: 'héllo' }];
    const res = await callIntegration(
      'int-1',
      { purpose: 'judge', dataClasses: ['public-bundled'], messages },
      undefined,
      deps,
    );
    expect(res).toEqual({ ok: true, text: 'hello' });
    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
    const entry = audit.mock.calls[0][0] as { bytesSent: number; requestCount: number; status: string };
    expect(entry.bytesSent).toBe(measureRequestBytes(messages));
    expect(entry.requestCount).toBe(1);
    expect(entry.status).toBe('ok');
  });

  it('batches runId calls with one debounced audit row', async () => {
    const integration = makeIntegration();
    async function* chunks() {
      yield { content: 'ok', done: true };
    }
    const streamFn = vi.fn().mockImplementation(() => chunks());
    const { deps, audit } = depsWith(integration, { streamFn });
    const req = {
      purpose: 'judge' as IntegrationPurpose,
      dataClasses: ['public-bundled'] as DataClass[],
      runId: 'run-batch-1',
      messages: [{ role: 'user', content: 'ab' }],
    };
    await callIntegration('int-1', req, undefined, deps);
    await callIntegration('int-1', req, undefined, deps);
    expect(audit).not.toHaveBeenCalled();
    await flushAuditBatches(deps.audit);
    expect(audit).toHaveBeenCalledTimes(1);
    const entry = audit.mock.calls[0][0] as { requestCount: number; bytesSent: number };
    expect(entry.requestCount).toBe(2);
    expect(entry.bytesSent).toBe(measureRequestBytes(req.messages) * 2);
  });

  it('runs agent-cli and extracts jsonPath', async () => {
    const integration = makeIntegration({
      kind: 'agent-cli',
      llm: undefined,
      cli: {
        executablePath: '/usr/bin/agent',
        args: ['run'],
        promptVia: 'stdin',
        outputFormat: 'json',
        jsonPath: 'result.text',
        timeoutMs: 5000,
      },
    });
    const cliRun = vi
      .fn()
      .mockResolvedValue({ exitCode: 0, stdout: '{"result":{"text":"done"}}', stderr: '', timedOut: false });
    const { deps } = depsWith(integration, { cliRun });
    const res = await callIntegration(
      'int-1',
      { purpose: 'judge', dataClasses: ['public-bundled'], messages: [{ role: 'user', content: 'q' }] },
      undefined,
      deps,
    );
    expect(res).toEqual({ ok: true, text: 'done' });
    expect(cliRun).toHaveBeenCalledTimes(1);
  });

  it('returns notFound for unknown integration id', async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    const res = await callIntegration(
      'missing',
      { purpose: 'judge', dataClasses: ['public-bundled'], messages: [] },
      undefined,
      {
        loadIntegration: async () => undefined,
        loadSettings: async () => SETTINGS_ON,
        audit: audit as GatewayDeps['audit'],
      },
    );
    expect(res).toEqual({ ok: false, reasonKey: 'eval.integrations.error.notFound' });
  });
});
