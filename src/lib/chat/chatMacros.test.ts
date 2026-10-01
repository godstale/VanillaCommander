import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildMacroName,
  deleteChatMacro,
  loadChatMacros,
  saveChatMacro,
  CHAT_MACRO_STORAGE_KEY,
} from './chatMacros';

describe('chatMacros', () => {
  beforeEach(() => {
    window.localStorage.removeItem(CHAT_MACRO_STORAGE_KEY);
  });

  it('auto-assigns a name from the first prompt and loads newest-first', () => {
    const macro = saveChatMacro(['hello world', 'second prompt']);
    expect(macro).not.toBeNull();
    expect(macro?.name).toContain('hello world');
    expect(macro?.items).toHaveLength(2);

    const loaded = loadChatMacros();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(macro?.id);
  });

  it('deduplicates auto names and deletes by id', () => {
    const a = saveChatMacro(['same prompt']);
    const b = saveChatMacro(['same prompt']);
    expect(a?.name).not.toBe(b?.name);

    const rest = deleteChatMacro(a!.id);
    expect(rest).toHaveLength(1);
    expect(rest[0].id).toBe(b!.id);
  });

  it('buildMacroName falls back when the first prompt is blank', () => {
    const name = buildMacroName(['   '], []);
    expect(name.length).toBeGreaterThan(0);
  });

  it('ignores blank items and rejects empty input', () => {
    expect(saveChatMacro(['   ', ''])).toBeNull();
    const macro = saveChatMacro(['  kept  ', '   ']);
    expect(macro?.items).toEqual(['kept']);
  });
});
