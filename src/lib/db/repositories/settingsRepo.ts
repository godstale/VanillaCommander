import {
  getGlobalDatabase,
  getProjectDatabase,
  getActiveWorkspaceRoot,
  type SqlDatabase,
} from '@/lib/db/client';
import { z } from 'zod';
import {
  DEFAULT_IMAGE_SETTINGS,
  ImageSettingsSchema,
  type ImageSettings,
} from '@/lib/types/imageSettings';
import type { AppSettings } from '@/lib/types/chat';
import type { WorkspaceTab } from '@/lib/types/workspaceTab';
import type { ApprovalMode } from '@/lib/types/agent';

// P11-04: 위키·파서 설정 블록. 화면(P11-31/P11-34)과 파이프라인(W3)은 각 작업이 소유하고,
// 저장소 스키마만 여기서 둔다.
const DEFAULT_WIKI_CATEGORIES = [
  '문서/업무',
  '문서/학습',
  '문서/계약-법률',
  '재무/영수증-청구서',
  '재무/보고서',
  '이미지/사진',
  '이미지/스크린샷',
  '기타',
];

/** 감시 폴더 1건. `recursive`는 이 폴더의 하위 폴더까지 감시·스캔할지다. */
export const WikiWatchFolderSchema = z.object({
  path: z.string(),
  recursive: z.boolean().default(false),
});
export type WikiWatchFolder = z.infer<typeof WikiWatchFolderSchema>;

/** 저장된 구값 호환: 문자열은 `{ path, recursive: false }`로 읽는다. */
const WikiWatchFolderInputSchema = z.union([z.string(), WikiWatchFolderSchema]);

/** 구 설정값 호환: 카테고리에 남은 '·'는 '-'로 읽는다. */
export function normalizeWikiCategories(list: string[]): string[] {
  return list.map((s) => s.replace(/·/g, '-'));
}

export const WikiSettingsSchema = z.object({
  watchEnabled: z.boolean().default(false),
  watchFolders: z
    .array(WikiWatchFolderInputSchema)
    .default([])
    .transform((arr) =>
      arr.map((f) => (typeof f === 'string' ? { path: f, recursive: false } : f)),
    ),
  /**
   * @deprecated 전역 하위 폴더 감시. 폴더별 `watchFolders[].recursive`로 이관했으며
   * 구 저장값의 마이그레이션 폴백으로만 유지한다. 새 코드는 참조하지 않는다.
   */
  recursive: z.boolean().default(false),
  /** 주기 스캔 간격(분). 0이면 주기 스캔 끔(시작 시 1회는 수행). */
  scanIntervalMin: z.number().min(0).default(10),
  moveAfterIngest: z.boolean().default(true),
  /** ''이면 <WorkFolder>/wiki-inbox. */
  inboxDir: z.string().default(''),
  /** 분류 카테고리 체계: `A/B` 경로 목록(최대 깊이 3). 보관 폴더 하위 폴더가 된다. */
  categories: z.array(z.string()).default(DEFAULT_WIKI_CATEGORIES),
  /** LLM이 기존 부모 아래에 새 카테고리를 만들 수 있게 할지. */
  allowNewCategories: z.boolean().default(false),
  allowedExtensions: z.array(z.string()).default([
    'pdf', 'docx', 'xlsx', 'xls', 'csv', 'md', 'txt', 'png', 'jpg', 'jpeg',
  ]),
  maxFileMb: z.number().default(20),
  excludeGlobs: z.array(z.string()).default([]),
  /** ''이면 내장 기본 프롬프트. */
  prompt: z.string().default(''),
  /** null이면 기본 에이전트. */
  agentId: z.string().nullable().default(null),
});
export type WikiSettings = z.infer<typeof WikiSettingsSchema>;

export const ParserSettingsSchema = z.object({
  overrides: z.record(
    z.string(),
    z.object({
      command: z.string(),
      outputMode: z.enum(['stdout', 'file']).default('stdout'),
    }),
  ).default({}),
});
export type ParserSettings = z.infer<typeof ParserSettingsSchema>;

export const DEFAULT_WIKI_SETTINGS: WikiSettings = WikiSettingsSchema.parse({});
export const DEFAULT_PARSER_SETTINGS: ParserSettings = ParserSettingsSchema.parse({});

function safeJsonParse(raw: string | null | undefined): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** 손상된 저장값은 기본값으로 복원한다 (테스트용 export). */
export function parseWikiSettings(raw: unknown): WikiSettings {
  const rawObj = typeof raw === 'string' ? safeJsonParse(raw) : raw;
  const parsed = WikiSettingsSchema.safeParse(rawObj);
  if (!parsed.success) return { ...DEFAULT_WIKI_SETTINGS };
  const data = { ...parsed.data, categories: normalizeWikiCategories(parsed.data.categories) };
  // 구 저장값: watchFolders가 문자열 배열 + 전역 recursive → 폴더별로 승격한다.
  // 스키마 transform은 문자열을 recursive:false로 바꾸므로, 전역값이 true였던
  // 폴더(문자열 항목·recursive 키가 없던 객체 항목)는 여기서 true로 되돌린다.
  if (rawObj && typeof rawObj === 'object' && (rawObj as { recursive?: unknown }).recursive === true) {
    const origFolders = (rawObj as { watchFolders?: unknown }).watchFolders;
    if (Array.isArray(origFolders)) {
      data.watchFolders = data.watchFolders.map((f, i) => {
        const orig = origFolders[i] as unknown;
        if (typeof orig === 'string') return { ...f, recursive: true };
        if (orig && typeof orig === 'object' && !('recursive' in (orig as Record<string, unknown>))) {
          return { ...f, recursive: true };
        }
        return f;
      });
    }
  }
  return data;
}

/** 손상된 저장값은 기본값으로 복원한다 (테스트용 export). */
export function parseParserSettings(raw: unknown): ParserSettings {
  const parsed = ParserSettingsSchema.safeParse(
    typeof raw === 'string' ? safeJsonParse(raw) : raw,
  );
  return parsed.success ? parsed.data : { ...DEFAULT_PARSER_SETTINGS };
}

/** 손상된 저장값은 기본값으로 복원한다 (테스트용 export). */
export function parseImageSettings(raw: unknown): ImageSettings {
  const parsed = ImageSettingsSchema.safeParse(
    typeof raw === 'string' ? safeJsonParse(raw) : raw,
  );
  return parsed.success ? parsed.data : { ...DEFAULT_IMAGE_SETTINGS };
}

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
  llm_queue_timeout_min?: number | null;
  setup_completed_at?: string | null;
  work_folder?: string | null;
  favorites?: string | null;
  agent_allowed_roots?: string | null;
  wiki_settings?: string | null;
  parser_settings?: string | null;
  image_settings?: string | null;
}

export { DEFAULT_IMAGE_SETTINGS, ImageSettingsSchema, type ImageSettings };

export const DEFAULT_MONITORING_INTERVAL_MS = 1000;
export const DEFAULT_LLM_QUEUE_TIMEOUT_MIN = 10;

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
  llmQueueTimeoutMin: DEFAULT_LLM_QUEUE_TIMEOUT_MIN,
  setupCompletedAt: null,
  workFolder: null,
  favorites: [],
  agentAllowedRoots: [],
  wiki: DEFAULT_WIKI_SETTINGS,
  parsers: DEFAULT_PARSER_SETTINGS,
  image: DEFAULT_IMAGE_SETTINGS,
};

function parseStringArray(raw: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

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
    llmQueueTimeoutMin:
      typeof row.llm_queue_timeout_min === 'number' && row.llm_queue_timeout_min > 0
        ? row.llm_queue_timeout_min
        : DEFAULT_LLM_QUEUE_TIMEOUT_MIN,
    setupCompletedAt: row.setup_completed_at ?? null,
    workFolder: row.work_folder ?? null,
    favorites: parseStringArray(row.favorites),
    agentAllowedRoots: parseStringArray(row.agent_allowed_roots),
    wiki: parseWikiSettings(row.wiki_settings),
    parsers: parseParserSettings(row.parser_settings),
    image: parseImageSettings(row.image_settings),
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

async function ensureAppV11Columns(db: SqlDatabase): Promise<void> {
  const alters = [
    'ALTER TABLE app_settings ADD COLUMN setup_completed_at TEXT',
    'ALTER TABLE app_settings ADD COLUMN work_folder TEXT',
    "ALTER TABLE app_settings ADD COLUMN favorites TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE app_settings ADD COLUMN agent_allowed_roots TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE app_settings ADD COLUMN wiki_settings TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE app_settings ADD COLUMN parser_settings TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE app_settings ADD COLUMN image_settings TEXT NOT NULL DEFAULT '{}'",
    'ALTER TABLE app_settings ADD COLUMN llm_queue_timeout_min INTEGER NOT NULL DEFAULT 10',
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
  await ensureAppV11Columns(db);
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
      trusted_workspaces, last_workspace_root, monitoring_interval_ms,
      setup_completed_at, work_folder, favorites,
      agent_allowed_roots, wiki_settings, parser_settings, image_settings,
      llm_queue_timeout_min
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      DEFAULT_APP_SETTINGS.setupCompletedAt,
      DEFAULT_APP_SETTINGS.workFolder,
      JSON.stringify(DEFAULT_APP_SETTINGS.favorites),
      JSON.stringify(DEFAULT_APP_SETTINGS.agentAllowedRoots),
      JSON.stringify(DEFAULT_APP_SETTINGS.wiki),
      JSON.stringify(DEFAULT_APP_SETTINGS.parsers),
      JSON.stringify(DEFAULT_APP_SETTINGS.image),
      DEFAULT_APP_SETTINGS.llmQueueTimeoutMin,
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
    setup_completed_at: DEFAULT_APP_SETTINGS.setupCompletedAt,
    work_folder: DEFAULT_APP_SETTINGS.workFolder,
    favorites: JSON.stringify(DEFAULT_APP_SETTINGS.favorites),
    agent_allowed_roots: JSON.stringify(DEFAULT_APP_SETTINGS.agentAllowedRoots),
    wiki_settings: JSON.stringify(DEFAULT_APP_SETTINGS.wiki),
    parser_settings: JSON.stringify(DEFAULT_APP_SETTINGS.parsers),
    image_settings: JSON.stringify(DEFAULT_APP_SETTINGS.image),
    llm_queue_timeout_min: DEFAULT_APP_SETTINGS.llmQueueTimeoutMin,
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
    await ensureAppV11Columns(dbOverride);
    await dbOverride.execute(
      `UPDATE app_settings SET
        open_tabs = ?, active_tab_id = ?, theme = ?, language = ?,
        ollama_base_url = ?, default_context_size = ?, default_temperature = ?,
        default_reserve_tokens = ?, default_keep_recent_tokens = ?,
        default_approval_mode = ?,
        trusted_workspaces = ?, last_workspace_root = ?, monitoring_interval_ms = ?,
        setup_completed_at = ?, work_folder = ?, favorites = ?,
        agent_allowed_roots = ?, wiki_settings = ?, parser_settings = ?, image_settings = ?,
        llm_queue_timeout_min = ?
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
        merged.setupCompletedAt,
        merged.workFolder,
        JSON.stringify(merged.favorites),
        JSON.stringify(merged.agentAllowedRoots),
        JSON.stringify(merged.wiki),
        JSON.stringify(merged.parsers),
        JSON.stringify(merged.image),
        merged.llmQueueTimeoutMin,
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
      trusted_workspaces = ?, last_workspace_root = ?, monitoring_interval_ms = ?,
      setup_completed_at = ?, work_folder = ?, favorites = ?,
      agent_allowed_roots = ?, wiki_settings = ?, parser_settings = ?, image_settings = ?,
        llm_queue_timeout_min = ?
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
      merged.setupCompletedAt,
      merged.workFolder,
      JSON.stringify(merged.favorites),
      JSON.stringify(merged.agentAllowedRoots),
      JSON.stringify(merged.wiki),
      JSON.stringify(merged.parsers),
      JSON.stringify(merged.image),
      merged.llmQueueTimeoutMin,
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
