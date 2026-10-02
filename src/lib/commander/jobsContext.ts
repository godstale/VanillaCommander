import { createContext } from 'react';
import type { ConflictDecision, FcConflict, FcJob, FcJobKind } from './types';

export interface JobsContextValue {
  jobs: FcJob[];
  conflicts: FcConflict[];
  /** job 시작을 등록한다. 실제 실행은 fc_* 호출자가 담당한다. */
  registerJob: (id: string, kind: FcJobKind, label: string) => void;
  cancelJob: (id: string) => Promise<void>;
  resolveConflict: (jobId: string, conflictId: number, decision: ConflictDecision, applyToAll: boolean) => Promise<void>;
  dismissJob: (id: string) => void;
  clearFinished: () => void;
}

export const JobsContext = createContext<JobsContextValue | undefined>(undefined);
