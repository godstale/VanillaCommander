import { invoke } from '@tauri-apps/api/core';
import type { PackScope } from '../types';

export interface PackFileListItem {
  packId: string;
  manifestText: string;
}

export interface PackFs {
  list(scope: PackScope, workspaceRoot?: string): Promise<PackFileListItem[]>;
  read(scope: PackScope, packId: string, relPath: string, workspaceRoot?: string): Promise<string>;
  write(
    scope: Exclude<PackScope, 'builtin'>,
    packId: string,
    files: Array<{ relPath: string; content: string }>,
    workspaceRoot?: string,
  ): Promise<void>;
  remove(scope: Exclude<PackScope, 'builtin'>, packId: string, workspaceRoot?: string): Promise<void>;
}

export const tauriPackFs: PackFs = {
  async list(scope, workspaceRoot) {
    // Rust serializes PackListEntry as snake_case (pack_id/manifest_text);
    // accept that shape (and camelCase, defensively) instead of trusting
    // the declared generic.
    const raw = await invoke<
      Array<{
        pack_id?: string;
        packId?: string;
        manifest_text?: string;
        manifestText?: string;
      }>
    >('eval_list_packs', {
      scope,
      workspaceRoot: workspaceRoot ?? null,
    });
    return raw.map((r) => ({
      packId: r.packId ?? r.pack_id ?? '',
      manifestText: r.manifestText ?? r.manifest_text ?? '',
    }));
  },
  read(scope, packId, relPath, workspaceRoot) {
    return invoke<string>('eval_read_pack_file', {
      scope,
      packId,
      relPath,
      workspaceRoot: workspaceRoot ?? null,
    });
  },
  write(scope, packId, files, workspaceRoot) {
    return invoke<void>('eval_write_pack_files', {
      scope,
      packId,
      files: files.map((f) => ({ rel_path: f.relPath, content: f.content })),
      workspaceRoot: workspaceRoot ?? null,
    });
  },
  remove(scope, packId, workspaceRoot) {
    return invoke<void>('eval_delete_pack', {
      scope,
      packId,
      workspaceRoot: workspaceRoot ?? null,
    });
  },
};

export function createMemoryPackFs(
  seed: Partial<Record<PackScope, Record<string, Record<string, string>>>> = {},
): PackFs {
  const store: Record<PackScope, Map<string, Map<string, string>>> = {
    builtin: new Map(),
    user: new Map(),
    project: new Map(),
  };
  for (const scope of Object.keys(seed) as PackScope[]) {
    const packs = seed[scope];
    if (!packs) continue;
    for (const [packId, files] of Object.entries(packs)) {
      store[scope].set(packId, new Map(Object.entries(files)));
    }
  }
  return {
    async list(scope) {
      const out: PackFileListItem[] = [];
      for (const [packId, files] of store[scope]) {
        const manifestText = files.get('manifest.json');
        if (manifestText !== undefined) out.push({ packId, manifestText });
      }
      return out;
    },
    async read(scope, packId, relPath) {
      const text = store[scope].get(packId)?.get(relPath);
      if (text === undefined) throw new Error(`Pack file not found: ${scope}/${packId}/${relPath}`);
      return text;
    },
    async write(scope, packId, files) {
      let pack = store[scope].get(packId);
      if (!pack) {
        pack = new Map();
        store[scope].set(packId, pack);
      }
      for (const f of files) pack.set(f.relPath, f.content);
    },
    async remove(scope, packId) {
      store[scope].delete(packId);
    },
  };
}
