import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { listen } from '@tauri-apps/api/event';
import { fcCancel, fcResolveConflict } from './ipc';
import { JobsContext } from './jobsContext';
import type {
  ConflictDecision,
  FcConflict,
  FcJob,
  FcJobKind,
  FcProgressEvent,
} from './types';

function emptyJob(id: string, kind: FcJobKind, label: string): FcJob {
  return {
    id,
    kind,
    label,
    status: 'running',
    doneFiles: 0,
    totalFiles: null,
    doneBytes: 0,
    totalBytes: null,
    error: null,
    result: null,
    matches: [],
    startedAt: Date.now(),
  };
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<FcJob[]>([]);
  const [conflicts, setConflicts] = useState<FcConflict[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<FcProgressEvent>('fc://progress', (event) => {
      const e = event.payload;
      const id = e.job_id;
      switch (e.kind) {
        case 'progress':
          setJobs((prev) =>
            prev.map((j) =>
              j.id === id
                ? {
                    ...j,
                    doneFiles: e.done_files,
                    totalFiles: e.total_files,
                    doneBytes: e.done_bytes,
                    totalBytes: e.total_bytes,
                  }
                : j,
            ),
          );
          break;
        case 'match':
          setJobs((prev) =>
            prev.map((j) => (j.id === id ? { ...j, matches: [...j.matches, e.m] } : j)),
          );
          break;
        case 'done':
          setJobs((prev) =>
            prev.map((j) => (j.id === id ? { ...j, status: 'done', result: e.result } : j)),
          );
          setConflicts((prev) => prev.filter((c) => c.jobId !== id));
          break;
        case 'error':
          setJobs((prev) =>
            prev.map((j) =>
              j.id === id ? { ...j, status: 'error', error: e.message } : j,
            ),
          );
          setConflicts((prev) => prev.filter((c) => c.jobId !== id));
          break;
        case 'cancelled':
          setJobs((prev) =>
            prev.map((j) => (j.id === id ? { ...j, status: 'cancelled' } : j)),
          );
          setConflicts((prev) => prev.filter((c) => c.jobId !== id));
          break;
        case 'conflict':
          setConflicts((prev) => {
            if (prev.some((c) => c.jobId === id && c.conflictId === e.conflict_id)) {
              return prev;
            }
            return [
              ...prev,
              {
                jobId: id,
                conflictId: e.conflict_id,
                path: e.path,
                suggestedName: e.suggested_name,
              },
            ];
          });
          break;
        default:
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const registerJob = useCallback((id: string, kind: FcJobKind, label: string) => {
    setJobs((prev) => (prev.some((j) => j.id === id) ? prev : [...prev, emptyJob(id, kind, label)]));
  }, []);

  const cancelJob = useCallback(async (id: string) => {
    try {
      await fcCancel(id);
    } catch {
      // 이미 끝난 job일 수 있다.
    }
  }, []);

  const resolveConflict = useCallback(
    async (jobId: string, conflictId: number, decision: ConflictDecision, applyToAll: boolean) => {
      await fcResolveConflict(jobId, conflictId, decision, applyToAll);
      // 답변한 항목은 항상 목록에서 뺀다. applyToAll이면 이후 충돌은
      // 워커가 저장된 기본값으로 처리해 새로 올라오지 않는다.
      setConflicts((prev) => prev.filter((c) => !(c.jobId === jobId && c.conflictId === conflictId)));
    },
    [],
  );

  const dismissJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status === 'running'));
  }, []);

  const value = useMemo(
    () => ({ jobs, conflicts, registerJob, cancelJob, resolveConflict, dismissJob, clearFinished }),
    [jobs, conflicts, registerJob, cancelJob, resolveConflict, dismissJob, clearFinished],
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}
