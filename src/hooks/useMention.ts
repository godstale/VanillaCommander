import { useEffect, useMemo, useRef, useState } from 'react';
import { useSafeSettings } from '@/lib/context/SettingsContext';
import { fcListDir } from '@/lib/commander/ipc';
import {
  applyMentionPick,
  getMentionQuery,
  type MentionItem,
} from '@/lib/chat/mentions';

function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/** 현재 폴더 목록 + 즐겨찾기에서 `@query` 후보를 만든다. */
export function useMentionItems(cwd: string | null, query: string | null): MentionItem[] {
  const settings = useSafeSettings();
  const favorites = useMemo(() => settings?.settings.favorites ?? [], [settings]);
  const [items, setItems] = useState<MentionItem[]>([]);

  useEffect(() => {
    if (query === null || !cwd) return;
    let active = true;
    const q = query.toLowerCase();
    void fcListDir(cwd, false)
      .then((list) => {
        if (!active) return;
        const favs = favorites
          .filter((f) => baseNameOf(f).toLowerCase().includes(q))
          .slice(0, 5)
          .map((path) => ({ path, name: baseNameOf(path), isDir: true }));
        const hits = list
          .filter((e) => e.name.toLowerCase().includes(q))
          .sort((a, b) => {
            const ad = a.kind === 'dir' ? 0 : 1;
            const bd = b.kind === 'dir' ? 0 : 1;
            return ad - bd || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          })
          .slice(0, 15)
          .map((e) => ({ path: e.path, name: e.name, isDir: e.kind === 'dir' }));
        const seen = new Set(hits.map((h) => h.path.toLowerCase()));
        setItems([...favs.filter((f) => !seen.has(f.path.toLowerCase())), ...hits]);
      })
      .catch(() => {
        if (active) setItems([]);
      });
    return () => {
      active = false;
    };
  }, [cwd, query, favorites]);

  return items;
}

export interface MentionCompleter {
  query: string | null;
  items: MentionItem[];
  index: number;
  open: boolean;
  sync: (text: string, cursor: number) => void;
  move: (delta: number) => void;
  pickCurrent: (text: string, apply: (next: string, cursor: number) => void) => boolean;
  close: () => void;
}

/** `@` 팝업 상태기. 입력창(text 소유권은 부모)이 cursor 동기화·키 처리에 쓴다. */
export function useMention(cwd: string | null): MentionCompleter {
  const [queryState, setQueryState] = useState<{ start: number; query: string } | null>(null);
  const [index, setIndex] = useState(0);
  const [suppressed, setSuppressed] = useState(false);
  const lastTextRef = useRef<string | null>(null);
  const items = useMentionItems(cwd, queryState?.query ?? null);

  const query = queryState?.query ?? null;
  const open = !suppressed && query !== null && items.length > 0;

  const sync = (text: string, cursor: number) => {
    if (lastTextRef.current !== null && text !== lastTextRef.current) {
      setSuppressed(false);
    }
    lastTextRef.current = text;
    const found = getMentionQuery(text, cursor);
    setQueryState((prev) => {
      if (!found && !prev) return prev;
      if (found && prev && found.start === prev.start && found.query === prev.query) return prev;
      return found;
    });
    setIndex(0);
  };

  const move = (delta: number) => {
    if (items.length === 0) return;
    setIndex((prev) => (prev + delta + items.length) % items.length);
  };

  const pickCurrent = (text: string, apply: (next: string, cursor: number) => void): boolean => {
    if (!open || !queryState) return false;
    const item = items[index] ?? items[0];
    if (!item) return false;
    const { text: next, cursor } = applyMentionPick(text, queryState.start, queryState.query, item.path);
    setQueryState(null);
    setSuppressed(true);
    apply(next, cursor);
    return true;
  };

  const close = () => {
    setQueryState(null);
    setSuppressed(true);
  };

  return { query, items, index, open, sync, move, pickCurrent, close };
}
