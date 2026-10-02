// P11-13: 파일 커맨더 공용 타입 (Rust commander_commands.rs와 대응).

export type FcEntryKind = 'file' | 'dir' | 'symlink' | 'other';

export interface FcEntry {
  name: string;
  path: string;
  kind: FcEntryKind;
  size: number;
  modified_ms: number | null;
  hidden: boolean;
  readonly: boolean;
  symlink: boolean;
  warning: boolean;
}

export interface FcSystemFolder {
  id: string;
  label: string;
  path: string;
  exists: boolean;
}

export type ConflictPolicy = 'ask' | 'overwrite' | 'skip' | 'rename';
export type ConflictDecision = 'overwrite' | 'skip' | 'rename';

export interface FcStatResult {
  paths: string[];
  file_count: number;
  dir_count: number;
  total_bytes: number;
}

export interface FcArchiveEntry {
  name: string;
  size: number;
  is_dir: boolean;
}

export interface FcSearchMatch {
  path: string;
  is_dir: boolean;
  line_number: number | null;
  line_content: string | null;
}

export interface FcOpResult {
  warning: boolean;
}

export interface FcFileBytes {
  base64: string;
  size: number;
  truncated: boolean;
}

export interface FcTextHead {
  text: string;
  size: number;
  truncated: boolean;
}

export type FcJobKind = 'copy' | 'move' | 'zip' | 'unzip' | 'stat' | 'search';
export type FcJobStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface FcJob {
  id: string;
  kind: FcJobKind;
  label: string;
  status: FcJobStatus;
  doneFiles: number;
  totalFiles: number | null;
  doneBytes: number;
  totalBytes: number | null;
  error: string | null;
  result: unknown;
  matches: FcSearchMatch[];
  startedAt: number;
}

export interface FcConflict {
  jobId: string;
  conflictId: number;
  path: string;
  suggestedName: string;
}

export type FcProgressEvent =
  | {
      kind: 'progress';
      job_id: string;
      done_files: number;
      total_files: number | null;
      done_bytes: number;
      total_bytes: number | null;
    }
  | { kind: 'done'; job_id: string; result: unknown }
  | { kind: 'error'; job_id: string; message: string }
  | { kind: 'cancelled'; job_id: string }
  | {
      kind: 'conflict';
      job_id: string;
      conflict_id: number;
      path: string;
      suggested_name: string;
    }
  | {
      kind: 'match';
      job_id: string;
      m: FcSearchMatch;
    };

export type ClipboardMode = 'copy' | 'cut';

export interface FileClipboard {
  mode: ClipboardMode;
  paths: string[];
}
