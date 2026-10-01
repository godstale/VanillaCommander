import { getDatabase } from '@/lib/db/client';
import type {
  AgentMonitoringSnapshot,
  ConversationTokenSummary,
  MonitoringSummary,
  TokenStatusBreakdown,
} from '@/lib/types/monitoring';
import { emptyStatusTokens } from '@/lib/types/monitoring';

export const DEFAULT_MAX_SNAPSHOTS_PER_AGENT = 1000;
export const DEFAULT_MAX_SNAPSHOT_AGE_HOURS = 48;
const PRUNE_FREQUENCY = 50;
let saveCounter = 0;

export async function saveMonitoringSnapshot(
  snapshot: AgentMonitoringSnapshot,
  workspaceRoot?: string | null,
): Promise<void> {
  const db = await getDatabase(workspaceRoot);
  const detailsJson = snapshot.details ? JSON.stringify(snapshot.details) : null;

  await db.execute(
    `INSERT INTO agent_monitoring_snapshots (
      id, agent_id, timestamp, gpu_name, gpu_vram_total_mb, gpu_vram_used_mb,
      gpu_vram_free_mb, gpu_utilization_pct, gpu_temperature_c,
      system_memory_total_mb, system_memory_free_mb,
      llm_model, llm_architecture, llm_parameter_size, context_size,
      context_limit, model_weight_bytes, vram_allocated_bytes, kv_cache_bytes,
      gpu_offload_pct, agent_status, current_task,
      prefill_tokens, prefill_duration_ms, prefill_speed,
      decoding_tokens, decoding_duration_ms, decoding_speed, total_duration_ms,
      thinking_tokens, conversation_id, conversation_seq,
      details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshot.id,
      snapshot.agentId,
      snapshot.timestamp,
      snapshot.gpuName,
      snapshot.gpuVramTotalMb,
      snapshot.gpuVramUsedMb,
      snapshot.gpuVramFreeMb,
      snapshot.gpuUtilizationPct,
      snapshot.gpuTemperatureC,
      snapshot.systemMemoryTotalMb,
      snapshot.systemMemoryFreeMb,
      snapshot.llmModel,
      snapshot.llmArchitecture,
      snapshot.llmParameterSize,
      snapshot.contextSize,
      snapshot.contextLimit,
      snapshot.modelWeightBytes,
      snapshot.vramAllocatedBytes,
      snapshot.kvCacheBytes,
      snapshot.gpuOffloadPct,
      snapshot.agentStatus,
      snapshot.currentTask,
      snapshot.prefillTokens ?? null,
      snapshot.prefillDurationMs ?? null,
      snapshot.prefillSpeed ?? null,
      snapshot.decodingTokens ?? null,
      snapshot.decodingDurationMs ?? null,
      snapshot.decodingSpeed ?? null,
      snapshot.totalDurationMs ?? null,
      snapshot.thinkingTokens ?? null,
      snapshot.conversationId ?? null,
      snapshot.conversationSeq ?? null,
      detailsJson,
      snapshot.createdAt,
    ],
  );

  // Periodic automatic pruning to prevent unlimited DB bloat
  saveCounter++;
  if (saveCounter % PRUNE_FREQUENCY === 0) {
    void pruneOldMonitoringSnapshots(snapshot.agentId, {}, workspaceRoot).catch((err) => {
      console.warn('Auto-pruning monitoring snapshots failed:', err);
    });
  }
}

interface DbSnapshotRow {
  id: string;
  agent_id: string;
  timestamp: string;
  gpu_name: string | null;
  gpu_vram_total_mb: number | null;
  gpu_vram_used_mb: number | null;
  gpu_vram_free_mb: number | null;
  gpu_utilization_pct: number | null;
  gpu_temperature_c: number | null;
  system_memory_total_mb: number | null;
  system_memory_free_mb: number | null;
  llm_model: string | null;
  llm_architecture: string | null;
  llm_parameter_size: string | null;
  context_size: number | null;
  context_limit: number | null;
  model_weight_bytes: number | null;
  vram_allocated_bytes: number | null;
  kv_cache_bytes: number | null;
  gpu_offload_pct: number | null;
  agent_status: string | null;
  current_task: string | null;
  prefill_tokens: number | null;
  prefill_duration_ms: number | null;
  prefill_speed: number | null;
  decoding_tokens: number | null;
  decoding_duration_ms: number | null;
  decoding_speed: number | null;
  total_duration_ms: number | null;
  thinking_tokens: number | null;
  conversation_id: string | null;
  conversation_seq: number | null;
  details: string | null;
  created_at: string;
}

function mapRowToSnapshot(row: DbSnapshotRow): AgentMonitoringSnapshot {
  let parsedDetails: Record<string, unknown> | undefined = undefined;
  if (row.details) {
    try {
      parsedDetails = JSON.parse(row.details) as Record<string, unknown>;
    } catch {
      // ignore
    }
  }

  return {
    id: row.id,
    agentId: row.agent_id,
    timestamp: row.timestamp,
    gpuName: row.gpu_name ?? 'N/A',
    gpuVramTotalMb: row.gpu_vram_total_mb ?? 0,
    gpuVramUsedMb: row.gpu_vram_used_mb ?? 0,
    gpuVramFreeMb: row.gpu_vram_free_mb ?? 0,
    gpuUtilizationPct: row.gpu_utilization_pct ?? 0,
    gpuTemperatureC: row.gpu_temperature_c ?? 0,
    systemMemoryTotalMb: row.system_memory_total_mb ?? 0,
    systemMemoryFreeMb: row.system_memory_free_mb ?? 0,
    llmModel: row.llm_model ?? '',
    llmArchitecture: row.llm_architecture ?? '',
    llmParameterSize: row.llm_parameter_size ?? '',
    contextSize: row.context_size ?? 0,
    contextLimit: row.context_limit ?? 0,
    modelWeightBytes: row.model_weight_bytes ?? 0,
    vramAllocatedBytes: row.vram_allocated_bytes ?? 0,
    kvCacheBytes: row.kv_cache_bytes ?? 0,
    gpuOffloadPct: row.gpu_offload_pct ?? 0,
    agentStatus: (row.agent_status as AgentMonitoringSnapshot['agentStatus']) ?? 'unknown',
    currentTask: row.current_task ?? '',
    prefillTokens: row.prefill_tokens ?? undefined,
    prefillDurationMs: row.prefill_duration_ms ?? undefined,
    prefillSpeed: row.prefill_speed ?? undefined,
    decodingTokens: row.decoding_tokens ?? undefined,
    decodingDurationMs: row.decoding_duration_ms ?? undefined,
    decodingSpeed: row.decoding_speed ?? undefined,
    totalDurationMs: row.total_duration_ms ?? undefined,
    thinkingTokens: row.thinking_tokens ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    conversationSeq: row.conversation_seq ?? undefined,
    details: parsedDetails,
    createdAt: row.created_at,
  };
}

export async function getMonitoringSnapshots(
  agentId: string,
  limit = 200,
  workspaceRoot?: string | null,
): Promise<AgentMonitoringSnapshot[]> {
  const db = await getDatabase(workspaceRoot);
  const rows = await db.select<DbSnapshotRow[]>(
    'SELECT * FROM agent_monitoring_snapshots WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?',
    [agentId, limit],
  );
  return rows.map(mapRowToSnapshot);
}

export async function getRecentMonitoringSnapshots(
  agentId: string,
  durationMinutes = 30,
  workspaceRoot?: string | null,
): Promise<AgentMonitoringSnapshot[]> {
  const db = await getDatabase(workspaceRoot);
  const since = new Date(Date.now() - durationMinutes * 60 * 1000).toISOString();
  const rows = await db.select<DbSnapshotRow[]>(
    'SELECT * FROM agent_monitoring_snapshots WHERE agent_id = ? AND timestamp >= ? ORDER BY timestamp ASC',
    [agentId, since],
  );
  return rows.map(mapRowToSnapshot);
}

export async function clearMonitoringSnapshots(
  agentId: string,
  workspaceRoot?: string | null,
): Promise<void> {
  const db = await getDatabase(workspaceRoot);
  await db.execute(
    'DELETE FROM agent_monitoring_snapshots WHERE agent_id = ?',
    [agentId],
  );
}

export async function listRecentMonitoringSnapshots(
  limit = 200,
  workspaceRoot?: string | null,
): Promise<AgentMonitoringSnapshot[]> {
  const db = await getDatabase(workspaceRoot);
  const rows = await db.select<DbSnapshotRow[]>(
    'SELECT * FROM agent_monitoring_snapshots ORDER BY timestamp DESC LIMIT ?',
    [limit],
  );
  return rows.map(mapRowToSnapshot).slice(0, limit);
}

export async function deleteMonitoringSnapshot(
  id: string,
  workspaceRoot?: string | null,
): Promise<void> {
  const db = await getDatabase(workspaceRoot);
  await db.execute('DELETE FROM agent_monitoring_snapshots WHERE id = ?', [id]);
}

export interface MonitoringAgentStats {
  agentId: string;
  count: number;
  latestTimestamp: string;
}

interface DbAgentStatsRow {
  agent_id: string;
  count: number;
  latest_timestamp: string;
}

/**
 * 에이전트별 모니터링 기록 보유 현황 (전체 기간 집계).
 * 기록 패널의 에이전트 단위 목록(등록/삭제) 구성에 사용한다.
 */
export async function getMonitoringAgentStats(
  workspaceRoot?: string | null,
): Promise<MonitoringAgentStats[]> {
  const db = await getDatabase(workspaceRoot);
  const rows = await db.select<DbAgentStatsRow[]>(
    'SELECT agent_id, COUNT(*) as count, MAX(timestamp) as latest_timestamp FROM agent_monitoring_snapshots GROUP BY agent_id ORDER BY latest_timestamp DESC',
  );
  return rows.map((row) => ({
    agentId: row.agent_id,
    count: row.count,
    latestTimestamp: row.latest_timestamp,
  }));
}

export async function clearAllMonitoringSnapshots(
  workspaceRoot?: string | null,
): Promise<void> {
  const db = await getDatabase(workspaceRoot);
  await db.execute('DELETE FROM agent_monitoring_snapshots');
}

export async function clearAllConversationSummaries(
  workspaceRoot?: string | null,
): Promise<void> {
  const db = await getDatabase(workspaceRoot);
  await db.execute('DELETE FROM conversation_token_summaries');
}

export async function pruneOldMonitoringSnapshots(
  agentId?: string,
  options: { maxKeep?: number; maxAgeHours?: number } = {},
  workspaceRoot?: string | null,
): Promise<number> {
  const db = await getDatabase(workspaceRoot);
  const maxKeep = options.maxKeep ?? DEFAULT_MAX_SNAPSHOTS_PER_AGENT;
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_SNAPSHOT_AGE_HOURS;
  const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();

  let affected = 0;

  // 1. Delete expired snapshots older than maxAgeHours
  try {
    const ageRes = await db.execute(
      agentId
        ? 'DELETE FROM agent_monitoring_snapshots WHERE agent_id = ? AND timestamp < ?'
        : 'DELETE FROM agent_monitoring_snapshots WHERE timestamp < ?',
      agentId ? [agentId, cutoffTime] : [cutoffTime],
    );
    affected += ageRes.rowsAffected ?? 0;
  } catch (err) {
    console.warn('Failed to prune snapshots by age:', err);
  }

  // 2. Keep at most maxKeep snapshots per agent
  if (agentId) {
    try {
      const countRes = await db.execute(
        `DELETE FROM agent_monitoring_snapshots
         WHERE agent_id = ? AND id NOT IN (
           SELECT id FROM agent_monitoring_snapshots
           WHERE agent_id = ?
           ORDER BY timestamp DESC
           LIMIT ?
         )`,
        [agentId, agentId, maxKeep],
      );
      affected += countRes.rowsAffected ?? 0;
    } catch (err) {
      console.warn('Failed to prune snapshots by count limit:', err);
    }
  }

  return affected;
}

export async function getMonitoringSummary(
  agentId: string,
  workspaceRoot?: string | null,
): Promise<MonitoringSummary> {
  const snapshots = await getMonitoringSnapshots(agentId, 500, workspaceRoot);
  if (snapshots.length === 0) {
    return {
      totalSnapshots: 0,
      firstSnapshotTime: null,
      lastSnapshotTime: null,
      avgGpuUtilization: 0,
      peakVramUsedMb: 0,
      avgVramUsedMb: 0,
      latestGpuName: 'N/A',
      latestModel: '',
    };
  }

  const latest = snapshots[0];
  const oldest = snapshots[snapshots.length - 1];
  const totalUtilization = snapshots.reduce((acc, s) => acc + s.gpuUtilizationPct, 0);
  const totalVramUsed = snapshots.reduce((acc, s) => acc + s.gpuVramUsedMb, 0);
  const peakVram = Math.max(...snapshots.map((s) => s.gpuVramUsedMb));

  const latestWithPrefill = snapshots.find((s) => s.prefillSpeed !== undefined && s.prefillSpeed > 0);
  const latestWithDecoding = snapshots.find((s) => s.decodingSpeed !== undefined && s.decodingSpeed > 0);

  return {
    totalSnapshots: snapshots.length,
    firstSnapshotTime: oldest.timestamp,
    lastSnapshotTime: latest.timestamp,
    avgGpuUtilization: Number((totalUtilization / snapshots.length).toFixed(1)),
    peakVramUsedMb: peakVram,
    avgVramUsedMb: Math.round(totalVramUsed / snapshots.length),
    latestGpuName: latest.gpuName,
    latestModel: latest.llmModel,
    latestPrefillSpeed: latestWithPrefill?.prefillSpeed,
    latestDecodingSpeed: latestWithDecoding?.decodingSpeed,
  };
}

// ---------------------------------------------------------------------------
// 대화 단위 토큰 원장 (conversation_token_summaries)
// "대화" = 사용자 요청 1건 → agent_end까지의 전체 턴. 턴별 usage 실측 합산.
// ---------------------------------------------------------------------------

interface DbConversationRow {
  id: string;
  agent_id: string;
  session_id: string | null;
  seq: number | null;
  started_at: string;
  ended_at: string;
  turn_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens: number | null;
  content_tokens: number | null;
  status_tokens: string | null;
  created_at: string;
}

function parseStatusTokens(raw: string | null): TokenStatusBreakdown {
  const base = emptyStatusTokens();
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof TokenStatusBreakdown, unknown>>;
    for (const key of Object.keys(base) as Array<keyof TokenStatusBreakdown>) {
      const v = parsed[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        base[key] = Math.max(0, Math.round(v));
      }
    }
  } catch {
    // ignore malformed JSON
  }
  return base;
}

function mapRowToConversation(row: DbConversationRow): ConversationTokenSummary {
  const inputTokens = row.input_tokens ?? 0;
  const outputTokens = row.output_tokens ?? 0;
  return {
    id: row.id,
    agentId: row.agent_id,
    sessionId: row.session_id ?? undefined,
    seq: row.seq ?? 0,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    turnCount: row.turn_count ?? 0,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    thinkingTokens: row.thinking_tokens ?? 0,
    contentTokens: row.content_tokens ?? 0,
    statusTokens: parseStatusTokens(row.status_tokens),
  };
}

export async function saveConversationSummary(
  summary: ConversationTokenSummary,
  workspaceRoot?: string | null,
): Promise<void> {
  const db = await getDatabase(workspaceRoot);
  await db.execute(
    `INSERT INTO conversation_token_summaries (
      id, agent_id, session_id, seq, started_at, ended_at, turn_count,
      input_tokens, output_tokens, thinking_tokens, content_tokens,
      status_tokens, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      summary.id,
      summary.agentId,
      summary.sessionId ?? null,
      summary.seq,
      summary.startedAt,
      summary.endedAt,
      summary.turnCount,
      summary.inputTokens,
      summary.outputTokens,
      summary.thinkingTokens,
      summary.contentTokens,
      JSON.stringify(summary.statusTokens),
      new Date().toISOString(),
    ],
  );
}

export async function getConversationSummaries(
  agentId: string,
  limit = 50,
  workspaceRoot?: string | null,
): Promise<ConversationTokenSummary[]> {
  const db = await getDatabase(workspaceRoot);
  const rows = await db.select<DbConversationRow[]>(
    'SELECT * FROM conversation_token_summaries WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?',
    [agentId, limit],
  );
  return rows.map(mapRowToConversation);
}

export async function clearConversationSummaries(
  agentId: string,
  workspaceRoot?: string | null,
): Promise<void> {
  const db = await getDatabase(workspaceRoot);
  await db.execute(
    'DELETE FROM conversation_token_summaries WHERE agent_id = ?',
    [agentId],
  );
}
