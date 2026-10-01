import * as evalRepo from '@/lib/db/repositories/evalRepo';
import { loadPack, listPacks, type LoadedPack } from '../packs/packLoader';
import { tauriPackFs } from '../packs/packFs';
import { getScorer, scorerKeyOf } from '../scorers/index';
import '../scorers/codeExec';
import type {
  EvalRunConfig,
  EvalScoreRow,
} from '../types';

export interface CodeExecPassResult {
  scoredTrials: number;
  scoresWritten: number;
  errors: number;
  skippedNoOutput: number;
}

type RepoDeps = Pick<
  typeof evalRepo,
  'getRun' | 'listTrials' | 'listScores' | 'upsertScores'
>;

export interface CodeExecPassDeps {
  loadPacks?: (config: EvalRunConfig, workspaceRoot?: string) => Promise<LoadedPack[]>;
  workspaceRoot?: string;
  repo?: RepoDeps;
  signal?: AbortSignal;
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

/**
 * Code-execution scoring pass over a run's trials. The trial loop skips
 * `code_exec` (requiresAsync), so without this pass code packs such as
 * fab-code-js would keep zero scores forever. JS tasks run locally in a
 * Worker; Python tasks additionally require the wizard's code-execution
 * confirmation (checked inside the scorer via `extra.confirmations`).
 *
 * Idempotent: trials that already carry a code_exec score are skipped, so
 * re-running (e.g. after "이어하기") never duplicates rows.
 */
export async function runCodeExecPass(
  runId: string,
  deps: CodeExecPassDeps = {},
): Promise<CodeExecPassResult> {
  const repo: RepoDeps = deps.repo ?? evalRepo;
  const result: CodeExecPassResult = {
    scoredTrials: 0,
    scoresWritten: 0,
    errors: 0,
    skippedNoOutput: 0,
  };
  const run = await repo.getRun(runId);
  if (!run) return result;

  const packs = await (deps.loadPacks ?? defaultLoadPacks)(run.config, deps.workspaceRoot);
  const packById = new Map(packs.map((p) => [p.manifest.id, p]));
  const trials = await repo.listTrials(runId);
  const scores = await repo.listScores(runId);
  const existingKeys = new Set(scores.map((s) => `${s.trialId}::${s.scorerKey}`));

  const pending: EvalScoreRow[] = [];
  const counted = new Set<string>();
  const signal = deps.signal ?? new AbortController().signal;

  for (const trial of trials) {
    const pack = packById.get(trial.packId);
    if (!pack) continue;
    const sample = pack.samples.find((s) => s.id === trial.sampleId);
    if (!sample) continue;
    const specs = (sample.scorers ?? pack.manifest.scorers).filter(
      (s) =>
        s.type === 'code_exec' &&
        !existingKeys.has(`${trial.id}::${scorerKeyOf(s)}`),
    );
    if (specs.length === 0) continue;
    const output = trial.outputText ?? '';
    if (output.trim() === '') {
      for (const spec of specs) {
        pending.push({
          id: crypto.randomUUID(),
          trialId: trial.id,
          scorerKey: scorerKeyOf(spec),
          scorerType: spec.type,
          value: 0,
          verdict: 'no_answer',
          reason: 'empty-output',
          extracted: null,
          judgeRaw: null,
          source: 'auto',
          createdAt: new Date().toISOString(),
        });
      }
      result.skippedNoOutput += 1;
      continue;
    }
    for (const spec of specs) {
      try {
        const scorer = getScorer(spec.type);
        const r = await scorer.score(
          {
            sample,
            pack: pack.manifest,
            outputText: output,
            reasoningText: trial.reasoningText ?? undefined,
            toolCalls: [],
            extra: { confirmations: run.config.confirmations },
          },
          spec.options ?? {},
          { signal },
        );
        pending.push({
          id: crypto.randomUUID(),
          trialId: trial.id,
          scorerKey: scorerKeyOf(spec),
          scorerType: spec.type,
          value: r.value,
          verdict: r.verdict,
          reason: r.reason,
          extracted: r.extracted ?? null,
          judgeRaw: null,
          source: 'auto',
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        result.errors += 1;
        pending.push({
          id: crypto.randomUUID(),
          trialId: trial.id,
          scorerKey: scorerKeyOf(spec),
          scorerType: spec.type,
          value: 0,
          verdict: 'error',
          reason: err instanceof Error ? err.message : String(err),
          extracted: null,
          judgeRaw: null,
          source: 'auto',
          createdAt: new Date().toISOString(),
        });
      }
    }
    if (!counted.has(trial.id)) {
      counted.add(trial.id);
      result.scoredTrials += 1;
    }
  }

  if (pending.length > 0) {
    await repo.upsertScores(pending);
    result.scoresWritten = pending.length;
  }
  return result;
}
