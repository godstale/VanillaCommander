import { getAgent } from '@/lib/db/repositories/agentsRepo';
import {
  getRun,
  insertCandidates,
  listAggregates,
  listCandidates,
  listCompletedTrialKeys,
  listScores,
  listTrials,
  replaceAggregates,
  updateCandidate,
  updateRunProgress,
  updateRunStatus,
  upsertScores,
  upsertTrial,
} from '@/lib/db/repositories/evalRepo';
import { appendAudit, getIntegrationSettings, listIntegrations } from '@/lib/db/repositories/integrationsRepo';
import { resolveAgentLlmRuntime } from '@/lib/llm/providers';
import { getStreamChatFn, type LlmStreamChatFn } from '@/lib/llm/providerRuntime';
import { aggregateRun } from '../scoring/aggregate';
import { combineSampleScore, getScorer, scorerKeyOf } from '../scorers/index';
import type { ScorerResult } from '../scorers/types';
import { evalLock } from '../evalLock';
import { mulberry32, shuffleInPlace } from '../stats/random';
import type {
  CandidateSnapshot,
  EvalCandidateRow,
  EvalRunConfig,
  EvalTrialRow,
  HardwareFingerprint,
  RunStatus,
  ScorerSpec,
  TrialOutcome,
} from '../types';
import { loadPack, listPacks, type LoadedPack } from '../packs/packLoader';
import { tauriPackFs, type PackFs } from '../packs/packFs';
import { checkPermission } from '@/lib/integrations/gateway';
import type { IntegrationPurpose } from '@/lib/integrations/types';

// P11-02: 평가 목적은 게이트웨이에서 제거됨. consent-v2는 평가 목적을 부여하지
// 않으므로 이 경로는 항상 거부된다. 이 파일은 P11-03에서 삭제.
const LEGACY_EVAL_PURPOSE = 'candidate' as unknown as IntegrationPurpose;
import { classifyOutcome } from './outcome';
import { ResourceSampler } from './resourceSampler';
import { registerEvalExtensions } from '../registerAll';
import { getSolver, registerSolver, type SolverContext, type SolverResult } from './solvers/index';
import { registerSingleTurnSolver } from './solvers/singleTurn';
import { registerToolCallSolver } from './solvers/toolCall';
import { registerPerfProbeSolver } from './solvers/perfProbe';
import {
  COMPACTION_RECALL_KIND,
  compactionRecallSolver,
} from './solvers/compactionRecall';
import { unloadOllamaModel, withTimeout } from './timing';
import type { RunnerEvent } from './events';
import {
  makeRecord,
  ProgressLogWriter,
  tauriProgressLogStore,
  type ProgressLogStore,
} from './progressLog';

const KIND_RANK: Record<string, number> = {
  perf_probe: 0,
  single_turn: 1,
  multi_turn: 2,
  tool_call: 3,
  long_context: 4,
  compaction_recall: 5,
  agentic: 6,
  logprob_trace: 7,
};

export interface RunnerDeps {
  packFs?: PackFs;
  streamChatFactory?: (candidate: CandidateSnapshot) => LlmStreamChatFn;
  judgePass?: (runId: string) => Promise<void>;
  codeExecPass?: (runId: string) => Promise<{ scoredTrials: number; scoresWritten: number }>;
  workspaceRoot?: string;
  progressLogStore?: ProgressLogStore;
}

interface TrialPlanItem {
  candidate: EvalCandidateRow;
  pack: LoadedPack;
  packTier: string;
  sampleId: string;
  epochSlot: number;
  epochs: number;
  rotation: number;
  rotations: number;
  timeoutMs: number;
}

function defaultStreamChatFactory(candidate: CandidateSnapshot): LlmStreamChatFn {
  const runtime = resolveAgentLlmRuntime(
    { llmProvider: candidate.provider, llmBaseUrl: candidate.baseUrl },
    undefined,
  );
  return getStreamChatFn({ openAiCompatible: runtime.openAiCompatible });
}

async function resolveApiKey(candidate: CandidateSnapshot): Promise<string | undefined> {
  if (!candidate.sourceAgentId) return undefined;
  try {
    const agent = await getAgent(candidate.sourceAgentId);
    return agent?.llmApiKey ?? undefined;
  } catch {
    return undefined;
  }
}

export class EvalRunner {
  private packFs: PackFs;
  private streamChatFactory: (candidate: CandidateSnapshot) => LlmStreamChatFn;
  private judgePass?: (runId: string) => Promise<void>;
  private codeExecPass?: (runId: string) => Promise<{ scoredTrials: number; scoresWritten: number }>;
  private workspaceRoot?: string;
  private listeners = new Set<(e: RunnerEvent) => void>();
  private paused = false;
  private cancelled = false;
  private skipCandidateId: string | null = null;
  private aborter: AbortController | null = null;
  private progressLogStore: ProgressLogStore;
  private progressLog: ProgressLogWriter | null = null;
  private progressLogRunId: string | null = null;
  private consecutiveTimeouts = 0;

  constructor(deps: RunnerDeps = {}) {
    this.packFs = deps.packFs ?? tauriPackFs;
    this.streamChatFactory = deps.streamChatFactory ?? defaultStreamChatFactory;
    this.judgePass = deps.judgePass;
    this.codeExecPass = deps.codeExecPass;
    this.workspaceRoot = deps.workspaceRoot;
    this.progressLogStore = deps.progressLogStore ?? tauriProgressLogStore;
    registerSingleTurnSolver();
    registerToolCallSolver();
    registerPerfProbeSolver();
    registerCompactionAdapter();
    registerEvalExtensions();
  }

  on(listener: (e: RunnerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(e: RunnerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(e);
      } catch {
        // ignore listener errors
      }
    }
    this.mirrorToProgressLog(e);
  }

  // Live events mirrored to the persisted JSONL log (streaming deltas and
  // ETA ticks are too noisy; detailed trial lines are written explicitly).
  private mirrorToProgressLog(e: RunnerEvent): void {
    const log = this.progressLog;
    if (!log) return;
    const runId = this.progressLogRunId;
    if (!runId) return;
    switch (e.type) {
      case 'run_status':
        log.record(makeRecord(runId, { kind: 'run_status', status: e.status, error: e.error }));
        break;
      case 'candidate_start':
        log.record(
          makeRecord(runId, { kind: 'candidate_started', candidateId: e.candidateId, label: e.label }),
        );
        break;
      case 'trial_start':
        log.record(
          makeRecord(runId, {
            kind: 'trial_started',
            candidateId: e.candidateId,
            packId: e.packId,
            sampleId: e.sampleId,
            epoch: e.epoch,
          }),
        );
        break;
      case 'resource':
        log.record(
          makeRecord(runId, {
            kind: 'resource',
            vramUsedMb: e.vramUsedMb,
            gpuUtilPct: e.gpuUtilPct,
            gpuTempC: e.gpuTempC,
            decodeTps: e.decodeTps,
          }),
        );
        break;
      case 'log':
        log.record(makeRecord(runId, { kind: 'log', level: e.level, message: e.message }));
        break;
      default:
        break;
    }
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.emit({ type: 'log', level: 'info', message: 'pause requested; applies after the current trial finishes' });
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.emit({ type: 'log', level: 'info', message: 'run resumed' });
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.emit({ type: 'log', level: 'warn', message: 'cancel requested; finishing the current trial' });
    this.aborter?.abort();
  }

  skipCurrentCandidate(): void {
    this.skipCandidateId = '__current__';
    this.emit({ type: 'log', level: 'info', message: 'skip requested; applies after the current trial finishes' });
    this.aborter?.abort();
  }

  async start(runId: string): Promise<void> {
    this.paused = false;
    this.cancelled = false;
    this.skipCandidateId = null;
    this.consecutiveTimeouts = 0;

    const run = await getRun(runId);
    if (!run) {
      this.emit({ type: 'log', level: 'error', message: `run not found: ${runId}` });
      return;
    }
    if (run.status === 'completed') return;
    const config = run.config;

    if (!evalLock.acquire(runId, config.name)) {
      this.emit({ type: 'log', level: 'warn', message: 'eval lock busy or chat running; start aborted' });
      return;
    }
    this.progressLogRunId = runId;
    this.progressLog = new ProgressLogWriter(this.progressLogStore, runId, this.workspaceRoot);
    this.progressLog.record(
      makeRecord(runId, {
        kind: 'run_started',
        name: config.name,
        packs: config.packs.map((p) => ({
          packId: p.packId,
          samples: p.sampleIds.length,
          epochs: p.epochs,
        })),
        candidates: config.candidates.map((c) => ({
          label: c.label,
          provider: c.provider,
          model: c.model,
        })),
        judge:
          config.judge == null
            ? null
            : config.judge.target.type === 'local'
              ? config.judge.target.model
              : config.judge.target.integrationId,
        hardware: run.hardware,
      }),
    );
    this.aborter = new AbortController();
    const runSignal = this.aborter.signal;
    const startedAtWall = Date.now();

    try {
      await updateRunStatus(runId, 'running', { startedAt: new Date().toISOString() });
      this.emit({ type: 'run_status', status: 'running' });

      // Load packs + verify hashes.
      const { refs } = await listPacks(this.packFs, this.workspaceRoot);
      const refByKey = new Map(refs.map((r) => [`${r.scope}:${r.manifest.id}`, r]));
      const packs: LoadedPack[] = [];
      for (const p of config.packs) {
        const ref = refByKey.get(`${p.scope}:${p.packId}`);
        if (!ref) throw new Error(`pack not found: ${p.scope}:${p.packId}`);
        const loaded = await loadPack(this.packFs, ref, this.workspaceRoot);
        if (loaded.contentHash !== p.contentHash) {
          throw new Error(`pack changed since run was configured: ${p.packId}`);
        }
        packs.push(loaded);
      }

      let candidates = await listCandidates(runId);
      if (candidates.length === 0) {
        candidates = await insertCandidates(runId, config.candidates);
      }

      const plan = this.buildPlan(config, candidates, packs);
      await updateRunProgress(runId, 0, plan.length);
      const completed = await listCompletedTrialKeys(runId);
      let done = 0;
      for (const item of plan) {
        if (completed.has(this.trialKey(item))) done += 1;
      }
      await updateRunProgress(runId, done, plan.length);

      let prevModel: { baseUrl: string; model: string } | null = null;
      let candidateSkipped = false;

      for (const candidate of candidates) {
        if (this.cancelled) break;
        candidateSkipped = false;
        this.emit({ type: 'candidate_start', candidateId: candidate.id, label: candidate.label });
        await updateCandidate(candidate.id, { status: 'running' });

        // External permission gate (per candidate) + audit.
        if (!(await this.checkCandidatePermission(config, candidate))) {
          await updateCandidate(candidate.id, { status: 'skipped', error: 'external permission denied' });
          this.emit({ type: 'candidate_end', candidateId: candidate.id, label: candidate.label });
          continue;
        }

        // Unload previous model + cold load measurement.
        if (config.options.unloadBetweenCandidates && prevModel && candidate.snapshot.provider === 'ollama') {
          await unloadOllamaModel(prevModel.baseUrl, prevModel.model);
        }
        if (candidate.snapshot.provider === 'ollama') {
          prevModel = { baseUrl: candidate.snapshot.baseUrl, model: candidate.snapshot.model };
        }
        await this.measureColdLoad(candidate);

        const items = plan.filter((it) => it.candidate.id === candidate.id);
        for (const item of items) {
          if (this.cancelled) break;
          if (this.skipCandidateId !== null) {
            candidateSkipped = true;
            this.skipCandidateId = null;
            break;
          }
          await this.waitIfPaused(runSignal);
          if (this.cancelled) break;
          if (completed.has(this.trialKey(item))) continue;
          // A single trial's bookkeeping must never kill the whole run:
          // record the failure in the log and keep going with the next item.
          try {
            await this.runTrial(runId, item);
          } catch (err) {
            this.emit({
              type: 'log',
              level: 'error',
              message: `trial bookkeeping failed for ${item.pack.manifest.id}/${item.sampleId}; continuing with the next item (${err instanceof Error ? err.message : String(err)})`,
            });
          }
          done += 1;
          await updateRunProgress(runId, done, plan.length);
          const elapsedSec = (Date.now() - startedAtWall) / 1000;
          const remaining = done > 0 ? (elapsedSec / done) * (plan.length - done) : 0;
          this.emit({ type: 'eta', remainingSec: Math.round(remaining) });
        }

        await updateCandidate(candidate.id, {
          status: this.cancelled ? 'failed' : candidateSkipped ? 'skipped' : 'done',
          ...(this.cancelled ? { error: 'cancelled' } : {}),
        });
        const candidateStatus = this.cancelled ? 'failed' : candidateSkipped ? 'skipped' : 'done';
        this.progressLog?.record(
          makeRecord(runId, {
            kind: 'candidate_finished',
            candidateId: candidate.id,
            label: candidate.label,
            status: candidateStatus,
          }),
        );
        this.emit({ type: 'candidate_end', candidateId: candidate.id, label: candidate.label });
      }

      if (this.cancelled) {
        await updateRunStatus(runId, 'cancelled', { finishedAt: new Date().toISOString() });
        this.emit({ type: 'run_status', status: 'cancelled' });
        await this.writeRunFinished(runId, 'cancelled');
        return;
      }

      if (config.judge) {
        if (this.judgePass) {
          await updateRunStatus(runId, 'judging');
          this.emit({ type: 'run_status', status: 'judging' });
          await this.judgePass(runId);
        } else {
          this.emit({ type: 'log', level: 'warn', message: 'judge configured but no judge pass available; skipping' });
        }
      }

      if (this.codeExecPass) {
        try {
          const r = await this.codeExecPass(runId);
          this.emit({
            type: 'log',
            level: 'info',
            message: `code-execution scoring: ${r.scoredTrials} trial(s), ${r.scoresWritten} score(s) written`,
          });
        } catch (err) {
          this.emit({
            type: 'log',
            level: 'warn',
            message: `code-execution scoring failed; sync scores are kept (${err instanceof Error ? err.message : String(err)})`,
          });
        }
      }

      await this.aggregate(runId, config, candidates, packs, run.hardware);
      await updateRunStatus(runId, 'completed', { finishedAt: new Date().toISOString() });
      this.emit({ type: 'run_status', status: 'completed' });
      await this.writeRunFinished(runId, 'completed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status: RunStatus = 'failed';
      await updateRunStatus(runId, status, { error: message, finishedAt: new Date().toISOString() }).catch(() => undefined);
      this.emit({ type: 'run_status', status, error: message });
      await this.writeRunFinished(runId, 'failed');
    } finally {
      evalLock.release(runId);
      this.aborter = null;
      const log = this.progressLog;
      this.progressLog = null;
      this.progressLogRunId = null;
      if (log) await log.close().catch(() => undefined);
    }
  }

  // Final per-candidate summary line for the persisted log. Best effort:
  // failures here must never change the run outcome.
  private async writeRunFinished(runId: string, status: string): Promise<void> {
    try {
      const [trials, scores, candidates] = await Promise.all([
        listTrials(runId),
        listScores(runId),
        listCandidates(runId),
      ]);
      const valuesByTrial = new Map<string, number[]>();
      for (const s of scores) {
        const list = valuesByTrial.get(s.trialId) ?? [];
        list.push(s.value);
        valuesByTrial.set(s.trialId, list);
      }
      const compositeByCandidate = new Map<string, number>();
      if (status === 'completed') {
        try {
          for (const row of await listAggregates(runId)) {
            if (row.level === 'composite' && row.normalized != null) {
              compositeByCandidate.set(row.candidateId, row.normalized);
            }
          }
        } catch {
          // aggregates optional for the summary
        }
      }
      const run = await getRun(runId).catch(() => null);
      this.progressLog?.record(
        makeRecord(runId, {
          kind: 'run_finished',
          status,
          done: run?.progressDone ?? trials.length,
          total: run?.progressTotal ?? trials.length,
          results: candidates.map((c) => {
            const cellTrials = trials.filter((tr) => tr.candidateId === c.id);
            const values: number[] = [];
            for (const tr of cellTrials) {
              const v = valuesByTrial.get(tr.id);
              if (v) values.push(...v);
            }
            return {
              candidateId: c.id,
              label: c.label,
              trials: cellTrials.length,
              avgScore: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null,
              composite: compositeByCandidate.get(c.id) ?? null,
            };
          }),
        }),
      );
    } catch {
      // ignore logging failures
    }
  }

  private trialKey(item: Pick<TrialPlanItem, 'candidate' | 'pack' | 'sampleId' | 'epochSlot'>): string {
    return `${item.candidate.id}|${item.pack.manifest.id}|${item.sampleId}|${item.epochSlot}`;
  }

  private buildPlan(
    config: EvalRunConfig,
    candidates: EvalCandidateRow[],
    packs: LoadedPack[],
  ): TrialPlanItem[] {
    const packByKey = new Map(packs.map((p) => [`${p.scope}:${p.manifest.id}`, p]));
    const orderedPacks = [...config.packs].sort(
      (a, b) =>
        (KIND_RANK[packByKey.get(`${a.scope}:${a.packId}`)?.manifest.kind ?? ''] ?? 99) -
        (KIND_RANK[packByKey.get(`${b.scope}:${b.packId}`)?.manifest.kind ?? ''] ?? 99),
    );
    const rng = mulberry32(config.options.sampleOrderSeed);
    const plan: TrialPlanItem[] = [];
    for (const candidate of candidates) {
      for (const pref of orderedPacks) {
        const pack = packByKey.get(`${pref.scope}:${pref.packId}`);
        if (!pack) continue;
        const byId = new Map(pack.samples.map((s) => [s.id, s]));
        const ordered = shuffleInPlace([...pref.sampleIds], rng).filter((id) => byId.has(id));
        for (const sampleId of ordered) {
          const sample = byId.get(sampleId);
          if (!sample) continue;
          const epochs =
            sample.tags?.includes('reliability') && pref.epochs < config.options.reliabilityEpochs
              ? config.options.reliabilityEpochs
              : pref.epochs;
          const rotations =
            pref.circular || pack.manifest.defaults.circular
              ? Math.min(sample.choices?.length ?? 0, 4) || 1
              : 1;
          const timeoutMs =
            pack.manifest.defaults.timeoutSec *
            config.options.timeoutMultiplier *
            (candidate.snapshot.reasoning === 'on' ? 3 : 1) *
            1000;
          for (let e = 0; e < epochs; e++) {
            for (let r = 0; r < rotations; r++) {
              plan.push({
                candidate,
                pack,
                packTier: pref.tier,
                sampleId,
                epochSlot: e * rotations + r,
                epochs,
                rotation: r,
                rotations,
                timeoutMs,
              });
            }
          }
        }
      }
    }
    return plan;
  }

  private async waitIfPaused(signal: AbortSignal): Promise<void> {
    while (this.paused && !this.cancelled && !signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  private async checkCandidatePermission(
    config: EvalRunConfig,
    candidate: EvalCandidateRow,
  ): Promise<boolean> {
    if (candidate.snapshot.endpointClass === 'local' || candidate.snapshot.endpointClass === 'lan-trusted') {
      return true;
    }
    try {
      const settings = await getIntegrationSettings();
      const integrations = await listIntegrations();
      const match = integrations.find(
        (it) =>
          it.enabled &&
          it.kind === 'llm-api' &&
          it.llm?.provider === candidate.snapshot.provider &&
          it.llm?.baseUrl === candidate.snapshot.baseUrl,
      );
      if (!match) return false;
      const perm = checkPermission(match, settings, LEGACY_EVAL_PURPOSE, ['public-bundled']);
      if (!perm.ok) return false;
      await appendAudit({
        integrationId: match.id,
        purpose: LEGACY_EVAL_PURPOSE,
        dataClasses: ['public-bundled'],
        runId: candidate.runId,
        requestCount: config.packs.reduce((a, p) => a + p.sampleIds.length * p.epochs, 0),
        bytesSent: 0,
        status: 'ok',
        error: null,
      }).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  private async measureColdLoad(candidate: EvalCandidateRow): Promise<void> {
    const snapshot = candidate.snapshot;
    if (snapshot.provider !== 'ollama') {
      await updateCandidate(candidate.id, { loadMs: null }).catch(() => undefined);
      return;
    }
    try {
      const factory = this.streamChatFactory(snapshot);
      const startedAt = performance.now();
      let loadMs: number | null = null;
      const stream = factory(
        {
          baseUrl: snapshot.baseUrl,
          model: snapshot.model,
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 1,
        },
        this.aborter?.signal,
      );
      for await (const chunk of stream) {
        if (chunk.metrics?.loadDurationMs !== undefined) {
          loadMs = chunk.metrics.loadDurationMs;
        }
        if (chunk.done) break;
      }
      if (loadMs === null) loadMs = performance.now() - startedAt;
      await updateCandidate(candidate.id, { loadMs }).catch(() => undefined);
    } catch {
      // warmup failures surface as trial outcomes; keep going
    }
  }

  private async runTrial(runId: string, item: TrialPlanItem): Promise<void> {
    const { candidate, pack, sampleId } = item;
    const sample = pack.samples.find((s) => s.id === sampleId);
    if (!sample) return;
    this.emit({
      type: 'trial_start',
      candidateId: candidate.id,
      packId: pack.manifest.id,
      sampleId,
      epoch: item.epochSlot,
    });

    const snapshot = candidate.snapshot;
    const apiKey = await resolveApiKey(snapshot);
    const runtime = resolveAgentLlmRuntime(
      { llmProvider: snapshot.provider, llmBaseUrl: snapshot.baseUrl, llmApiKey: apiKey },
      undefined,
    );
    const baseStreamChat = this.streamChatFactory(snapshot);
    const emit = (e: RunnerEvent) => this.emit(e);
    const trialMeta = { candidateId: candidate.id, packId: pack.manifest.id, sampleId };
    let lastDeltaAt = 0;
    const streamChat: LlmStreamChatFn = async function* (req, signal) {
      for await (const chunk of baseStreamChat(req, signal)) {
        if (chunk.content && Date.now() - lastDeltaAt > 200) {
          lastDeltaAt = Date.now();
          emit({ type: 'trial_delta', ...trialMeta, text: chunk.content.slice(0, 500) });
        }
        yield chunk;
      }
    };

    const sampler = new ResourceSampler({
      baseUrl: snapshot.baseUrl,
      model: snapshot.model,
      isOllama: snapshot.provider === 'ollama',
    });

    const startedAt = new Date().toISOString();
    let result: SolverResult;
    try {
      sampler.start();
      const ctx: SolverContext = {
        runId,
        candidate: snapshot,
        runtime,
        apiKey,
        pack,
        sample,
        epoch: item.epochSlot,
        rotation: item.rotation,
        streamChat,
        signal: this.aborter?.signal ?? new AbortController().signal,
        timeoutMs: item.timeoutMs,
        sampler,
        emit: (e) => this.emit(e),
      };
      let solver;
      try {
        solver = getSolver(pack.manifest.kind);
      } catch {
        await this.storeSkipped(runId, candidate, pack, sampleId, item, startedAt, 'skipped_unsupported', 'solver-missing');
        return;
      }
      const { result: solved } = await withTimeout(
        (signal) => solver({ ...ctx, signal }),
        item.timeoutMs,
        this.aborter?.signal,
      );
      result = solved;
    } catch (err) {
      const timedOut =
        err instanceof Error && err.message.includes('eval trial timeout');
      const outcome = this.skipCandidateId !== null || this.cancelled ? 'cancelled' : classifyOutcome(err, timedOut);
      await this.storeFailed(runId, candidate, pack, sampleId, item, startedAt, outcome);
      if (outcome === 'timeout') {
        this.consecutiveTimeouts += 1;
        const budgetSec = Math.round(item.timeoutMs / 1000);
        this.emit({
          type: 'log',
          level: 'info',
          message: `timeout on ${pack.manifest.id}/${sampleId} (budget ${budgetSec}s) — trial recorded, continuing with the next item`,
        });
        if (this.consecutiveTimeouts === 3 || this.consecutiveTimeouts % 5 === 0) {
          this.emit({
            type: 'log',
            level: 'warn',
            message: `${this.consecutiveTimeouts} consecutive timeouts — the model may be overloaded or too slow; consider a smaller pack tier, a larger timeout multiplier, or "후보 건너뛰기"`,
          });
        }
      } else {
        this.consecutiveTimeouts = 0;
      }
      return;
    } finally {
      sampler.stop();
    }

    const summary = sampler.stop();
    const trialId = crypto.randomUUID();
    const finishedAt = new Date().toISOString();
    const trial: EvalTrialRow = {
      id: trialId,
      runId,
      candidateId: candidate.id,
      packId: pack.manifest.id,
      sampleId,
      epoch: item.epochSlot,
      outcome: result.outcome,
      outputText: result.outputText,
      reasoningText: result.reasoningText ?? null,
      transcriptJson: result.transcript ? JSON.stringify(result.transcript) : null,
      finalStateJson: result.finalState ? JSON.stringify(result.finalState) : null,
      extraJson: JSON.stringify({
        ...(result.extra ?? {}),
        rotation: item.rotation,
        rotations: item.rotations,
      }),
      inputTokens: result.usage.input ?? result.timing.inputTokens ?? null,
      outputTokens: result.usage.output ?? result.timing.outputTokens ?? null,
      thinkingTokens: result.usage.thinking ?? result.timing.thinkingTokens ?? null,
      ttftMs: result.timing.ttftMs,
      prefillTps: result.timing.prefillTps,
      decodeTps: result.timing.decodeTps,
      totalMs: result.timing.totalMs,
      timingSource: result.timing.timingSource,
      cacheHit: result.timing.cacheHit,
      vramPeakMb: summary.vramPeakMb,
      gpuUtilAvg: summary.gpuUtilAvg,
      gpuTempMax: summary.gpuTempMax,
      offloadRatio: summary.offloadRatio,
      turns: result.turns ?? null,
      toolCalls: result.toolCalls.length,
      startedAt,
      finishedAt,
    };
    await upsertTrial(trial);

    // Synchronous scorers only (judge/code/logprob handled by their passes).
    const specs: ScorerSpec[] = sample.scorers ?? pack.manifest.scorers;
    const scored: Array<{ spec: ScorerSpec; result: ScorerResult }> = [];
    for (const spec of specs) {
      let scorer;
      try {
        scorer = getScorer(spec.type);
      } catch {
        this.emit({ type: 'log', level: 'warn', message: `unknown scorer: ${spec.type}` });
        continue;
      }
      if (scorer.requiresAsync) continue;
      try {
        const r = await scorer.score(
          {
            sample,
            pack: pack.manifest,
            outputText: result.outputText,
            reasoningText: result.reasoningText,
            toolCalls: result.toolCalls,
            transcript: result.transcript,
            finalState: result.finalState,
            extra: result.extra,
          },
          spec.options,
          { signal: this.aborter?.signal ?? new AbortController().signal },
        );
        scored.push({ spec, result: r });
        await upsertScores([
          {
            id: crypto.randomUUID(),
            trialId,
            scorerKey: scorerKeyOf(spec),
            scorerType: spec.type,
            value: r.value,
            verdict: r.verdict,
            reason: r.reason,
            extracted: r.extracted ?? null,
            judgeRaw: null,
            source: 'auto',
            createdAt: new Date().toISOString(),
          },
        ]);
      } catch (err) {
        await upsertScores([
          {
            id: crypto.randomUUID(),
            trialId,
            scorerKey: scorerKeyOf(spec),
            scorerType: spec.type,
            value: 0,
            verdict: 'error',
            reason: err instanceof Error ? err.message : String(err),
            extracted: null,
            judgeRaw: null,
            source: 'auto',
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    }

    const combined = scored.length > 0 ? combineSampleScore(scored).value : null;
    this.consecutiveTimeouts = 0;
    this.emit({
      type: 'trial_end',
      candidateId: candidate.id,
      packId: pack.manifest.id,
      sampleId,
      epoch: item.epochSlot,
      outcome: result.outcome,
      score: combined,
    });
    this.progressLog?.record(
      makeRecord(runId, {
        kind: 'trial_finished',
        candidateId: candidate.id,
        packId: pack.manifest.id,
        sampleId,
        epoch: item.epochSlot,
        outcome: result.outcome,
        score: combined,
        timing: {
          ttftMs: result.timing.ttftMs,
          prefillTps: result.timing.prefillTps,
          decodeTps: result.timing.decodeTps,
          totalMs: result.timing.totalMs,
        },
        resources: {
          vramPeakMb: summary.vramPeakMb,
          gpuUtilAvg: summary.gpuUtilAvg,
          gpuTempMax: summary.gpuTempMax,
          offloadRatio: summary.offloadRatio,
        },
        turns: result.turns ?? null,
        toolCalls: result.toolCalls.length,
      }),
    );
    const latest = sampler.latest();
    if (latest) {
      this.emit({
        type: 'resource',
        vramUsedMb: latest.vramUsedMb,
        gpuUtilPct: latest.gpuUtilPct,
        gpuTempC: latest.gpuTempC,
        decodeTps: result.timing.decodeTps,
      });
    }
  }

  private async storeSkipped(
    runId: string,
    candidate: EvalCandidateRow,
    pack: LoadedPack,
    sampleId: string,
    item: TrialPlanItem,
    startedAt: string,
    outcome: TrialOutcome,
    note: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await upsertTrial({
      id: crypto.randomUUID(),
      runId,
      candidateId: candidate.id,
      packId: pack.manifest.id,
      sampleId,
      epoch: item.epochSlot,
      outcome,
      outputText: note,
      reasoningText: null,
      transcriptJson: null,
      finalStateJson: null,
      extraJson: null,
      inputTokens: null,
      outputTokens: null,
      thinkingTokens: null,
      ttftMs: null,
      prefillTps: null,
      decodeTps: null,
      totalMs: null,
      timingSource: null,
      cacheHit: null,
      vramPeakMb: null,
      gpuUtilAvg: null,
      gpuTempMax: null,
      offloadRatio: null,
      turns: null,
      toolCalls: null,
      startedAt,
      finishedAt: now,
    });
    this.emit({
      type: 'trial_end',
      candidateId: candidate.id,
      packId: pack.manifest.id,
      sampleId,
      epoch: item.epochSlot,
      outcome,
      score: null,
    });
    this.progressLog?.record(
      makeRecord(runId, {
        kind: 'trial_finished',
        candidateId: candidate.id,
        packId: pack.manifest.id,
        sampleId,
        epoch: item.epochSlot,
        outcome,
        score: null,
        timing: { ttftMs: null, prefillTps: null, decodeTps: null, totalMs: null },
        resources: { vramPeakMb: null, gpuUtilAvg: null, gpuTempMax: null, offloadRatio: null },
        turns: null,
        toolCalls: null,
      }),
    );
  }

  private async storeFailed(
    runId: string,
    candidate: EvalCandidateRow,
    pack: LoadedPack,
    sampleId: string,
    item: TrialPlanItem,
    startedAt: string,
    outcome: TrialOutcome,
  ): Promise<void> {
    await this.storeSkipped(runId, candidate, pack, sampleId, item, startedAt, outcome, outcome);
  }

  private async aggregate(
    runId: string,
    config: EvalRunConfig,
    candidates: EvalCandidateRow[],
    packs: LoadedPack[],
    hardware: HardwareFingerprint,
  ): Promise<void> {
    const trials = await listTrials(runId);
    const scores = await listScores(runId);
    const { rows } = aggregateRun({
      runId,
      config,
      candidates: candidates.map((c) => ({
        id: c.id,
        label: c.label,
        snapshot: c.snapshot,
        loadMs: c.loadMs,
      })),
      trials,
      scores,
      packs: packs.map((p) => p.manifest),
      hardware,
    });
    await replaceAggregates(runId, rows);
  }
}

export function registerRunnerSolvers(): void {
  registerSingleTurnSolver();
  registerToolCallSolver();
  registerPerfProbeSolver();
  registerCompactionAdapter();
}

export function registerCompactionAdapter(): void {
  registerSolver(COMPACTION_RECALL_KIND, async (ctx) => {
    const startedAt = performance.now();
    const result = await compactionRecallSolver({
      candidate: ctx.candidate,
      sample: ctx.sample,
      streamChat: ctx.streamChat,
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
      sampler: ctx.sampler,
      emit: ctx.emit,
    });
    const extra: Record<string, unknown> = { compactionMs: result.extra.compactionMs };
    return {
      outcome: 'ok' as const,
      outputText: result.outputText,
      toolCalls: [],
      extra,
      usage: {},
      timing: {
        ttftMs: null,
        prefillTps: null,
        decodeTps: null,
        totalMs: performance.now() - startedAt,
        timingSource: 'client' as const,
        cacheHit: null,
        inputTokens: null,
        outputTokens: null,
        thinkingTokens: null,
      },
      turns: 1,
    };
  });
}
