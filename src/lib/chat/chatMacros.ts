export interface ChatMacro {
  id: string;
  name: string;
  createdAt: string;
  items: string[];
  agentId?: string;
}

export const CHAT_MACRO_STORAGE_KEY = 'fortress:chat-macros';
export const CHAT_MACRO_LIMIT = 50;

function readRaw(): ChatMacro[] {
  try {
    const raw = window.localStorage.getItem(CHAT_MACRO_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ChatMacro =>
        typeof m === 'object' &&
        m !== null &&
        typeof (m as ChatMacro).id === 'string' &&
        typeof (m as ChatMacro).name === 'string' &&
        Array.isArray((m as ChatMacro).items),
    );
  } catch {
    return [];
  }
}

function writeRaw(macros: ChatMacro[]): void {
  try {
    window.localStorage.setItem(CHAT_MACRO_STORAGE_KEY, JSON.stringify(macros));
  } catch {
    // ignore quota errors
  }
}

/** 첫 프롬프트 앞부분으로 매크로 이름을 자동 할당한다. 중복 시 (2), (3)을 붙인다. */
export function buildMacroName(items: string[], existing: ChatMacro[] = []): string {
  const first = (items[0] ?? '').replace(/^[/#]\w+:\w+\s*/, '').replace(/\s+/g, ' ').trim();
  const snippet = first.length > 24 ? `${first.slice(0, 24)}...` : first;
  const base = snippet
    ? items.length > 1
      ? `${snippet} 외 ${items.length - 1}건`
      : snippet
    : `Macro ${new Date().toLocaleString()} (${items.length}건)`;
  if (!existing.some((m) => m.name === base)) return base;
  let n = 2;
  while (existing.some((m) => m.name === `${base} (${n})`)) n++;
  return `${base} (${n})`;
}

export function loadChatMacros(): ChatMacro[] {
  return readRaw().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function saveChatMacro(items: string[], opts: { agentId?: string } = {}): ChatMacro | null {
  const cleaned = items.map((s) => s.trim()).filter((s) => s.length > 0);
  if (cleaned.length === 0) return null;
  const existing = readRaw();
  const macro: ChatMacro = {
    id: crypto.randomUUID(),
    name: buildMacroName(cleaned, existing),
    createdAt: new Date().toISOString(),
    items: cleaned,
    agentId: opts.agentId,
  };
  writeRaw([macro, ...existing].slice(0, CHAT_MACRO_LIMIT));
  return macro;
}

export function deleteChatMacro(id: string): ChatMacro[] {
  const next = readRaw().filter((m) => m.id !== id);
  writeRaw(next);
  return next.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** 구버전 세션별 단일 로그(fortress:chat-log:<sessionId>)를 매크로로 승격한다. */
export function migrateLegacySessionLog(sessionId: string): ChatMacro | null {
  try {
    const raw = window.localStorage.getItem(`fortress:chat-log:${sessionId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { items?: unknown; agentId?: unknown };
    if (!Array.isArray(parsed.items)) return null;
    const items = parsed.items.filter(
      (s): s is string => typeof s === 'string' && s.trim().length > 0,
    );
    if (items.length === 0) return null;
    const macro = saveChatMacro(items, {
      agentId: typeof parsed.agentId === 'string' ? parsed.agentId : undefined,
    });
    window.localStorage.removeItem(`fortress:chat-log:${sessionId}`);
    return macro;
  } catch {
    return null;
  }
}
