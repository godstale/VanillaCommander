export type RunnerEvent =
  | { type: 'run_status'; status: string; error?: string }
  | { type: 'candidate_start'; candidateId: string; label: string }
  | { type: 'candidate_end'; candidateId: string; label: string }
  | { type: 'trial_start'; candidateId: string; packId: string; sampleId: string; epoch: number }
  | { type: 'trial_delta'; candidateId: string; packId: string; sampleId: string; text: string }
  | {
      type: 'trial_end';
      candidateId: string;
      packId: string;
      sampleId: string;
      epoch: number;
      outcome: string;
      score: number | null;
    }
  | {
      type: 'resource';
      vramUsedMb: number | null;
      gpuUtilPct: number | null;
      gpuTempC: number | null;
      decodeTps: number | null;
    }
  | { type: 'eta'; remainingSec: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };
