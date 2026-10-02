// P11-13: fc_* 커맨드 invoke 래퍼.
import { invoke } from '@tauri-apps/api/core';
import type {
  ConflictDecision,
  ConflictPolicy,
  FcArchiveEntry,
  FcEntry,
  FcFileBytes,
  FcOpResult,
  FcStatResult,
  FcSystemFolder,
  FcTextHead,
} from './types';

export async function fcListDir(path: string, showHidden = false): Promise<FcEntry[]> {
  return invoke<FcEntry[]>('fc_list_dir', { path, showHidden });
}

export async function fcSystemFolders(): Promise<FcSystemFolder[]> {
  return invoke<FcSystemFolder[]>('fc_system_folders');
}

export async function fcStat(paths: string[]): Promise<string> {
  return invoke<string>('fc_stat', { paths });
}

export async function fcCopy(
  sources: string[],
  destDir: string,
  conflict: ConflictPolicy = 'ask',
): Promise<string> {
  return invoke<string>('fc_copy', { sources, destDir, conflict });
}

export async function fcMove(
  sources: string[],
  destDir: string,
  conflict: ConflictPolicy = 'ask',
): Promise<string> {
  return invoke<string>('fc_move', { sources, destDir, conflict });
}

export async function fcCancel(jobId: string): Promise<void> {
  return invoke<void>('fc_cancel', { jobId });
}

export async function fcResolveConflict(
  jobId: string,
  conflictId: number,
  decision: ConflictDecision,
  applyToAll: boolean,
): Promise<void> {
  return invoke<void>('fc_resolve_conflict', {
    jobId,
    conflictId,
    decision,
    applyToAll,
  });
}

export async function fcTrash(paths: string[]): Promise<FcOpResult> {
  return invoke<FcOpResult>('fc_trash', { paths });
}

export async function fcDeletePermanent(paths: string[]): Promise<FcOpResult> {
  return invoke<FcOpResult>('fc_delete_permanent', { paths });
}

export async function fcRename(path: string, newName: string): Promise<FcOpResult> {
  return invoke<FcOpResult>('fc_rename', { path, newName });
}

export async function fcMkdir(path: string): Promise<FcOpResult> {
  return invoke<FcOpResult>('fc_mkdir', { path });
}

export async function fcCreateFile(path: string): Promise<FcOpResult> {
  return invoke<FcOpResult>('fc_create_file', { path });
}

export interface FcSearchParams {
  root: string;
  namePattern?: string;
  contentQuery?: string;
  maxResults?: number;
  useGitignore?: boolean;
}

export async function fcSearch(params: FcSearchParams): Promise<string> {
  return invoke<string>('fc_search', {
    root: params.root,
    namePattern: params.namePattern ?? null,
    contentQuery: params.contentQuery ?? null,
    maxResults: params.maxResults ?? null,
    useGitignore: params.useGitignore ?? null,
  });
}

export async function fcZip(sources: string[], dest: string): Promise<string> {
  return invoke<string>('fc_zip', { sources, dest });
}

export async function fcUnzip(archive: string, destDir: string): Promise<string> {
  return invoke<string>('fc_unzip', { archive, destDir });
}

export async function fcArchiveList(archive: string): Promise<FcArchiveEntry[]> {
  return invoke<FcArchiveEntry[]>('fc_archive_list', { archive });
}

export async function fcOpenDefault(path: string): Promise<void> {
  return invoke<void>('fc_open_default', { path });
}

export async function fcReadFileBytes(path: string, maxBytes?: number): Promise<FcFileBytes> {
  return invoke<FcFileBytes>('fc_read_file_bytes', {
    path,
    maxBytes: maxBytes ?? null,
  });
}

export async function fcReadTextHead(path: string, maxBytes?: number): Promise<FcTextHead> {
  return invoke<FcTextHead>('fc_read_text_head', {
    path,
    maxBytes: maxBytes ?? null,
  });
}

export async function fcWriteBytes(path: string, base64: string): Promise<number> {
  return invoke<number>('fc_write_bytes', { path, base64 });
}

export async function fcReveal(path: string): Promise<void> {
  return invoke<void>('fc_reveal', { path });
}

export function isFcStatResult(value: unknown): value is FcStatResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.paths) &&
    typeof v.file_count === 'number' &&
    typeof v.dir_count === 'number' &&
    typeof v.total_bytes === 'number'
  );
}
