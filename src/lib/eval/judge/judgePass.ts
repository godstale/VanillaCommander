import {
  getModelArchitectureInfo,
} from '@/lib/llm/ollamaClient';
import { resolveAgentLlmRuntime } from '@/lib/llm/providers';
import {
  getStreamChatFn,
  type LlmChatRequest,
  type LlmStreamChatFn,
} from '@/lib/llm/providerRuntime';
import * as evalRepo from '@/lib/db/repositories/evalRepo';
import { loadPack, listPacks, type LoadedPack } from '../packs/packLoader';
import { tauriPackFs } from '../packs/packFs';
import { unloadOllamaModel } from '../runner/timing';
import { scorerKeyOf } from '../scorers/index';
import '../scorers/llmJudge';
import { fitBradleyTerry, type BradleyTerryMatch } from '../stats/bradleyTerry';
import type {
  DataClass,
  EvalCandidateRow,
  EvalRunConfig,
  EvalSample,
  EvalScoreRow,
  EvalTrialRow,
  JudgeConfig,
  ScorerSpec,
  ScorerType,
  Verdict,
} from '../types';
import { JUDGE_REASK_SUFFIX, PairwiseVerdictSchema, RubricVerdictSchema, parseJudgeOutputWithRetry } from './parse';
import { JUDGE_PROMPT_VERSION, buildPairwisePrompt, buildRubricPrompt } from './prompts';
import {
  callIntegration as defaultCallIntegration,
  type ExternalCallResult,
} from '../integrations/gateway';

/** Fixed seed for deterministic judging (temperature is always 0). */
export const JUDGE_SEED = 42;

const JUDGE_SCORER_TYPES: ScorerType[] = ['llm_judge_rubric', 'llm_judge_pairwise'];

export interface JudgePassResult {
  judgedTrials: number;
  scoresWritten: number;
  skippedSelf: number;
  errors: number;
}

type RepoDeps = Pick<
  typeof evalRepo,
  'getRun' | 'listCandidates' | 'listTrials' | 'listScores' | 'upsertScores'
>;

export interface JudgePassDeps {
  streamChatFactory?: (judge: JudgeConfig) => LlmStreamChatFn;
  callIntegration?: (
    integrationId: string,
    req: Parameters<typeof defaultCallIntegration>[1],
    signal?: AbortSignal,
  ) => Promise<ExternalCallResult>;
  loadPacks?: (config: EvalRunConfig, workspaceRoot?: string) => Promise<LoadedPack[]>;
  getFamily?: (baseUrl: string | undefined, model: string) => Promise<string | null>;
  unloadModel?: (baseUrl: string, model: string) => Promise<void>;
  workspaceRoot?: string;
  repo?: RepoDeps;
  signal?: AbortSignal;
}

function defaultStreamChatFactory(judge: JudgeConfig): LlmStreamChatFn {
  if (judge.target.type !== 'local') {
    throw new Error('streamChatFactory requires a local judge target');
  }
  const runtime = resolveAgentLlmRuntime(
    { llmProvider: judge.target.provider, llmBaseUrl: judge.target.baseUrl },
    undefined,
  );
  return getStreamChatFn({ openAiCompatible: runtime.openAiCompatible });
}

async function defaultLoadPacks(
  config: EvalRunConfig,
  workspaceRoot?: string,
): Promise<LoadedPack[]> {
  const fs = tauriPackFs;
  const { refs } = await listPacks(fs, workspaceRoot);
  const out: LoadedPack[] = [];
  for (const p of config.packs) {
    const ref = refs.find((r) => r.scope === p.scope && r.manifest.id === p.packId);
    if (ref) out.push(await loadPack(fs, ref, workspaceRoot));
  }
  return out;
}

async function defaultGetFamily(
  baseUrl: string | undefined,
  model: string,
): Promise<string | null> {
  try {
    const info: Awaited<ReturnType<typeof getModelArchitectureInfo>> =
      await getModelArchitectureInfo(baseUrl, model);
    return info.architecture.toLowerCase();
  } catch {
    return null;
  }
}

async function collectText(
  fn: LlmStreamChatFn,
  req: LlmChatRequest,
  signal?: AbortSignal,
): Promise<string> {
  let text = '';
  for await (const chunk of fn(req, signal)) {
    if (chunk.content) text += chunk.content;
  }
  return text;
}

/**
 * Data classes declared for an integration judge call.
 * Builtin packs carry bundled (public) content; personal Q9 packs and
 * user/project packs may carry personal content; samples with fixtures
 * additionally carry fixture files.
 */
export function judgeDataClasses(pack: LoadedPack): DataClass[] {
  const personal = pack.scope !== 'builtin' || pack.manifest.category === 'Q9';
  const classes: DataClass[] = personal ? ['personal'] : ['public-bundled'];
  if (pack.samples.some((s) => s.fixture !== undefined)) {
    classes.push('fixture-files');
  }
  return classes;
}

export function normalizeModelTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/** Same model tag (case-insensitive) means the judge would grade itself. */
export function isSelfJudging(candidateModel: string, judgeModel: string): boolean {
  return normalizeModelTag(candidateModel) === normalizeModelTag(judgeModel);
}

function questionText(sample: EvalSample): string {
  if (typeof sample.input === 'string') return sample.input;
  return sample.input.map((m) => `${m.role}: ${m.content}`).join('\n');
}

function targetText(sample: EvalSample): string | null {
  if (sample.reference !== undefined && sample.reference !== '') return sample.reference;
  const t = sample.target;
  if (typeof t === 'string' || typeof t === 'number') return String(t);
  if (Array.isArray(t) && t.length > 0) return t.join('\n');
  return null;
}

export function normalizeRubricScore(score: number, scale: '1-5' | '1-10'): number {
  const max = scale === '1-5' ? 5 : 10;
  const clamped = Math.min(Math.max(score, 1), max);
  return (clamped - 1) / (max - 1);
}

function valueToVerdict(value: number): Verdict {
  if (value >= 0.75) return 'correct';
  if (value >= 0.4) return 'partial';
  return 'incorrect';
}

interface JudgeCaller {
  /** Stable label recorded in score reasons (model tag or integration id). */
  label: string;
  call(prompt: string): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
}

function makeCaller(
  judge: JudgeConfig,
  pack: LoadedPack,
  runId: string,
  factory: (judge: JudgeConfig) => LlmStreamChatFn,
  callIntegration: NonNullable<JudgePassDeps['callIntegration']>,
  signal?: AbortSignal,
): JudgeCaller {
  if (judge.target.type === 'integration') {
    const integrationId = judge.target.integrationId;
    return {
      label: `integration:${integrationId}`,
      call: async (prompt: string) => {
        const res = await callIntegration(
          integrationId,
          {
            purpose: 'judge',
            dataClasses: judgeDataClasses(pack),
            runId,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
          },
          signal,
        );
        if (res.ok) return { ok: true as const, text: res.text };
        return { ok: false as const, error: res.error ?? res.reasonKey };
      },
    };
  }
  // Lazily created on first use so skipped-only passes never load a model.
  let chat: LlmStreamChatFn | null = null;
  const { baseUrl, model } = judge.target;
  return {
    label: model,
    call: async (prompt: string) => {
      try {
        if (!chat) chat = factory(judge);
        const text = await collectText(
          chat,
          {
            baseUrl,
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            seed: JUDGE_SEED,
          },
          signal,
        );
        return { ok: true as const, text };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

interface ReasonBase {
  promptVersion: string;
  judgeModel: string;
  warning?: string;
  [key: string]: unknown;
}

function reasonText(base: ReasonBase): string {
  return JSON.stringify(base);
}

function makeScoreRow(
  trialId: string,
  spec: ScorerSpec,
  value: number,
  verdict: Verdict,
  reason: string,
  judgeRaw: string | null,
): EvalScoreRow {
  return {
    id: crypto.randomUUID(),
    trialId,
    scorerKey: scorerKeyOf(spec),
    scorerType: spec.type,
    value,
    verdict,
    reason,
    extracted: null,
    judgeRaw,
    source: 'judge',
    createdAt: new Date().toISOString(),
  };
}

interface TrialWork {
  trial: EvalTrialRow;
  pack: LoadedPack;
  sample: EvalSample;
  candidate: EvalCandidateRow | undefined;
  rubricSpecs: ScorerSpec[];
  pairwiseSpecs: ScorerSpec[];
}

function specsForTrial(
  trial: EvalTrialRow,
  pack: LoadedPack,
  existingJudgeKeys: Set<string>,
): TrialWork | null {
  const sample = pack.samples.find((s) => s.id === trial.sampleId);
  if (!sample) return null;
  const specs = sample.scorers ?? pack.manifest.scorers;
  const missing = specs.filter(
    (s) =>
      JUDGE_SCORER_TYPES.includes(s.type) &&
      !existingJudgeKeys.has(`${trial.id}::${scorerKeyOf(s)}`),
  );
  if (missing.length === 0) return null;
  return {
    trial,
    pack,
    sample,
    candidate: undefined,
    rubricSpecs: missing.filter((s) => s.type === 'llm_judge_rubric'),
    pairwiseSpecs: missing.filter((s) => s.type === 'llm_judge_pairwise'),
  };
}

interface PassState {
  judge: JudgeConfig;
  pending: EvalScoreRow[];
  result: JudgePassResult;
  counted: Set<string>;
  callerCache: Map<string, JudgeCaller>;
  familyCache: Map<string, string | null>;
  factory: (judge: JudgeConfig) => LlmStreamChatFn;
  callIntegration: NonNullable<JudgePassDeps['callIntegration']>;
  getFamily: NonNullable<JudgePassDeps['getFamily']>;
  signal?: AbortSignal;
  runId: string;
  judgeModelTag: string | null;
}

function callerFor(state: PassState, pack: LoadedPack): JudgeCaller {
  const key = pack.manifest.id;
  const existing = state.callerCache.get(key);
  if (existing) return existing;
  const caller = makeCaller(state.judge, pack, state.runId, state.factory, state.callIntegration, state.signal);
  state.callerCache.set(key, caller);
  return caller;
}

function markJudged(state: PassState, trialId: string): void {
  if (!state.counted.has(trialId)) {
    state.counted.add(trialId);
    state.result.judgedTrials += 1;
  }
}

async function familyWarning(state: PassState, work: TrialWork): Promise<string | undefined> {
  if (state.judgeModelTag === null || state.judge.target.type !== 'local') return undefined;
  const candidateModel = work.candidate?.snapshot.model;
  if (!candidateModel || isSelfJudging(candidateModel, state.judgeModelTag)) return undefined;
  const baseUrl = state.judge.target.baseUrl;
  const cached = async (model: string): Promise<string | null> => {
    const key = normalizeModelTag(model);
    if (!state.familyCache.has(key)) {
      state.familyCache.set(key, await state.getFamily(baseUrl, model));
    }
    return state.familyCache.get(key) ?? null;
  };
  const [cf, jf] = await Promise.all([cached(candidateModel), cached(state.judgeModelTag)]);
  return cf !== null && jf !== null && cf === jf ? 'same-family (possible bias)' : undefined;
}

async function reaskWith(caller: JudgeCaller, prompt: string): Promise<string> {
  const retry = await caller.call(`${prompt}${JUDGE_REASK_SUFFIX}`);
  if (!retry.ok) throw new Error(retry.error);
  return retry.text;
}

async function judgeRubric(
  state: PassState,
  work: TrialWork,
  spec: ScorerSpec,
): Promise<void> {
  const output = work.trial.outputText ?? '';
  const caller = callerFor(state, work.pack);
  const base = { promptVersion: JUDGE_PROMPT_VERSION, judgeModel: caller.label };
  if (output.trim() === '') {
    state.pending.push(
      makeScoreRow(work.trial.id, spec, 0, 'no_answer',
        reasonText({ ...base, note: 'empty-output' }), null),
    );
    return;
  }
  const prompt =
    `${buildRubricPrompt({
      question: questionText(work.sample),
      reference: targetText(work.sample) ?? undefined,
      rubric: work.sample.rubric ?? '',
      scale: state.judge.scale,
    })}\n${output}`;
  const first = await caller.call(prompt);
  if (!first.ok) {
    state.result.errors += 1;
    state.pending.push(
      makeScoreRow(work.trial.id, spec, 0, 'error',
        reasonText({ ...base, error: first.error }), null),
    );
    return;
  }
  const parsed = await parseJudgeOutputWithRetry(first.text, RubricVerdictSchema, () =>
    reaskWith(caller, prompt),
  );
  if (!parsed.ok) {
    state.result.errors += 1;
    state.pending.push(
      makeScoreRow(work.trial.id, spec, 0, 'error',
        reasonText({ ...base, error: `parse-failed: ${parsed.error}` }), parsed.raw),
    );
    return;
  }
  const value = normalizeRubricScore(parsed.value.overall, state.judge.scale);
  const warning = await familyWarning(state, work);
  state.pending.push(
    makeScoreRow(work.trial.id, spec, value, valueToVerdict(value),
      reasonText({
        ...base,
        scale: state.judge.scale,
        overall: parsed.value.overall,
        criteria: parsed.value.criteria,
        ...(warning !== undefined ? { warning } : {}),
      }), parsed.raw),
  );
  markJudged(state, work.trial.id);
}

async function judgePairwiseVsReference(
  state: PassState,
  work: TrialWork,
  spec: ScorerSpec,
): Promise<void> {
  const output = work.trial.outputText ?? '';
  const caller = callerFor(state, work.pack);
  const base = { promptVersion: JUDGE_PROMPT_VERSION, judgeModel: caller.label };
  if (output.trim() === '') {
    state.pending.push(
      makeScoreRow(work.trial.id, spec, 0, 'no_answer',
        reasonText({ ...base, note: 'empty-output' }), null),
    );
    return;
  }
  const reference = targetText(work.sample);
  if (reference === null) {
    state.result.errors += 1;
    state.pending.push(
      makeScoreRow(work.trial.id, spec, 0, 'error',
        reasonText({ ...base, error: 'no-reference' }), null),
    );
    return;
  }
  const question = questionText(work.sample);
  const promptAB = buildPairwisePrompt({ question, answerA: output, answerB: reference });
  const promptBA = buildPairwisePrompt({ question, answerA: reference, answerB: output });
  const [first, second] = await Promise.all([caller.call(promptAB), caller.call(promptBA)]);
  if (!first.ok || !second.ok) {
    state.result.errors += 1;
    state.pending.push(
      makeScoreRow(work.trial.id, spec, 0, 'error',
        reasonText({ ...base, error: !first.ok ? first.error : 'judge-error' }),
        first.ok ? first.text : null),
    );
    return;
  }
  const [p1, p2] = await Promise.all([
    parseJudgeOutputWithRetry(first.text, PairwiseVerdictSchema, () => reaskWith(caller, promptAB)),
    parseJudgeOutputWithRetry(second.text, PairwiseVerdictSchema, () => reaskWith(caller, promptBA)),
  ]);
  if (!p1.ok || !p2.ok) {
    state.result.errors += 1;
    const error = !p1.ok ? p1.error : 'retry-failed';
    const raw = !p1.ok ? p1.raw : null;
    state.pending.push(
      makeScoreRow(work.trial.id, spec, 0, 'error',
        reasonText({ ...base, error: `parse-failed: ${error}` }), raw),
    );
    return;
  }
  // Order-swap guard: both orderings must agree the answer wins (or loses),
  // otherwise the verdict is a tie.
  const answerWins = p1.value.winner === 'A' && p2.value.winner === 'B';
  const answerLoses = p1.value.winner === 'B' && p2.value.winner === 'A';
  const value = answerWins ? 1 : answerLoses ? 0 : 0.5;
  const verdict: Verdict = answerWins ? 'correct' : answerLoses ? 'incorrect' : 'partial';
  const warning = await familyWarning(state, work);
  state.pending.push(
    makeScoreRow(work.trial.id, spec, value, verdict,
      reasonText({
        ...base,
        firstWinner: p1.value.winner,
        firstReason: p1.value.reason,
        secondWinner: p2.value.winner,
        secondReason: p2.value.reason,
        swappedAgreement: answerWins || answerLoses,
        ...(warning !== undefined ? { warning } : {}),
      }), `${p1.raw}\n--- swapped ---\n${p2.raw}`),
  );
  markJudged(state, work.trial.id);
}

function skipSelf(state: PassState, work: TrialWork, specs: ScorerSpec[]): void {
  const caller = callerFor(state, work.pack);
  for (const spec of specs) {
    state.pending.push(
      makeScoreRow(work.trial.id, spec, 0, 'skipped',
        reasonText({
          promptVersion: JUDGE_PROMPT_VERSION,
          judgeModel: caller.label,
          note: 'self-judging prevented',
        }), null),
    );
  }
  state.result.skippedSelf += 1;
}

async function judgeRoundRobinGroup(state: PassState, group: TrialWork[]): Promise<void> {
  const pack = group[0].pack;
  const caller = callerFor(state, pack);
  const base = { promptVersion: JUDGE_PROMPT_VERSION, judgeModel: caller.label };

  for (const work of group) {
    if (isSkippedSelf(state, work)) {
      skipSelf(state, work, [...work.rubricSpecs, ...work.pairwiseSpecs]);
      continue;
    }
    for (const spec of work.rubricSpecs) {
      await judgeRubric(state, work, spec);
    }
  }

  const pairwiseWorks = group.filter(
    (w) => w.pairwiseSpecs.length > 0 && !isSkippedSelf(state, w),
  );
  if (pairwiseWorks.length === 0) return;

  const comparable = pairwiseWorks.filter((w) => (w.trial.outputText ?? '').trim() !== '');
  for (const work of pairwiseWorks) {
    if ((work.trial.outputText ?? '').trim() !== '') continue;
    for (const spec of work.pairwiseSpecs) {
      state.pending.push(
        makeScoreRow(work.trial.id, spec, 0, 'no_answer',
          reasonText({ ...base, mode: 'round-robin', note: 'empty-output' }), null),
      );
    }
  }
  if (comparable.length < 2) {
    for (const work of comparable) {
      for (const spec of work.pairwiseSpecs) {
        state.pending.push(
          makeScoreRow(work.trial.id, spec, 0, 'skipped',
            reasonText({ ...base, mode: 'round-robin', note: 'no-opponent' }), null),
        );
      }
    }
    return;
  }

  const question = questionText(group[0].sample);
  const stats = new Map<string, { wins: number; ties: number; games: number }>();
  for (const w of comparable) stats.set(w.trial.candidateId, { wins: 0, ties: 0, games: 0 });
  const matches: BradleyTerryMatch[] = [];

  for (let i = 0; i < comparable.length; i++) {
    for (let j = i + 1; j < comparable.length; j++) {
      const a = comparable[i];
      const b = comparable[j];
      const answerA = a.trial.outputText ?? '';
      const answerB = b.trial.outputText ?? '';
      const promptAB = buildPairwisePrompt({ question, answerA, answerB });
      const promptBA = buildPairwisePrompt({ question, answerA: answerB, answerB: answerA });
      const [r1, r2] = await Promise.all([caller.call(promptAB), caller.call(promptBA)]);
      if (!r1.ok || !r2.ok) {
        state.result.errors += 1;
        continue;
      }
      const [p1, p2] = await Promise.all([
        parseJudgeOutputWithRetry(r1.text, PairwiseVerdictSchema, () => reaskWith(caller, promptAB)),
        parseJudgeOutputWithRetry(r2.text, PairwiseVerdictSchema, () => reaskWith(caller, promptBA)),
      ]);
      if (!p1.ok || !p2.ok) {
        state.result.errors += 1;
        continue;
      }
      const aWins = p1.value.winner === 'A' && p2.value.winner === 'B';
      const bWins = p1.value.winner === 'B' && p2.value.winner === 'A';
      const sa = stats.get(a.trial.candidateId);
      const sb = stats.get(b.trial.candidateId);
      if (!sa || !sb) continue;
      sa.games += 1;
      sb.games += 1;
      if (aWins) {
        sa.wins += 1;
        matches.push({ a: a.trial.candidateId, b: b.trial.candidateId, winner: 'a' });
      } else if (bWins) {
        sb.wins += 1;
        matches.push({ a: a.trial.candidateId, b: b.trial.candidateId, winner: 'b' });
      } else {
        sa.ties += 1;
        sb.ties += 1;
        matches.push({ a: a.trial.candidateId, b: b.trial.candidateId, winner: 'tie' });
      }
    }
  }

  // Per-pack Bradley-Terry ratings (report-only: stored inside reason JSON).
  const bt = fitBradleyTerry(matches);

  for (const work of comparable) {
    const st = stats.get(work.trial.candidateId);
    const value = st && st.games > 0 ? (st.wins + 0.5 * st.ties) / st.games : 0;
    const verdict: Verdict = st && st.games > 0
      ? valueToVerdict(value)
      : 'error';
    const btEntry = bt !== null
      ? {
          strength: bt.strengths[work.trial.candidateId] ?? null,
          display: bt.display[work.trial.candidateId] ?? null,
          games: bt.games[work.trial.candidateId] ?? 0,
        }
      : null;
    const warning = await familyWarning(state, work);
    for (const spec of work.pairwiseSpecs) {
      state.pending.push(
        makeScoreRow(work.trial.id, spec, value, verdict,
          reasonText({
            ...base,
            mode: 'round-robin',
            wins: st?.wins ?? 0,
            ties: st?.ties ?? 0,
            games: st?.games ?? 0,
            bt: btEntry,
            ...(warning !== undefined ? { warning } : {}),
          }), null),
      );
    }
    markJudged(state, work.trial.id);
  }
}

function isSkippedSelf(state: PassState, work: TrialWork): boolean {
  return (
    state.judgeModelTag !== null &&
    work.candidate !== undefined &&
    isSelfJudging(work.candidate.snapshot.model, state.judgeModelTag)
  );
}

/**
 * LLM-judge pass over a completed run. Finds trials whose pack/sample
 * scorers include llm_judge_* but lack source='judge' scores, grades them
 * with the configured judge, and persists source='judge' rows carrying
 * judge_raw plus promptVersion/model in the reason JSON.
 */
export async function runJudgePass(runId: string, deps: JudgePassDeps = {}): Promise<JudgePassResult> {
  const repo: RepoDeps = deps.repo ?? evalRepo;
  const result: JudgePassResult = { judgedTrials: 0, scoresWritten: 0, skippedSelf: 0, errors: 0 };
  const run = await repo.getRun(runId);
  const judge = run?.config.judge ?? null;
  if (!run || !judge) return result;

  const state: PassState = {
    judge,
    pending: [],
    result,
    counted: new Set(),
    callerCache: new Map(),
    familyCache: new Map(),
    factory: deps.streamChatFactory ?? defaultStreamChatFactory,
    callIntegration: deps.callIntegration ?? defaultCallIntegration,
    getFamily: deps.getFamily ?? defaultGetFamily,
    signal: deps.signal,
    runId,
    judgeModelTag: judge.target.type === 'local' ? judge.target.model : null,
  };

  const packs = await (deps.loadPacks ?? defaultLoadPacks)(run.config, deps.workspaceRoot);
  const packById = new Map(packs.map((p) => [p.manifest.id, p]));
  const candidates = await repo.listCandidates(runId);
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const trials = await repo.listTrials(runId);
  const scores = await repo.listScores(runId);
  const existingJudgeKeys = new Set(
    scores.filter((s) => s.source === 'judge').map((s) => `${s.trialId}::${s.scorerKey}`),
  );

  const works: TrialWork[] = [];
  for (const trial of trials) {
    const pack = packById.get(trial.packId);
    if (!pack) continue;
    const work = specsForTrial(trial, pack, existingJudgeKeys);
    if (!work) continue;
    work.candidate = candidateById.get(trial.candidateId);
    works.push(work);
  }
  if (works.length === 0) return result;

  // Free candidate VRAM before loading the judge model (local target).
  if (judge.target.type === 'local') {
    const unload = deps.unloadModel ?? unloadOllamaModel;
    const seen = new Set<string>();
    for (const w of works) {
      const snap = w.candidate?.snapshot;
      if (snap?.provider !== 'ollama' || !snap.baseUrl || !snap.model) continue;
      if (state.judgeModelTag !== null && isSelfJudging(snap.model, state.judgeModelTag)) continue;
      const key = `${snap.baseUrl}\n${normalizeModelTag(snap.model)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await unload(snap.baseUrl, snap.model).catch(() => undefined);
    }
  }

  if (judge.pairwise === 'round-robin') {
    const groups = new Map<string, TrialWork[]>();
    for (const work of works) {
      const key = `${work.pack.manifest.id}\n${work.sample.id}`;
      const arr = groups.get(key);
      if (arr) arr.push(work);
      else groups.set(key, [work]);
    }
    for (const group of groups.values()) {
      await judgeRoundRobinGroup(state, group);
    }
  } else {
    for (const work of works) {
      if (isSkippedSelf(state, work)) {
        skipSelf(state, work, [...work.rubricSpecs, ...work.pairwiseSpecs]);
        continue;
      }
      for (const spec of work.rubricSpecs) {
        await judgeRubric(state, work, spec);
      }
      if (judge.pairwise === 'vs-reference') {
        for (const spec of work.pairwiseSpecs) {
          await judgePairwiseVsReference(state, work, spec);
        }
      } else {
        // Pairwise spec configured but the judge runs single mode:
        // record as skipped rather than silently dropping.
        for (const spec of work.pairwiseSpecs) {
          const caller = callerFor(state, work.pack);
          state.pending.push(
            makeScoreRow(work.trial.id, spec, 0, 'skipped',
              reasonText({
                promptVersion: JUDGE_PROMPT_VERSION,
                judgeModel: caller.label,
                note: 'pairwise-none',
              }), null),
          );
          markJudged(state, work.trial.id);
        }
      }
    }
  }

  if (state.pending.length > 0) {
    await repo.upsertScores(state.pending);
    result.scoresWritten = state.pending.length;
  }
  return result;
}
