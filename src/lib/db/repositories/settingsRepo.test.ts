import { describe, expect, it, beforeEach } from 'vitest';
import { setDatabase, MemorySqlFallback } from '@/lib/db/client';
import {
  DEFAULT_APP_SETTINGS,
  getSettings,
  parseParserSettings,
  parseImageSettings,
  parseWikiSettings,
  updateSettings,
} from './settingsRepo';

describe('settingsRepo P11-04 fields', () => {
  beforeEach(() => {
    setDatabase(new MemorySqlFallback());
  });

  it('returns defaults for new fields on fresh DB', async () => {
    const s = await getSettings();
    expect(s.setupCompletedAt).toBeNull();
    expect(s.workFolder).toBeNull();
    expect(s.favorites).toEqual([]);
    expect(s.agentAllowedRoots).toEqual([]);
    expect(s.wiki.watchEnabled).toBe(false);
    expect(s.wiki.maxFileMb).toBe(20);
    expect(s.parsers.overrides).toEqual({});
    // 기존 기본값도 그대로.
    expect(s.defaultApprovalMode).toBe(DEFAULT_APP_SETTINGS.defaultApprovalMode);
  });

  it('round-trips work folder, favorites, roots, and blocks', async () => {
    const updated = await updateSettings({
      setupCompletedAt: '2026-10-02T00:00:00.000Z',
      workFolder: 'C:/work',
      favorites: ['C:/work', 'D:/data'],
      agentAllowedRoots: ['D:/data'],
      wiki: { ...DEFAULT_APP_SETTINGS.wiki, watchEnabled: true, maxFileMb: 50 },
      parsers: { overrides: { pdf: { command: 'markitdown {input}', outputMode: 'stdout' } } },
    });
    expect(updated.workFolder).toBe('C:/work');
    expect(updated.wiki.watchEnabled).toBe(true);

    const reloaded = await getSettings();
    expect(reloaded.setupCompletedAt).toBe('2026-10-02T00:00:00.000Z');
    expect(reloaded.workFolder).toBe('C:/work');
    expect(reloaded.favorites).toEqual(['C:/work', 'D:/data']);
    expect(reloaded.agentAllowedRoots).toEqual(['D:/data']);
    expect(reloaded.wiki.watchEnabled).toBe(true);
    expect(reloaded.wiki.maxFileMb).toBe(50);
    expect(reloaded.parsers.overrides.pdf?.command).toBe('markitdown {input}');
  });

  it('falls back to defaults on corrupt wiki/parser JSON', () => {
    expect(parseWikiSettings('not-json')).toEqual(DEFAULT_APP_SETTINGS.wiki);
    expect(parseWikiSettings(null)).toEqual(DEFAULT_APP_SETTINGS.wiki);
    expect(parseWikiSettings({ watchEnabled: true })).toEqual({
      ...DEFAULT_APP_SETTINGS.wiki,
      watchEnabled: true,
    });
    expect(parseParserSettings('42')).toEqual(DEFAULT_APP_SETTINGS.parsers);
    expect(parseParserSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS.parsers);
  });

  it('falls back to defaults on corrupt image JSON and fills missing fields', () => {
    expect(parseImageSettings('not-json')).toEqual(DEFAULT_APP_SETTINGS.image);
    expect(parseImageSettings('{"viewerZoomStep":0}')).toEqual(DEFAULT_APP_SETTINGS.image);
    expect(parseImageSettings('{"viewerFitOnOpen":false}')).toEqual({
      ...DEFAULT_APP_SETTINGS.image,
      viewerFitOnOpen: false,
    });
  });
});
