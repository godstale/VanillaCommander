import { getGlobalDatabase } from '@/lib/db/client';
import {
  ExternalIntegrationSchema,
  IntegrationSettingsSchema,
  type DataClass,
  type ExternalIntegration,
  type IntegrationAuditRow,
  type IntegrationPurpose,
  type IntegrationSettings,
} from '@/lib/eval/types';

const DEFAULT_SETTINGS: IntegrationSettings = {
  masterEnabled: false,
  trustedLanHosts: [],
  allowLocalCodeExecution: false,
};

function safeJsonParse(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export async function listIntegrations(): Promise<ExternalIntegration[]> {
  const db = await getGlobalDatabase();
  const rows = await db.select<{ id: string; integration_json: string }[]>(
    `SELECT * FROM external_integrations`,
  );
  const integrations: ExternalIntegration[] = [];
  for (const row of rows) {
    const parsed = ExternalIntegrationSchema.safeParse(safeJsonParse(row.integration_json));
    if (!parsed.success) {
      console.warn(`[integrationsRepo] skipping corrupt row: ${row.id}`);
      continue;
    }
    integrations.push(parsed.data);
  }
  integrations.sort((a, b) => a.name.localeCompare(b.name));
  return integrations;
}

export async function saveIntegration(integration: ExternalIntegration): Promise<void> {
  const db = await getGlobalDatabase();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO external_integrations (id, integration_json, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET integration_json=excluded.integration_json, updated_at=excluded.updated_at`,
    [integration.id, JSON.stringify(integration), now, now],
  );
}

export async function deleteIntegration(id: string): Promise<void> {
  const db = await getGlobalDatabase();
  await db.execute(`DELETE FROM external_integrations WHERE id = ?`, [id]);
}

export async function getIntegrationSettings(): Promise<IntegrationSettings> {
  const db = await getGlobalDatabase();
  const rows = await db.select<{ settings_json: string }[]>(
    `SELECT * FROM integration_settings WHERE id = 'singleton'`,
  );
  if (rows.length === 0) return { ...DEFAULT_SETTINGS };
  const parsed = IntegrationSettingsSchema.safeParse(safeJsonParse(rows[0].settings_json));
  if (!parsed.success) {
    console.warn('[integrationsRepo] corrupt integration_settings, using defaults');
    return { ...DEFAULT_SETTINGS };
  }
  return parsed.data;
}

export async function saveIntegrationSettings(settings: IntegrationSettings): Promise<void> {
  const db = await getGlobalDatabase();
  await db.execute(
    `INSERT INTO integration_settings (id, settings_json) VALUES ('singleton', ?) ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json`,
    [JSON.stringify(settings)],
  );
}

const AUDIT_STATUSES = ['ok', 'error'] as const;

interface DbAuditRow {
  id: string;
  integration_id: string;
  purpose: string;
  data_classes: string;
  run_id: string | null;
  request_count: number;
  bytes_sent: number;
  status: string;
  error: string | null;
  created_at: string;
}

function mapAuditRow(row: DbAuditRow): IntegrationAuditRow | null {
  if (!AUDIT_STATUSES.includes(row.status as 'ok' | 'error')) {
    console.warn(`[integrationsRepo] skipping corrupt audit row: ${row.id}`);
    return null;
  }
  let dataClasses: DataClass[] = [];
  const parsed = safeJsonParse(row.data_classes);
  if (Array.isArray(parsed)) {
    dataClasses = (parsed as unknown[]).filter(
      (v): v is DataClass =>
        v === 'public-bundled' || v === 'personal' || v === 'fixture-files',
    );
  }
  return {
    id: row.id,
    integrationId: row.integration_id,
    purpose: row.purpose as IntegrationPurpose,
    dataClasses,
    runId: row.run_id,
    requestCount: row.request_count,
    bytesSent: row.bytes_sent,
    status: row.status as 'ok' | 'error',
    error: row.error,
    createdAt: row.created_at,
  };
}

export async function appendAudit(
  entry: Omit<IntegrationAuditRow, 'id' | 'createdAt'>,
): Promise<void> {
  const db = await getGlobalDatabase();
  await db.execute(
    `INSERT INTO integration_audit_log (id, integration_id, purpose, data_classes, run_id, request_count, bytes_sent, status, error, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      crypto.randomUUID(),
      entry.integrationId,
      entry.purpose,
      JSON.stringify(entry.dataClasses),
      entry.runId,
      entry.requestCount,
      entry.bytesSent,
      entry.status,
      entry.error,
      new Date().toISOString(),
    ],
  );
}

export async function listAudit(opts?: {
  limit?: number;
  integrationId?: string;
}): Promise<IntegrationAuditRow[]> {
  const db = await getGlobalDatabase();
  const rows = await db.select<DbAuditRow[]>(
    `SELECT * FROM integration_audit_log ORDER BY created_at DESC`,
  );
  const mapped: IntegrationAuditRow[] = [];
  for (const row of rows) {
    const parsed = mapAuditRow(row);
    if (parsed) mapped.push(parsed);
  }
  const filtered = opts?.integrationId
    ? mapped.filter((r) => r.integrationId === opts.integrationId)
    : mapped;
  return opts?.limit != null ? filtered.slice(0, opts.limit) : filtered;
}

export async function clearAudit(): Promise<void> {
  const db = await getGlobalDatabase();
  await db.execute(`DELETE FROM integration_audit_log`);
}
