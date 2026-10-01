import { getGlobalDatabase } from '@/lib/db/client';
import {
  CandidateSnapshotSchema,
  EvalProfileSchema,
  EvalRunConfigSchema,
  HardwareFingerprintSchema,
  RUN_STATUSES,
  TRIAL_OUTCOMES,
  type AggregateLevel,
  type ArenaVoteRow,
  type CandidateSnapshot,
  type EvalAggregateRow,
  type EvalCandidateRow,
  type EvalCandidateStatus,
  type EvalProfile,
  type EvalRunConfig,
  type EvalRunRow,
  type EvalScoreRow,
  type EvalScoreSource,
  type EvalTrialRow,
  type HardwareFingerprint,
  type RunStatus,
  type ScorerType,
  type TrialOutcome,
} from '@/lib/eval/types';

const CANDIDATE_STATUSES: EvalCandidateStatus[] = ['pending', 'running', 'done', 'failed', 'skipped'];
const SCORE_SOURCES: EvalScoreSource[] = ['auto', 'judge', 'human'];
const AGGREGATE_LEVELS: AggregateLevel[] = ['metric', 'pack', 'category', 'dimension', 'composite'];

function isRunStatus(v: unknown): v is RunStatus {
  return typeof v === 'string' && (RUN_STATUSES as readonly string[]).includes(v);
}

function isTrialOutcome(v: unknown): v is TrialOutcome {
  return typeof v === 'string' && (TRIAL_OUTCOMES as readonly string[]).includes(v);
}

function warnSkip(table: string, id: unknown): void {
  console.warn(`[evalRepo] skipping corrupt row in ${table}: ${String(id)}`);
}

// ---------------------------------------------------------------------------
// eval_runs
// ---------------------------------------------------------------------------

interface DbRunRow {
  id: string;
  name: string;
  config_json: string;
  hardware_json: string;
  status: string;
  error: string | null;
  progress_done: number;
  progress_total: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRunRow(row: DbRunRow): EvalRunRow | null {
  const configParsed = EvalRunConfigSchema.safeParse(
    safeJsonParse(row.config_json),
  );
  const hardwareParsed = HardwareFingerprintSchema.safeParse(
    safeJsonParse(row.hardware_json),
  );
  if (!configParsed.success || !hardwareParsed.success || !isRunStatus(row.status)) {
    warnSkip('eval_runs', row.id);
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    config: configParsed.data,
    hardware: hardwareParsed.data,
    status: row.status,
    error: row.error,
    progressDone: row.progress_done,
    progressTotal: row.progress_total,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJsonParse(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export async function createRun(
  config: EvalRunConfig,
  hardware: HardwareFingerprint,
): Promise<string> {
  const db = await getGlobalDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO eval_runs (id, name, config_json, hardware_json, status, error, progress_done, progress_total, started_at, finished_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', NULL, 0, 0, NULL, NULL, ?, ?)`,
    [id, config.name, JSON.stringify(config), JSON.stringify(hardware), now, now],
  );
  return id;
}

export async function updateRunStatus(
  runId: string,
  status: RunStatus,
  patch?: { error?: string; startedAt?: string; finishedAt?: string },
): Promise<void> {
  const db = await getGlobalDatabase();
  const current = await getRun(runId);
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE eval_runs SET status = ?, error = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
    [
      status,
      patch?.error ?? current?.error ?? null,
      patch?.startedAt ?? current?.startedAt ?? null,
      patch?.finishedAt ?? current?.finishedAt ?? null,
      now,
      runId,
    ],
  );
}

export async function updateRunProgress(
  runId: string,
  done: number,
  total: number,
): Promise<void> {
  const db = await getGlobalDatabase();
  await db.execute(
    `UPDATE eval_runs SET progress_done = ?, progress_total = ?, updated_at = ? WHERE id = ?`,
    [done, total, new Date().toISOString(), runId],
  );
}

export async function renameRun(runId: string, name: string): Promise<void> {
  const db = await getGlobalDatabase();
  await db.execute(`UPDATE eval_runs SET name = ?, updated_at = ? WHERE id = ?`, [
    name,
    new Date().toISOString(),
    runId,
  ]);
}

export async function getRun(runId: string): Promise<EvalRunRow | null> {
  const db = await getGlobalDatabase();
  const rows = await db.select<DbRunRow[]>(
    `SELECT * FROM eval_runs WHERE id = ?`,
    [runId],
  );
  if (rows.length === 0) return null;
  return mapRunRow(rows[0]);
}

export async function listRuns(opts?: {
  limit?: number;
  status?: RunStatus[];
}): Promise<EvalRunRow[]> {
  const db = await getGlobalDatabase();
  const rows = await db.select<DbRunRow[]>(
    `SELECT * FROM eval_runs ORDER BY created_at DESC`,
  );
  const mapped: EvalRunRow[] = [];
  for (const row of rows) {
    const parsed = mapRunRow(row);
    if (parsed) mapped.push(parsed);
  }
  const filtered = opts?.status
    ? mapped.filter((r) => opts.status?.includes(r.status))
    : mapped;
  return opts?.limit != null ? filtered.slice(0, opts.limit) : filtered;
}

export async function deleteRun(runId: string): Promise<void> {
  const db = await getGlobalDatabase();
  await db.execute(
    `DELETE FROM eval_scores WHERE trial_id IN (SELECT id FROM eval_trials WHERE run_id = ?)`,
    [runId],
  );
  await db.execute(`DELETE FROM eval_trials WHERE run_id = ?`, [runId]);
  await db.execute(`DELETE FROM eval_candidates WHERE run_id = ?`, [runId]);
  await db.execute(`DELETE FROM eval_aggregates WHERE run_id = ?`, [runId]);
  await db.execute(`DELETE FROM eval_runs WHERE id = ?`, [runId]);
}

// ---------------------------------------------------------------------------
// eval_candidates
// ---------------------------------------------------------------------------

interface DbCandidateRow {
  id: string;
  run_id: string;
  position: number;
  label: string;
  snapshot_json: string;
  model_meta_json: string | null;
  load_ms: number | null;
  status: string;
  error: string | null;
}

function mapCandidateRow(row: DbCandidateRow): EvalCandidateRow | null {
  const snapshotParsed = CandidateSnapshotSchema.safeParse(
    safeJsonParse(row.snapshot_json),
  );
  if (!snapshotParsed.success) {
    warnSkip('eval_candidates', row.id);
    return null;
  }
  const status: EvalCandidateStatus = CANDIDATE_STATUSES.includes(
    row.status as EvalCandidateStatus,
  )
    ? (row.status as EvalCandidateStatus)
    : 'pending';
  let modelMeta: Record<string, unknown> | null = null;
  if (row.model_meta_json != null) {
    const parsed = safeJsonParse(row.model_meta_json);
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      modelMeta = parsed as Record<string, unknown>;
    }
  }
  return {
    id: row.id,
    runId: row.run_id,
    position: row.position,
    label: row.label,
    snapshot: snapshotParsed.data,
    modelMeta,
    loadMs: row.load_ms,
    status,
    error: row.error,
  };
}

export async function insertCandidates(
  runId: string,
  candidates: CandidateSnapshot[],
): Promise<EvalCandidateRow[]> {
  const db = await getGlobalDatabase();
  const rows: EvalCandidateRow[] = [];
  let position = 0;
  const existing = await listCandidates(runId);
  if (existing.length > 0) {
    position = Math.max(...existing.map((c) => c.position)) + 1;
  }
  for (const snapshot of candidates) {
    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO eval_candidates (id, run_id, position, label, snapshot_json, model_meta_json, load_ms, status, error) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'pending', NULL)`,
      [id, runId, position, snapshot.label, JSON.stringify(snapshot)],
    );
    rows.push({
      id,
      runId,
      position,
      label: snapshot.label,
      snapshot,
      modelMeta: null,
      loadMs: null,
      status: 'pending',
      error: null,
    });
    position += 1;
  }
  return rows;
}

export async function updateCandidate(
  candidateId: string,
  patch: Partial<Pick<EvalCandidateRow, 'status' | 'error' | 'loadMs' | 'modelMeta'>>,
): Promise<void> {
  const db = await getGlobalDatabase();
  const rows = await db.select<DbCandidateRow[]>(
    `SELECT * FROM eval_candidates WHERE id = ?`,
    [candidateId],
  );
  const current = rows.length > 0 ? mapCandidateRow(rows[0]) : null;
  await db.execute(
    `UPDATE eval_candidates SET status = ?, error = ?, load_ms = ?, model_meta_json = ? WHERE id = ?`,
    [
      patch.status ?? current?.status ?? 'pending',
      patch.error ?? current?.error ?? null,
      patch.loadMs ?? current?.loadMs ?? null,
      patch.modelMeta !== undefined
        ? JSON.stringify(patch.modelMeta)
        : current?.modelMeta != null
          ? JSON.stringify(current.modelMeta)
          : null,
      candidateId,
    ],
  );
}

export async function listCandidates(runId: string): Promise<EvalCandidateRow[]> {
  const db = await getGlobalDatabase();
  const rows = await db.select<DbCandidateRow[]>(
    `SELECT * FROM eval_candidates WHERE run_id = ? ORDER BY position ASC`,
    [runId],
  );
  const mapped: EvalCandidateRow[] = [];
  for (const row of rows) {
    const parsed = mapCandidateRow(row);
    if (parsed) mapped.push(parsed);
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// eval_trials
// ---------------------------------------------------------------------------

interface DbTrialRow {
  id: string;
  run_id: string;
  candidate_id: string;
  pack_id: string;
  sample_id: string;
  epoch: number;
  outcome: string;
  output_text: string | null;
  reasoning_text: string | null;
  transcript_json: string | null;
  final_state_json: string | null;
  extra_json: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens: number | null;
  ttft_ms: number | null;
  prefill_tps: number | null;
  decode_tps: number | null;
  total_ms: number | null;
  timing_source: string | null;
  cache_hit: number | null;
  vram_peak_mb: number | null;
  gpu_util_avg: number | null;
  gpu_temp_max: number | null;
  offload_ratio: number | null;
  turns: number | null;
  tool_calls: number | null;
  started_at: string;
  finished_at: string | null;
}

function mapTrialRow(row: DbTrialRow): EvalTrialRow | null {
  if (!isTrialOutcome(row.outcome)) {
    warnSkip('eval_trials', row.id);
    return null;
  }
  return {
    id: row.id,
    runId: row.run_id,
    candidateId: row.candidate_id,
    packId: row.pack_id,
    sampleId: row.sample_id,
    epoch: row.epoch,
    outcome: row.outcome,
    outputText: row.output_text,
    reasoningText: row.reasoning_text,
    transcriptJson: row.transcript_json,
    finalStateJson: row.final_state_json,
    extraJson: row.extra_json,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    thinkingTokens: row.thinking_tokens,
    ttftMs: row.ttft_ms,
    prefillTps: row.prefill_tps,
    decodeTps: row.decode_tps,
    totalMs: row.total_ms,
    timingSource: row.timing_source === 'server' || row.timing_source === 'client'
      ? row.timing_source
      : null,
    cacheHit: row.cache_hit == null ? null : row.cache_hit !== 0,
    vramPeakMb: row.vram_peak_mb,
    gpuUtilAvg: row.gpu_util_avg,
    gpuTempMax: row.gpu_temp_max,
    offloadRatio: row.offload_ratio,
    turns: row.turns,
    toolCalls: row.tool_calls,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

const TRIAL_COLUMNS = `id, run_id, candidate_id, pack_id, sample_id, epoch, outcome, output_text, reasoning_text, transcript_json, final_state_json, extra_json, input_tokens, output_tokens, thinking_tokens, ttft_ms, prefill_tps, decode_tps, total_ms, timing_source, cache_hit, vram_peak_mb, gpu_util_avg, gpu_temp_max, offload_ratio, turns, tool_calls, started_at, finished_at`;

function trialToBinds(trial: EvalTrialRow): unknown[] {
  return [
    trial.id,
    trial.runId,
    trial.candidateId,
    trial.packId,
    trial.sampleId,
    trial.epoch,
    trial.outcome,
    trial.outputText,
    trial.reasoningText,
    trial.transcriptJson,
    trial.finalStateJson,
    trial.extraJson,
    trial.inputTokens,
    trial.outputTokens,
    trial.thinkingTokens,
    trial.ttftMs,
    trial.prefillTps,
    trial.decodeTps,
    trial.totalMs,
    trial.timingSource,
    trial.cacheHit == null ? null : trial.cacheHit ? 1 : 0,
    trial.vramPeakMb,
    trial.gpuUtilAvg,
    trial.gpuTempMax,
    trial.offloadRatio,
    trial.turns,
    trial.toolCalls,
    trial.startedAt,
    trial.finishedAt,
  ];
}

export async function upsertTrial(trial: EvalTrialRow): Promise<void> {
  const db = await getGlobalDatabase();
  await db.execute(
    `INSERT INTO eval_trials (${TRIAL_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(candidate_id, pack_id, sample_id, epoch) DO UPDATE SET outcome=excluded.outcome, output_text=excluded.output_text, reasoning_text=excluded.reasoning_text, transcript_json=excluded.transcript_json, final_state_json=excluded.final_state_json, extra_json=excluded.extra_json, input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens, thinking_tokens=excluded.thinking_tokens, ttft_ms=excluded.ttft_ms, prefill_tps=excluded.prefill_tps, decode_tps=excluded.decode_tps, total_ms=excluded.total_ms, timing_source=excluded.timing_source, cache_hit=excluded.cache_hit, vram_peak_mb=excluded.vram_peak_mb, gpu_util_avg=excluded.gpu_util_avg, gpu_temp_max=excluded.gpu_temp_max, offload_ratio=excluded.offload_ratio, turns=excluded.turns, tool_calls=excluded.tool_calls, finished_at=excluded.finished_at`,
    trialToBinds(trial),
  );
}

export async function listTrials(
  runId: string,
  filter?: { candidateId?: string; packId?: string },
): Promise<EvalTrialRow[]> {
  const db = await getGlobalDatabase();
  const rows = await db.select<DbTrialRow[]>(
    `SELECT * FROM eval_trials WHERE run_id = ?`,
    [runId],
  );
  const mapped: EvalTrialRow[] = [];
  for (const row of rows) {
    const parsed = mapTrialRow(row);
    if (parsed) mapped.push(parsed);
  }
  return mapped.filter(
    (t) =>
      (filter?.candidateId == null || t.candidateId === filter.candidateId) &&
      (filter?.packId == null || t.packId === filter.packId),
  );
}

export async function listCompletedTrialKeys(runId: string): Promise<Set<string>> {
  const trials = await listTrials(runId);
  const keys = new Set<string>();
  for (const t of trials) {
    if (t.outcome !== 'cancelled') {
      keys.add(`${t.candidateId}|${t.packId}|${t.sampleId}|${t.epoch}`);
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// eval_scores
// ---------------------------------------------------------------------------

interface DbScoreRow {
  id: string;
  trial_id: string;
  scorer_key: string;
  scorer_type: string;
  value: number;
  verdict: string;
  reason: string | null;
  extracted: string | null;
  judge_raw: string | null;
  source: string;
  created_at: string;
}

const VERDICTS = ['correct', 'incorrect', 'partial', 'no_answer', 'error', 'skipped'] as const;

function mapScoreRow(row: DbScoreRow): EvalScoreRow | null {
  if (
    !(VERDICTS as readonly string[]).includes(row.verdict) ||
    !SCORE_SOURCES.includes(row.source as EvalScoreSource)
  ) {
    warnSkip('eval_scores', row.id);
    return null;
  }
  return {
    id: row.id,
    trialId: row.trial_id,
    scorerKey: row.scorer_key,
    scorerType: row.scorer_type as ScorerType,
    value: row.value,
    verdict: row.verdict as EvalScoreRow['verdict'],
    reason: row.reason,
    extracted: row.extracted,
    judgeRaw: row.judge_raw,
    source: row.source as EvalScoreSource,
    createdAt: row.created_at,
  };
}

export async function upsertScores(scores: EvalScoreRow[]): Promise<void> {
  if (scores.length === 0) return;
  const db = await getGlobalDatabase();
  for (const s of scores) {
    await db.execute(
      `INSERT INTO eval_scores (id, trial_id, scorer_key, scorer_type, value, verdict, reason, extracted, judge_raw, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(trial_id, scorer_key, source) DO UPDATE SET value=excluded.value, verdict=excluded.verdict, reason=excluded.reason, extracted=excluded.extracted, judge_raw=excluded.judge_raw, created_at=excluded.created_at`,
      [
        s.id,
        s.trialId,
        s.scorerKey,
        s.scorerType,
        s.value,
        s.verdict,
        s.reason,
        s.extracted,
        s.judgeRaw,
        s.source,
        s.createdAt,
      ],
    );
  }
}

export async function listScores(runId: string): Promise<EvalScoreRow[]> {
  const db = await getGlobalDatabase();
  const rows = await db.select<DbScoreRow[]>(
    `SELECT s.* FROM eval_scores s INNER JOIN eval_trials t ON s.trial_id = t.id WHERE t.run_id = ?`,
    [runId],
  );
  const mapped: EvalScoreRow[] = [];
  for (const row of rows) {
    const parsed = mapScoreRow(row);
    if (parsed) mapped.push(parsed);
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// eval_aggregates
// ---------------------------------------------------------------------------

interface DbAggregateRow {
  run_id: string;
  candidate_id: string;
  level: string;
  key: string;
  raw: number | null;
  normalized: number | null;
  ci_low: number | null;
  ci_high: number | null;
  n: number | null;
  anchors_version: string | null;
  computed_at: string;
}

function mapAggregateRow(row: DbAggregateRow): EvalAggregateRow {
  return {
    runId: row.run_id,
    candidateId: row.candidate_id,
    level: AGGREGATE_LEVELS.includes(row.level as AggregateLevel)
      ? (row.level as AggregateLevel)
      : 'metric',
    key: row.key,
    raw: row.raw,
    normalized: row.normalized,
    ciLow: row.ci_low,
    ciHigh: row.ci_high,
    n: row.n,
    anchorsVersion: row.anchors_version,
    computedAt: row.computed_at,
  };
}

export async function replaceAggregates(
  runId: string,
  rows: EvalAggregateRow[],
): Promise<void> {
  const db = await getGlobalDatabase();
  await db.execute(`DELETE FROM eval_aggregates WHERE run_id = ?`, [runId]);
  for (const r of rows) {
    await db.execute(
      `INSERT INTO eval_aggregates (run_id, candidate_id, level, key, raw, normalized, ci_low, ci_high, n, anchors_version, computed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        r.runId,
        r.candidateId,
        r.level,
        r.key,
        r.raw,
        r.normalized,
        r.ciLow,
        r.ciHigh,
        r.n,
        r.anchorsVersion,
        r.computedAt,
      ],
    );
  }
}

export async function listAggregates(runId: string): Promise<EvalAggregateRow[]> {
  const db = await getGlobalDatabase();
  const rows = await db.select<DbAggregateRow[]>(
    `SELECT * FROM eval_aggregates WHERE run_id = ?`,
    [runId],
  );
  return rows.map(mapAggregateRow);
}

export async function pruneRunOutputs(olderThanIso: string): Promise<number> {
  const db = await getGlobalDatabase();
  const res = await db.execute(
    `UPDATE eval_trials SET output_text = NULL, reasoning_text = NULL, transcript_json = NULL, final_state_json = NULL WHERE started_at < ?`,
    [olderThanIso],
  );
  return res.rowsAffected ?? 0;
}

export async function markInterruptedRuns(): Promise<number> {
  const db = await getGlobalDatabase();
  const res = await db.execute(
    `UPDATE eval_runs SET status = 'interrupted', updated_at = ? WHERE status IN ('running', 'judging', 'paused')`,
    [new Date().toISOString()],
  );
  return res.rowsAffected ?? 0;
}

// ---------------------------------------------------------------------------
// eval_profiles
// ---------------------------------------------------------------------------

export async function listProfiles(): Promise<EvalProfile[]> {
  const db = await getGlobalDatabase();
  const rows = await db.select<{ id: string; profile_json: string }[]>(
    `SELECT * FROM eval_profiles ORDER BY id ASC`,
  );
  const profiles: EvalProfile[] = [];
  for (const row of rows) {
    const parsed = EvalProfileSchema.safeParse(safeJsonParse(row.profile_json));
    if (!parsed.success) {
      warnSkip('eval_profiles', row.id);
      continue;
    }
    profiles.push(parsed.data);
  }
  return profiles;
}

export async function saveProfile(profile: EvalProfile): Promise<void> {
  const db = await getGlobalDatabase();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO eval_profiles (id, profile_json, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile_json=excluded.profile_json, updated_at=excluded.updated_at`,
    [profile.id, JSON.stringify(profile), now, now],
  );
}

export async function deleteProfile(id: string): Promise<void> {
  const db = await getGlobalDatabase();
  await db.execute(`DELETE FROM eval_profiles WHERE id = ?`, [id]);
}

// ---------------------------------------------------------------------------
// arena_votes
// ---------------------------------------------------------------------------

interface DbArenaRow {
  id: string;
  prompt_hash: string;
  prompt_preview: string | null;
  a_snapshot_json: string;
  b_snapshot_json: string;
  a_label: string;
  b_label: string;
  winner: string;
  workspace_root: string | null;
  created_at: string;
}

const ARENA_WINNERS = ['a', 'b', 'tie', 'both_bad'] as const;

function mapArenaRow(row: DbArenaRow): ArenaVoteRow | null {
  const aParsed = CandidateSnapshotSchema.safeParse(safeJsonParse(row.a_snapshot_json));
  const bParsed = CandidateSnapshotSchema.safeParse(safeJsonParse(row.b_snapshot_json));
  if (
    !aParsed.success ||
    !bParsed.success ||
    !(ARENA_WINNERS as readonly string[]).includes(row.winner)
  ) {
    warnSkip('arena_votes', row.id);
    return null;
  }
  return {
    id: row.id,
    promptHash: row.prompt_hash,
    promptPreview: row.prompt_preview,
    aSnapshot: aParsed.data,
    bSnapshot: bParsed.data,
    aLabel: row.a_label,
    bLabel: row.b_label,
    winner: row.winner as ArenaVoteRow['winner'],
    workspaceRoot: row.workspace_root,
    createdAt: row.created_at,
  };
}

export async function insertArenaVote(
  vote: Omit<ArenaVoteRow, 'id' | 'createdAt'>,
): Promise<string> {
  const db = await getGlobalDatabase();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.execute(
    `INSERT INTO arena_votes (id, prompt_hash, prompt_preview, a_snapshot_json, b_snapshot_json, a_label, b_label, winner, workspace_root, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      vote.promptHash,
      vote.promptPreview,
      JSON.stringify(vote.aSnapshot),
      JSON.stringify(vote.bSnapshot),
      vote.aLabel,
      vote.bLabel,
      vote.winner,
      vote.workspaceRoot,
      createdAt,
    ],
  );
  return id;
}

export async function listArenaVotes(opts?: { limit?: number }): Promise<ArenaVoteRow[]> {
  const db = await getGlobalDatabase();
  const rows = await db.select<DbArenaRow[]>(
    `SELECT * FROM arena_votes ORDER BY created_at DESC`,
  );
  const votes: ArenaVoteRow[] = [];
  for (const row of rows) {
    const parsed = mapArenaRow(row);
    if (parsed) votes.push(parsed);
  }
  return opts?.limit != null ? votes.slice(0, opts.limit) : votes;
}

export async function deleteArenaVote(id: string): Promise<void> {
  const db = await getGlobalDatabase();
  await db.execute(`DELETE FROM arena_votes WHERE id = ?`, [id]);
}
