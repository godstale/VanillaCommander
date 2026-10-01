import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { tauriPackFs } from './packFs';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('tauriPackFs.list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps Rust snake_case entries (pack_id/manifest_text) to camelCase', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { pack_id: 'gsm8k', manifest_text: '{"id":"gsm8k"}' },
    ]);
    const items = await tauriPackFs.list('builtin');
    expect(invoke).toHaveBeenCalledWith('eval_list_packs', {
      scope: 'builtin',
      workspaceRoot: null,
    });
    expect(items).toEqual([{ packId: 'gsm8k', manifestText: '{"id":"gsm8k"}' }]);
  });

  it('still accepts camelCase entries', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { packId: 'my-pack', manifestText: '{}' },
    ]);
    const items = await tauriPackFs.list('user', 'C:/ws');
    expect(invoke).toHaveBeenCalledWith('eval_list_packs', {
      scope: 'user',
      workspaceRoot: 'C:/ws',
    });
    expect(items).toEqual([{ packId: 'my-pack', manifestText: '{}' }]);
  });
});
