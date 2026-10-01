import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BUILTIN_PROFILES } from '@/lib/eval/constants';
import { evalLock } from '@/lib/eval/evalLock';
import { collectHardware } from '@/lib/eval/runner/hardware';
import { EvalRunner } from '@/lib/eval/runner/runner';
import { tauriPackFs } from '@/lib/eval/packs/packFs';
import { listPacks, type LoadedPackRef, type PackListError } from '@/lib/eval/packs/packLoader';
import type {
  EvalProfile,
  EvalRunConfig,
  EvalRunRow,
  IntegrationSettings,
} from '@/lib/eval/types';
import {
  createRun as repoCreateRun,
  deleteRun as repoDeleteRun,
  getRun,
  insertCandidates,
  listProfiles,
  listRuns,
  renameRun as repoRenameRun,
} from '@/lib/db/repositories/evalRepo';
import { getIntegrationSettings } from '@/lib/db/repositories/integrationsRepo';
import { markInterruptedRuns } from '@/lib/db/repositories/evalRepo';
import { cleanupAllSandboxes } from '@/lib/eval/runner/sandbox';
import { runJudgePass } from '@/lib/eval/judge/judgePass';
import { runCodeExecPass } from '@/lib/eval/runner/codeExecPass';
import type { RunnerEvent } from '@/lib/eval/runner/events';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';

export interface ActiveRunnerState {
  runId: string;
  status: string;
  done: number;
  total: number;
}

export interface EvalContextValue {
  runs: EvalRunRow[];
  packs: LoadedPackRef[];
  packErrors: PackListError[];
  packsLoading: boolean;
  profiles: EvalProfile[];
  integrationSettings: IntegrationSettings | null;
  activeRunner: ActiveRunnerState | null;
  /** Live runner events for the active run (capped, cleared on start). Progress UI reads these + polls the DB. */
  events: RunnerEvent[];
  /** True after pause is requested until resume/cancel/finish. Pause applies between trials. */
  pausePending: boolean;
  refreshRuns: () => Promise<void>;
  refreshPacks: () => Promise<void>;
  createRun: (config: EvalRunConfig) => Promise<string>;
  startRun: (runId: string) => Promise<void>;
  pauseRun: () => void;
  resumeRun: () => void;
  cancelRun: () => void;
  skipCandidate: () => void;
  deleteRun: (runId: string) => Promise<void>;
  renameRun: (runId: string, name: string) => Promise<void>;
  cloneRun: (runId: string) => Promise<string>;
}

const EvalContext = createContext<EvalContextValue | null>(null);

async function fetchPackRefs(workspaceRoot: string | undefined): Promise<{ refs: LoadedPackRef[]; errors: PackListError[] }> {
  try {
    return await listPacks(tauriPackFs, workspaceRoot);
  } catch (err) {
    return { refs: [], errors: [{ scope: 'builtin', packId: '*', error: err instanceof Error ? err.message : 'list failed' }] };
  }
}

export function EvalProvider({ children }: { children: React.ReactNode }) {
  const workspace = useSafeWorkspace();
  const workspaceRoot = workspace?.workspaceRoot ?? undefined;
  const [runs, setRuns] = useState<EvalRunRow[]>([]);
  const [packs, setPacks] = useState<LoadedPackRef[]>([]);
  const [packErrors, setPackErrors] = useState<PackListError[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [customProfiles, setCustomProfiles] = useState<EvalProfile[]>([]);
  const [integrationSettings, setIntegrationSettings] = useState<IntegrationSettings | null>(null);
  const [activeRunner, setActiveRunner] = useState<ActiveRunnerState | null>(null);
  const [events, setEvents] = useState<RunnerEvent[]>([]);
  const [pausePending, setPausePending] = useState(false);
  const runnerRef = useRef<EvalRunner | null>(null);

  const refreshRuns = useCallback(async () => {
    setRuns(await listRuns({ limit: 100 }));
  }, []);

  const refreshPacks = useCallback(async () => {
    setPacksLoading(true);
    try {
      const { refs, errors } = await fetchPackRefs(workspaceRoot);
      setPacks(refs);
      setPackErrors(errors);
    } finally {
      setPacksLoading(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    let alive = true;
    async function initialLoad(): Promise<void> {
      setPacksLoading(true);
      await markInterruptedRuns().catch(() => undefined);
      await cleanupAllSandboxes().catch(() => undefined);
      const [nextRuns, nextPacks, nextProfiles, nextSettings] = await Promise.all([
        listRuns({ limit: 100 }).catch(() => [] as EvalRunRow[]),
        fetchPackRefs(workspaceRoot),
        listProfiles().catch(() => [] as EvalProfile[]),
        getIntegrationSettings().catch(() => null),
      ]);
      if (!alive) return;
      setRuns(nextRuns);
      setPacks(nextPacks.refs);
      setPackErrors(nextPacks.errors);
      setPacksLoading(false);
      setCustomProfiles(nextProfiles);
      setIntegrationSettings(nextSettings);
    }
    void initialLoad();
    return () => {
      alive = false;
    };
  }, [workspaceRoot]);

  const createRun = useCallback(
    async (config: EvalRunConfig): Promise<string> => {
      const hardware = await collectHardware();
      const runId = await repoCreateRun(config, hardware);
      await insertCandidates(runId, config.candidates);
      await refreshRuns();
      return runId;
    },
    [refreshRuns],
  );

  const startRun = useCallback(
    async (runId: string): Promise<void> => {
      if (evalLock.get()) return;
      const runner = new EvalRunner({
        workspaceRoot,
        judgePass: (id) => runJudgePass(id).then(() => undefined),
        codeExecPass: (id) => runCodeExecPass(id).then((r) => ({ scoredTrials: r.scoredTrials, scoresWritten: r.scoresWritten })),
      });
      runnerRef.current = runner;
      setEvents([]);
      setPausePending(false);
      runner.on((e) => {
        setEvents((prev) => (prev.length > 300 ? [...prev.slice(-300), e] : [...prev, e]));
        if (e.type === 'run_status') {
          setActiveRunner((prev) =>
            prev && prev.runId === runId ? { ...prev, status: e.status } : prev,
          );
          if (e.status === 'completed' || e.status === 'cancelled' || e.status === 'failed') {
            setPausePending(false);
            void refreshRuns();
          }
        } else if (e.type === 'candidate_start') {
          setActiveRunner((prev) => (prev ? prev : { runId, status: 'running', done: 0, total: 0 }));
        }
      });
      const run = await getRun(runId);
      setActiveRunner({ runId, status: 'running', done: run?.progressDone ?? 0, total: run?.progressTotal ?? 0 });
      try {
        await runner.start(runId);
      } finally {
        runnerRef.current = null;
        setActiveRunner(null);
        setPausePending(false);
        await refreshRuns();
      }
    },
    [refreshRuns, workspaceRoot],
  );

  const deleteRun = useCallback(
    async (runId: string): Promise<void> => {
      await repoDeleteRun(runId);
      await refreshRuns();
    },
    [refreshRuns],
  );

  const renameRun = useCallback(
    async (runId: string, name: string): Promise<void> => {
      await repoRenameRun(runId, name);
      await refreshRuns();
    },
    [refreshRuns],
  );

  const cloneRun = useCallback(
    async (runId: string): Promise<string> => {
      const run = await getRun(runId);
      if (!run) throw new Error(`run not found: ${runId}`);
      const hardware = await collectHardware();
      const cloned: EvalRunConfig = { ...run.config, name: `${run.config.name} (copy)` };
      const newId = await repoCreateRun(cloned, hardware);
      await insertCandidates(newId, cloned.candidates);
      await refreshRuns();
      return newId;
    },
    [refreshRuns],
  );

  const pauseRun = useCallback(() => {
    runnerRef.current?.pause();
    setPausePending(true);
  }, []);

  const resumeRun = useCallback(() => {
    runnerRef.current?.resume();
    setPausePending(false);
  }, []);

  const cancelRun = useCallback(() => {
    runnerRef.current?.cancel();
    setPausePending(false);
  }, []);

  const value = useMemo<EvalContextValue>(
    () => ({
      runs,
      packs,
      packErrors,
      packsLoading,
      profiles: [...BUILTIN_PROFILES, ...customProfiles],
      integrationSettings,
      activeRunner,
      events,
      pausePending,
      refreshRuns,
      refreshPacks,
      createRun,
      startRun,
      pauseRun,
      resumeRun,
      cancelRun,
      skipCandidate: () => runnerRef.current?.skipCurrentCandidate(),
      deleteRun,
      renameRun,
      cloneRun,
    }),
    [
      runs,
      packs,
      packErrors,
      packsLoading,
      customProfiles,
      integrationSettings,
      activeRunner,
      events,
      pausePending,
      refreshRuns,
      refreshPacks,
      createRun,
      startRun,
      pauseRun,
      resumeRun,
      cancelRun,
      deleteRun,
      renameRun,
      cloneRun,
    ],
  );

  return <EvalContext.Provider value={value}>{children}</EvalContext.Provider>;
}

export function useEval(): EvalContextValue {
  const ctx = useContext(EvalContext);
  if (!ctx) throw new Error('useEval must be used within EvalProvider');
  return ctx;
}
