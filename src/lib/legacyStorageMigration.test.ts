import { describe, expect, it } from 'vitest';
import { migrateLegacyStorageKeys } from './legacyStorageMigration';

describe('migrateLegacyStorageKeys', () => {
  it('renames legacy keys and keeps existing new values', () => {
    localStorage.clear();
    localStorage.setItem('fortress-theme', 'dark');
    localStorage.setItem('fortress:prompt-history:abc', '["hi"]');
    localStorage.setItem('react-resizable-panels:fortress-layout-v1', '{}');
    localStorage.setItem('fortress_known_agent_names', 'old');
    localStorage.setItem('vanilla-commander_known_agent_names', 'new');

    migrateLegacyStorageKeys(localStorage);

    expect(localStorage.getItem('vanilla-commander-theme')).toBe('dark');
    expect(localStorage.getItem('vanilla-commander:prompt-history:abc')).toBe('["hi"]');
    expect(localStorage.getItem('react-resizable-panels:vanilla-commander-layout-v1')).toBe('{}');
    expect(localStorage.getItem('vanilla-commander_known_agent_names')).toBe('new');
    expect(Object.keys(localStorage).some((k) => k.includes('fortress'))).toBe(false);
  });
});
