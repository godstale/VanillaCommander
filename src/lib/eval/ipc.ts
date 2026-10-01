import { invoke } from '@tauri-apps/api/core';
import type { PackScope } from '@/lib/eval/types';

export interface EvalPackListEntry {
  pack_id: string;
  manifest_text: string;
}

export interface EvalPackFileInput {
  relPath: string;
  content: string;
}

export interface EvalSnapshotEntry {
  path: string;
  size: number;
  is_text: boolean;
  content: string | null;
  modified_ms: number;
}

export interface EvalRuntimeInfo {
  path: string | null;
  version: string | null;
}

export interface EvalRuntimesInfo {
  python: EvalRuntimeInfo | null;
  node: EvalRuntimeInfo | null;
}

export interface EvalPythonRunResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  duration_ms: number;
}

export type EvalDownloadScope = Extract<PackScope, 'user' | 'project'>;

export function evalListPacks(
  scope: PackScope,
  workspaceRoot?: string,
): Promise<EvalPackListEntry[]> {
  return invoke<EvalPackListEntry[]>('eval_list_packs', { scope, workspaceRoot });
}

export function evalReadPackFile(
  scope: PackScope,
  packId: string,
  relPath: string,
  workspaceRoot?: string,
): Promise<string> {
  return invoke<string>('eval_read_pack_file', {
    scope,
    packId,
    relPath,
    workspaceRoot,
  });
}

export function evalWritePackFiles(
  scope: PackScope,
  packId: string,
  files: EvalPackFileInput[],
  workspaceRoot?: string,
): Promise<void> {
  return invoke<void>('eval_write_pack_files', {
    scope,
    packId,
    files: files.map((f) => ({ rel_path: f.relPath, content: f.content })),
    workspaceRoot,
  });
}

export function evalDeletePack(
  scope: PackScope,
  packId: string,
  workspaceRoot?: string,
): Promise<void> {
  return invoke<void>('eval_delete_pack', { scope, packId, workspaceRoot });
}

export function evalSandboxCreate(
  scope: PackScope,
  packId: string,
  fixtureRelDir: string,
  workspaceRoot?: string,
): Promise<string> {
  return invoke<string>('eval_sandbox_create', {
    scope,
    packId,
    fixtureRelDir,
    workspaceRoot,
  });
}

export function evalSandboxCreateFromFiles(
  files: EvalPackFileInput[],
): Promise<string> {
  return invoke<string>('eval_sandbox_create_from_files', {
    files: files.map((f) => ({ rel_path: f.relPath, content: f.content })),
  });
}

export function evalSandboxSnapshot(
  sandboxRoot: string,
  maxTextBytes: number,
): Promise<EvalSnapshotEntry[]> {
  return invoke<EvalSnapshotEntry[]>('eval_sandbox_snapshot', {
    sandboxRoot,
    maxTextBytes,
  });
}

export function evalSandboxDestroy(sandboxRoot: string): Promise<void> {
  return invoke<void>('eval_sandbox_destroy', { sandboxRoot });
}

export function evalSandboxCleanupAll(): Promise<number> {
  return invoke<number>('eval_sandbox_cleanup_all');
}

export function evalDetectRuntimes(): Promise<EvalRuntimesInfo> {
  return invoke<EvalRuntimesInfo>('eval_detect_runtimes');
}

export function evalRunPython(
  code: string,
  timeoutMs: number,
): Promise<EvalPythonRunResult> {
  return invoke<EvalPythonRunResult>('eval_run_python', { code, timeoutMs });
}

export function evalDownloadFile(
  url: string,
  destScope: EvalDownloadScope,
  packId: string,
  relPath: string,
): Promise<number> {
  return invoke<number>('eval_download_file', {
    url,
    destScope,
    packId,
    relPath,
  });
}

export function evalExportWrite(path: string, content: string): Promise<void> {
  return invoke<void>('eval_export_write', { path, content });
}

export function evalReadImportFile(path: string): Promise<string> {
  return invoke<string>('eval_read_import_file', { path });
}
