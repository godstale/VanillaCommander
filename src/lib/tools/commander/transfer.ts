// P11-24: 복사/이동 실행기 (fs_copy·fs_move 공용).
import { invoke } from '@tauri-apps/api/core';
import { awaitJobCompletion, snapshotForBackup, strArrayArg, strArg } from './common';

export type TransferConflict = 'ask' | 'overwrite' | 'skip' | 'rename';

export function parseConflict(raw: unknown): TransferConflict {
  const v = typeof raw === 'string' ? raw.toLowerCase() : 'rename';
  if (v === 'overwrite' || v === 'skip' || v === 'rename') return v;
  // 에이전트 맥락에서 'ask'는 대기 교착을 일으키므로 rename으로 흡수한다.
  return 'rename';
}

export function parseSources(obj: Record<string, unknown>): string[] {
  const sources = strArrayArg(obj, 'sources', 'source', 'paths', 'files');
  if (!sources || sources.length === 0) {
    throw new Error('fs_copy/fs_move requires non-empty sources.');
  }
  return sources;
}

export function parseDestDir(obj: Record<string, unknown>): string {
  const dest =
    strArg(obj, 'destDir', 'dest_dir', 'destination', 'dest', 'dir', 'to')?.trim() ?? '';
  if (!dest) {
    throw new Error('fs_copy/fs_move requires destDir.');
  }
  return dest;
}

function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`;
}

export interface TransferResult {
  content: string;
  details: {
    kind: 'copy' | 'move';
    sources: string[];
    destDir: string;
    conflict: TransferConflict;
    files: number;
    bytes: number;
    skipped: number;
    renamed: number;
    warning: boolean;
    backup: string[];
  };
  isError?: boolean;
}

export async function runTransfer(
  kind: 'copy' | 'move',
  sources: string[],
  destDir: string,
  conflict: TransferConflict,
  workFolder: string | undefined,
): Promise<TransferResult> {
  // D10: 이동은 원본을 없애고, 덮어쓰기는 대상을 없앤다 → 먼저 스냅샷.
  let backupTargets: string[] = [];
  if (kind === 'move') {
    backupTargets = sources;
  } else if (conflict === 'overwrite') {
    backupTargets = sources.map((s) => joinPath(destDir, baseNameOf(s)));
  }
  const backup = await snapshotForBackup(backupTargets, workFolder);

  const cmd = kind === 'copy' ? 'fc_copy' : 'fc_move';
  const jobId = await invoke<string>(cmd, { sources, destDir, conflict });
  const done = await awaitJobCompletion(jobId);
  if (!done.ok) {
    throw new Error(done.error ?? `${cmd} failed`);
  }
  const r = (done.result ?? {}) as {
    files?: number;
    bytes?: number;
    skipped?: number;
    renamed?: number;
    warning?: boolean;
  };
  const warning = r.warning === true;
  const lines = [
    `${kind === 'copy' ? 'Copied' : 'Moved'} ${sources.length} item(s) to ${destDir}.`,
    `files=${r.files ?? 0} bytes=${r.bytes ?? 0} skipped=${r.skipped ?? 0} renamed=${r.renamed ?? 0}`,
  ];
  if (backup.length > 0) {
    lines.push(`Backup snapshots: ${backup.length} item(s) under backup/.`);
  } else if (!workFolder) {
    lines.push('No work folder: backup skipped.');
  }
  if (warning) {
    lines.push('Warning: destination is under a system folder.');
  }
  return {
    content: lines.join('\n'),
    details: {
      kind,
      sources,
      destDir,
      conflict,
      files: r.files ?? 0,
      bytes: r.bytes ?? 0,
      skipped: r.skipped ?? 0,
      renamed: r.renamed ?? 0,
      warning,
      backup,
    },
  };
}
