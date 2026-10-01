import type { PackScope } from '@/lib/eval/types';
import {
  evalSandboxCleanupAll,
  evalSandboxCreate,
  evalSandboxCreateFromFiles,
  evalSandboxDestroy,
  evalSandboxSnapshot,
  type EvalPackFileInput,
} from '@/lib/eval/ipc';

export interface SandboxFileSnapshot {
  path: string;
  size: number;
  hash: string;
  content?: string;
}

export interface SandboxSnapshot {
  files: SandboxFileSnapshot[];
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function createSandbox(
  scope: PackScope,
  packId: string,
  fixtureRelDir: string,
  workspaceRoot?: string,
): Promise<string> {
  return evalSandboxCreate(scope, packId, fixtureRelDir, workspaceRoot);
}

export function createSandboxFromFiles(
  files: EvalPackFileInput[],
): Promise<string> {
  return evalSandboxCreateFromFiles(files);
}

export async function snapshotSandbox(
  sandboxRoot: string,
  maxTextBytes: number,
): Promise<SandboxSnapshot> {
  const entries = await evalSandboxSnapshot(sandboxRoot, maxTextBytes);
  const files: SandboxFileSnapshot[] = await Promise.all(
    entries.map(async (entry) => {
      const file: SandboxFileSnapshot = {
        path: entry.path,
        size: entry.size,
        hash: '',
      };
      if (entry.content !== null) {
        file.content = entry.content;
        file.hash = await sha256Hex(entry.content);
      }
      return file;
    }),
  );
  return { files };
}

export function destroySandbox(sandboxRoot: string): Promise<void> {
  return evalSandboxDestroy(sandboxRoot);
}

export function cleanupAllSandboxes(): Promise<number> {
  return evalSandboxCleanupAll();
}
