// P11-16: `@` 파일/폴더 참조 파싱·해석.
import { fcListDir, fcReadTextHead } from '@/lib/commander/ipc';
import { IMAGE_EXTS, TEXT_EXTS, extOf } from '@/lib/commander/openFile';

export const MAX_MENTION_INLINE_BYTES = 32 * 1024;
const MAX_DIR_LIST = 100;

export interface MentionRef {
  path: string;
  kind: 'file' | 'dir' | 'image';
  size: number;
}

export interface MentionItem {
  path: string;
  name: string;
  isDir: boolean;
}

export interface ResolvedMentions {
  text: string;
  refs: MentionRef[];
}

/** 커서 앞 `@query` 토큰을 찾는다. 없으면 null. */
export function getMentionQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const m = /(?:^|[\s(["'])@([^\s@]*)$/.exec(before);
  if (!m) return null;
  return { start: cursor - m[1].length - 1, query: m[1] };
}

/** 팝업 선택을 텍스트에 반영한다. 공백 포함 경로는 따옴표로 감싼다. */
export function applyMentionPick(
  text: string,
  start: number,
  query: string,
  absPath: string,
): { text: string; cursor: number } {
  const insert = /[\s]/.test(absPath) ? `@"${absPath}" ` : `@${absPath} `;
  const end = start + 1 + query.length;
  const next = text.slice(0, start) + insert + text.slice(end);
  return { text: next, cursor: start + insert.length };
}

function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/');
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`;
}

function dirNameOf(path: string): string {
  const clean = path.replace(/[\\/]+$/, '');
  const idx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return idx <= 0 ? clean : clean.slice(0, idx);
}

function baseNameOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

const TOKEN_RE = /@"([^"]+)"|@([^\s@]+)/g;

export async function resolveMentions(
  input: string,
  opts: { cwd?: string },
): Promise<ResolvedMentions> {
  const refs: MentionRef[] = [];
  let out = '';
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  for (;;) {
    const m = TOKEN_RE.exec(input);
    if (!m) break;
    out += input.slice(last, m.index);
    last = m.index + m[0].length;
    const raw = (m[1] ?? m[2]).trim();
    const resolved = await resolveOne(raw, opts.cwd);
    if (!resolved) {
      out += m[0];
      continue;
    }
    refs.push(resolved.ref);
    out += resolved.block;
  }
  out += input.slice(last);
  return { text: out, refs };
}

async function resolveOne(
  raw: string,
  cwd: string | undefined,
): Promise<{ ref: MentionRef; block: string } | null> {
  const abs = isAbsolutePath(raw) ? raw : cwd ? joinPath(cwd, raw) : null;
  if (!abs) return null;
  let entries;
  try {
    entries = await fcListDir(dirNameOf(abs), true);
  } catch {
    return null;
  }
  const target = baseNameOf(abs).toLowerCase();
  const entry = entries.find((e) => e.name.toLowerCase() === target);
  if (!entry) return null;

  const at = `@${abs}`;
  if (entry.kind === 'dir') {
    let children: string[];
    try {
      const list = await fcListDir(abs, false);
      children = list.slice(0, MAX_DIR_LIST).map((e) => `- ${e.name}${e.kind === 'dir' ? '/' : ''}`);
    } catch {
      children = [];
    }
    return {
      ref: { path: abs, kind: 'dir', size: 0 },
      block: `${at} (폴더, ${children.length}개${children.length >= MAX_DIR_LIST ? '+' : ''}):\n${children.join('\n')}\n`,
    };
  }

  const ext = extOf(entry.name);
  if (IMAGE_EXTS.has(ext)) {
    // P11-26에서 이미지 첨부로 전환 예정. 그전까지 경로만 전달한다.
    return {
      ref: { path: abs, kind: 'image', size: entry.size },
      block: `${at} (이미지 파일 — 경로만 전달됨)\n`,
    };
  }
  if (!TEXT_EXTS.has(ext)) {
    return {
      ref: { path: abs, kind: 'file', size: entry.size },
      block: `${at} (내용 미포함 — read 도구로 읽으세요)\n`,
    };
  }
  if (entry.size > MAX_MENTION_INLINE_BYTES) {
    return {
      ref: { path: abs, kind: 'file', size: entry.size },
      block: `${at} (${entry.size} 바이트 — 내용이 크므로 read 도구로 읽으세요)\n`,
    };
  }
  try {
    const head = await fcReadTextHead(abs, MAX_MENTION_INLINE_BYTES);
    if (head.truncated) {
      return {
        ref: { path: abs, kind: 'file', size: entry.size },
        block: `${at} (내용 미포함 — read 도구로 읽으세요)\n`,
      };
    }
    return {
      ref: { path: abs, kind: 'file', size: entry.size },
      block: `${at} (파일 내용):\n\`\`\`${ext}\n${head.text}\n\`\`\`\n`,
    };
  } catch {
    return {
      ref: { path: abs, kind: 'file', size: entry.size },
      block: `${at} (읽기 실패 — read 도구로 읽으세요)\n`,
    };
  }
}
