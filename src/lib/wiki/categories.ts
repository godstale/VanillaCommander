// P14-03: 위키 카테고리 체계. 카테고리 경로("문서/업무")가 곧 보관 폴더의 하위 경로다.

export const MAX_CATEGORY_DEPTH = 3;
const MAX_SEGMENT_LENGTH = 40;
// 파일명에 쓸 수 없는 문자와 제어 문자는 세그먼트에서 제거한다.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\\:*?"<>|\u0000-\u001f]/g;

export const DEFAULT_CATEGORIES: string[] = [
  '문서/업무',
  '문서/학습',
  '문서/계약-법률',
  '재무/영수증-청구서',
  '재무/보고서',
  '이미지/사진',
  '이미지/스크린샷',
  '기타',
];

/**
 * 사용자·LLM 입력을 안전한 `A/B/C` 경로로 정규화한다.
 * 빈 값·`.`/`..` 세그먼트가 섞이거나 깊이를 넘으면 null (폴더 탈출·난립 방지).
 */
export function normalizeCategoryPath(raw: string): string | null {
  // 구 설정값 호환: '·' 구분자는 '-'로 읽는다.
  const segments = raw
    .replace(/·/g, '-')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.replace(FORBIDDEN_CHARS, '').trim());
  const kept = segments.filter((s) => s.length > 0);
  if (kept.length === 0 || kept.length > MAX_CATEGORY_DEPTH) return null;
  if (kept.some((s) => s === '.' || s === '..' || /^\.+$/.test(s) || s.length > MAX_SEGMENT_LENGTH)) {
    return null;
  }
  return kept.join('/');
}

function withAncestors(path: string): string[] {
  const parts = path.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** 설정 카테고리와 디스크의 기존 폴더를 합쳐 중복 없는 경로 목록(조상 포함)을 만든다. */
export function mergeCategories(configured: string[], existing: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of [...configured, ...existing]) {
    const path = normalizeCategoryPath(raw);
    if (!path) continue;
    for (const p of withAncestors(path)) {
      const key = p.toLowerCase();
      if (!seen.has(key)) seen.set(key, p);
    }
  }
  // 로캘에 따라 순서가 달라지지 않도록 코드 포인트 순으로 정렬한다.
  return Array.from(seen.values()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface ResolvedCategory {
  path: string;
  isNew: boolean;
}

/**
 * LLM이 제안한 경로를 알려진 카테고리에 맞춘다.
 * 1) 기존 경로와 일치 → 그대로(대소문자는 기존 표기)
 * 2) 새 카테고리 허용 + 부모가 존재(최상위는 항상 가능) → 새 경로
 * 3) 그 외 → 가장 가까운 기존 상위 경로
 * 아무것도 맞지 않으면 null (호출자가 날짜 폴백을 쓴다).
 */
export function resolveCategory(
  proposed: string,
  known: string[],
  allowNew: boolean,
): ResolvedCategory | null {
  const path = normalizeCategoryPath(proposed);
  if (!path) return null;
  const byLower = new Map(known.map((k) => [k.toLowerCase(), k]));
  const exact = byLower.get(path.toLowerCase());
  if (exact) return { path: exact, isNew: false };

  const parts = path.split('/');
  const parentKey = parts.slice(0, -1).join('/').toLowerCase();
  const parent = parentKey ? byLower.get(parentKey) : '';
  if (allowNew && parent !== undefined) {
    const base = parent ? `${parent}/${parts[parts.length - 1]}` : path;
    return { path: base, isNew: true };
  }
  for (let n = parts.length - 1; n >= 1; n--) {
    const ancestor = byLower.get(parts.slice(0, n).join('/').toLowerCase());
    if (ancestor) return { path: ancestor, isNew: false };
  }
  return null;
}

/** 분류 응답의 JSON Schema. 새 카테고리를 막으면 경로를 enum으로 제한해 파싱 실패를 줄인다. */
export function buildClassificationSchema(
  known: string[],
  allowNew: boolean,
): Record<string, unknown> {
  const categoryPath: Record<string, unknown> =
    !allowNew && known.length > 0
      ? { type: 'string', enum: known }
      : { type: 'string' };
  return {
    type: 'object',
    properties: {
      categoryPath,
      title: { type: 'string' },
      slug: { type: 'string' },
      summary: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['categoryPath', 'title', 'slug', 'summary', 'tags'],
    additionalProperties: false,
  };
}
