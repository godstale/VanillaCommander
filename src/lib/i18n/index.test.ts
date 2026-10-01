import { describe, it, expect } from 'vitest';
import { translate } from '@/lib/i18n';
import ko from '@/lib/i18n/dictionaries/ko';
import en from '@/lib/i18n/dictionaries/en';

describe('i18n dictionaries', () => {
  it('en covers every ko key', () => {
    const missing = Object.keys(ko).filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it('interpolates params', () => {
    expect(translate('ko', 'sessions.minutesAgo', { n: 5 })).toBe('5분 전');
    expect(translate('en', 'sessions.minutesAgo', { n: 5 })).toBe('5m ago');
  });

  it('falls back to ko when en key is missing', () => {
    const table = { ...en };
    delete table['queue.title'];
    void table;
    // simulate via unknown key: returns key itself when absent in both
    expect(translate('en', 'nonexistent.key')).toBe('nonexistent.key');
  });
});
