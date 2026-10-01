import {
  getGlobalDatabase,
  getProjectDatabase,
  getActiveWorkspaceRoot,
  type SqlDatabase,
} from '@/lib/db/client';
import type { AppSettings } from '@/lib/types/chat';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import type { ApprovalMode } from '@/lib/types/agent';

interface SettingsRow {
  id: string;
  open_tabs: string;
  active_tab_id: string | null;
  theme: 'dark' | 'light' | 'system';
  language: string;
  ollama_base_url: string;
  default_context_size: number;
  default_temperature?: number | null;
  default_reserve_tokens?: number | null;
  default_keep_recent_tokens?: number | null;
  default_approval_mode: ApprovalMode;
  trusted_workspaces: string;
  last_workspace_root: string | null;
  monitoring_interval_ms?: number | null;
}

export const DEFAULT_MONITORING_INTERVAL_MS = 1000;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  id: 'singleton',
  openTabs: [],
  activeTabId: null,
  theme: 'light',
  language: 'ko',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  defaultContextSize: 8192,
  defaultTemperature: 0.2,
  defaultReserveTokens: 0,
  defaultKeepRecentTokens: 0,
  defaultApprovalMode: 'dangerous-only',
  trustedWorkspaces: [],
  lastWorkspaceRoot: null,
  monitoringIntervalMs: DEFAULT_MONITORING_INTERVAL_MS,
};

function parseSettingsRow(row: SettingsRow): AppSettings {
  return {
    id: row.id,
    openTabs: JSON.parse(row.open_tabs || '[]') as WorkspaceTab[],
    activeTabId: row.active_tab_id,
    theme: row.theme,
    language: row.language,
    ollamaBaseUrl: row.ollama_base_url,
    defaultContextSize: row.default_context_size,
    defaultTemperature:
      typeof row.default_temperature === 'number' && row.default_temperature >= 0
        ? row.default_temperature
        : DEFAULT_APP_SETTINGS.defaultTemperature,
    defaultReserveTokens:
      typeof row.default_reserve_tokens === 'number' && row.default_reserve_tokens >= 0
        ? row.default_reserve_tokens
        : 0,
    defaultKeepRecentTokens:
      typeof row.default_keep_recent_tokens === 'number' && row.default_keep_recent_tokens >= 0
        ? row.default_keep_recent_tokens
        : 0,
    defaultApprovalMode: row.default_approval_mode,
    trustedWorkspaces: JSON.parse(row.trusted_workspaces || '[]') as string[],
    lastWorkspaceRoot: row.last_workspace_root,
    monitoringIntervalMs:
      typeof row.monitoring_interval_ms === 'number' && row.monitoring_interval_ms > 0
        ? row.monitoring_interval_ms
        : DEFAULT_MONITORING_INTERVAL_MS,
  };
}

async function ensureMonitoringIntervalColumn(db: SqlDatabase): Promise<void> {
  try {
    await db.execute(
      'ALTER TABLE app_settings ADD COLUMN monitoring_interval_ms INTEGER NOT NULL DEFAULT 1000',
    );
  } catch {
    // Column already exists on fresh DBs; safe to ignore.
  }
}

async function ensureModelDefaultColumns(db: SqlDatabase): Promise<void> {
  const alters = [
    'ALTER TABLE app_settings ADD COLUMN default_temperature REAL NOT NULL DEFAULT 0.2',
    'ALTER TABLE app_settings ADD COLUMN default_reserve_tokens INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE app_settings ADD COLUMN default_keep_recent_tokens INTEGER NOT NULL DEFAULT 0',
  ];
  for (const alter of alters) {
    try {
      await db.execute(alter);
    } catch {
      // Column already exists on fresh DBs; safe to ignore.
    }
  }
}

async function fetchOrInitRow(db: SqlDatabase): Promise<SettingsRow> {
  await ensureMonitoringIntervalColumn(db);
  await ensureModelDefaultColumns(db);
  const rows = await db.select<SettingsRow[]>(
    "SELECT * FROM app_settings WHERE id = 'singleton'",
  );
  if (rows.length > 0) {
    return rows[0];
  }

  await db.execute(
    `INSERT INTO app_settings (
      id, open_tabs, active_tab_id, theme, language,
      ollama_base_url, default_context_size, default_temperature,
      default_reserve_tokens, default_keep_recent_tokens,
      default_approval_mode,
      trusted_workspaces, last_workspace_root, monitoring_interval_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      DEFAULT_APP_SETTINGS.id,
      JSON.stringify(DEFAULT_APP_SETTINGS.openTabs),
      DEFAULT_APP_SETTINGS.activeTabId,
      DEFAULT_APP_SETTINGS.theme,
      DEFAULT_APP_SETTINGS.language,
      DEFAULT_APP_SETTINGS.ollamaBaseUrl,
      DEFAULT_APP_SETTINGS.defaultContextSize,
      DEFAULT_APP_SETTINGS.defaultTemperature,
      DEFAULT_APP_SETTINGS.defaultReserveTokens,
      DEFAULT_APP_SETTINGS.defaultKeepRecentTokens,
      DEFAULT_APP_SETTINGS.defaultApprovalMode,
      JSON.stringify(DEFAULT_APP_SETTINGS.trustedWorkspaces),
      DEFAULT_APP_SETTINGS.lastWorkspaceRoot,
      DEFAULT_APP_SETTINGS.monitoringIntervalMs,
    ],
  );

  return {
    id: DEFAULT_APP_SETTINGS.id,
    open_tabs: JSON.stringify(DEFAULT_APP_SETTINGS.openTabs),
    active_tab_id: DEFAULT_APP_SETTINGS.activeTabId,
    theme: DEFAULT_APP_SETTINGS.theme,
    language: DEFAULT_APP_SETTINGS.language,
    ollama_base_url: DEFAULT_APP_SETTINGS.ollamaBaseUrl,
    default_context_size: DEFAULT_APP_SETTINGS.defaultContextSize,
    default_temperature: DEFAULT_APP_SETTINGS.defaultTemperature,
    default_reserve_tokens: DEFAULT_APP_SETTINGS.defaultReserveTokens,
    default_keep_recent_tokens: DEFAULT_APP_SETTINGS.defaultKeepRecentTokens,
    default_approval_mode: DEFAULT_APP_SETTINGS.defaultApprovalMode,
    trusted_workspaces: JSON.stringify(DEFAULT_APP_SETTINGS.trustedWorkspaces),
    last_workspace_root: DEFAULT_APP_SETTINGS.lastWorkspaceRoot,
    monitoring_interval_ms: DEFAULT_APP_SETTINGS.monitoringIntervalMs,
  };
}

export async function getSettings(
  dbOverride?: SqlDatabase,
): Promise<AppSettings> {
  if (dbOverride) {
    const row = await fetchOrInitRow(dbOverride);
    return parseSettingsRow(row);
  }

  const globalDb = await getGlobalDatabase();
  const globalRow = await fetchOrInitRow(globalDb);
  const globalSettings = parseSettingsRow(globalRow);

  const activeWs = getActiveWorkspaceRoot();
  if (activeWs) {
    try {
      const projectDb = await getProjectDatabase(activeWs);
      const projectRow = await fetchOrInitRow(projectDb);
      const projectSettings = parseSettingsRow(projectRow);
      return {
        ...globalSettings,
        openTabs: projectSettings.openTabs,
        activeTabId: projectSettings.activeTabId,
      };
    } catch (err) {
      console.warn('Failed to load project-specific settings, fallback to global:', err);
    }
  }

  return globalSettings;
}

export async function updateSettings(  updates: Partial<Omit<AppSettings, 'id'>>,
  dbOverride?: SqlDatabase,
): Promise<AppSettings> {
  if (dbOverride) {
    const current = await getSettings(dbOverride);
    const merged: AppSettings = { ...current, ...updates };
    await ensureMonitoringIntervalColumn(dbOverride);
    await ensureModelDefaultColumns(dbOverride);
    await dbOverride.execute(
      `UPDATE app_settings SET
        open_tabs = ?, active_tab_id = ?, theme = ?, language = ?,
        ollama_base_url = ?, default_context_size = ?, default_temperature = ?,
        default_reserve_tokens = ?, default_keep_recent_tokens = ?,
        default_approval_mode = ?,
        trusted_workspaces = ?, last_workspace_root = ?, monitoring_interval_ms = ?
      WHERE id = 'singleton'`,
      [
        JSON.stringify(merged.openTabs),
        merged.activeTabId,
        merged.theme,
        merged.language,
        merged.ollamaBaseUrl,
        merged.defaultContextSize,
        merged.defaultTemperature,
        merged.defaultReserveTokens,
        merged.defaultKeepRecentTokens,
        merged.defaultApprovalMode,
        JSON.stringify(merged.trustedWorkspaces),
        merged.lastWorkspaceRoot,
        merged.monitoringIntervalMs,
      ],
    );
    return merged;
  }

  const current = await getSettings();
  const merged: AppSettings = { ...current, ...updates };

  // 1. Update project DB if active workspace exists and tabs/project settings are modified
  const activeWs = getActiveWorkspaceRoot();
  if (activeWs && (updates.openTabs !== undefined || updates.activeTabId !== undefined)) {
    try {
      const projectDb = await getProjectDatabase(activeWs);
      await fetchOrInitRow(projectDb);
      await projectDb.execute(
        `UPDATE app_settings SET open_tabs = ?, active_tab_id = ? WHERE id = 'singleton'`,
        [JSON.stringify(merged.openTabs), merged.activeTabId],
      );
    } catch (err) {
      console.warn('Failed to update project settings in project DB:', err);
    }
  }

  // 2. Update global DB for global settings (or all settings if no active workspace)
  const globalDb = await getGlobalDatabase();
  await fetchOrInitRow(globalDb);
  await globalDb.execute(
    `UPDATE app_settings SET
      open_tabs = ?, active_tab_id = ?, theme = ?, language = ?,
      ollama_base_url = ?, default_context_size = ?, default_temperature = ?,
      default_reserve_tokens = ?, default_keep_recent_tokens = ?,
      default_approval_mode = ?,
      trusted_workspaces = ?, last_workspace_root = ?, monitoring_interval_ms = ?
    WHERE id = 'singleton'`,
    [
      JSON.stringify(activeWs ? [] : merged.openTabs),
      activeWs ? null : merged.activeTabId,
      merged.theme,
      merged.language,
      merged.ollamaBaseUrl,
      merged.defaultContextSize,
      merged.defaultTemperature,
      merged.defaultReserveTokens,
      merged.defaultKeepRecentTokens,
      merged.defaultApprovalMode,
      JSON.stringify(merged.trustedWorkspaces),
      merged.lastWorkspaceRoot,
      merged.monitoringIntervalMs,
    ],
  );

  return merged;
}

/**
 * 지정된 프로젝트 DB에 탭 상태를 직접 저장한다.
 * 폴더 전환 시 이전 프로젝트의 탭이 디바운스 저장 전에 유실되는 것을 방지하기 위해
 * WorkspaceTabsContext가 전환 직전에 호출한다. 전역 activeWorkspaceRoot와 무관하게
 * 명시적 root의 프로젝트 DB에만 기록하므로 전환 타이밍에 안전하다.
 */
export async function saveProjectTabs(
  workspaceRoot: string,
  openTabs: WorkspaceTab[],
  activeTabId: string | null,
): Promise<void> {
  const projectDb = await getProjectDatabase(workspaceRoot);
  await fetchOrInitRow(projectDb);
  await projectDb.execute(
    `UPDATE app_settings SET open_tabs = ?, active_tab_id = ? WHERE id = 'singleton'`,
    [JSON.stringify(openTabs), activeTabId],
  );
}
