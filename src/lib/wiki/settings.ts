// P11-31: 위키 설정 헬퍼. 저장소 스키마(settingsRepo)는 P11-04 소유이며,
// 여기서는 기본 프롬프트·경로 해석·파일 필터 판정만 둔다.
import type { WikiSettings } from '@/lib/db/repositories/settingsRepo';

/** D6 분류 규칙 프리셋. auto는 LLM이 파일 내용을 보고 셋 중 하나를 고른다. */
export type ClassificationRule = 'auto' | 'date' | 'serial' | 'frequency';

export const CLASSIFICATION_RULES: Array<{ id: ClassificationRule; hint: string }> = [
  { id: 'auto', hint: 'LLM이 내용에 맞게 자동 선택' },
  { id: 'date', hint: '날짜순 YYYY/MM-DD/ (단발성 자료)' },
  { id: 'serial', hint: '순번 NN-<주제>/ (연속 프로젝트, 0 패딩)' },
  { id: 'frequency', hint: '빈도순 일일/주간/월간/분기/반기/연간/상시' },
];

/** 위키 처리 기본 프롬프트. 비우면 이 값으로 초기화한다. */
export const DEFAULT_WIKI_PROMPT = [
  '감시 폴더에 들어온 파일을 위키에 등록하기 위한 분류 정보를 JSON으로 만든다.',
  '파일 내용을 보고 세 가지 정리 규칙 중 하나를 고른다:',
  '- 날짜순(date): 단발성 자료 → YYYY/MM-DD/ 폴더',
  '- 순번(serial): 연속 프로젝트 → NN-<주제>/ 폴더 (0 패딩)',
  '- 빈도순(frequency): 대분류 → 일일/주간/월간/분기/반기/연간/상시 중 하나',
  '출력 JSON: { "classification": "date|serial|frequency", "folderName": "...", "title": "...", "slug": "...", "summary": "...", "tags": ["..."] }',
  '제목은 파일 내용의 핵심을 한 줄로, slug는 kebab-case로 만든다.',
].join('\n');

/** 이동 대상 폴더. 미지정이면 `<WorkFolder>/wiki-inbox`. */
export function resolveInboxDir(workFolder: string | null | undefined, inboxDir: string): string {
  const custom = inboxDir.trim();
  if (custom) return custom;
  const base = (workFolder ?? '').replace(/[\\/]+$/, '');
  const sep = base.includes('\\') ? '\\' : '/';
  return base ? `${base}${sep}wiki-inbox` : 'wiki-inbox';
}

export function extOfPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** `*`·`?`·`**`만 지원하는 최소 glob 매칭 (대소문자 무시). */
export function matchesGlob(path: string, glob: string): boolean {
  const target = path.replace(/\\/g, '/').toLowerCase();
  const pattern = glob.trim().replace(/\\/g, '/').toLowerCase();
  if (!pattern) return false;
  let regex = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        regex += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        regex += '[^/]*';
      }
    } else if (ch === '?') {
      regex += '[^/]';
    } else {
      regex += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const fileName = target.split('/').pop() ?? target;
  return new RegExp(`^(?:.*/)?${regex}$`).test(target) || new RegExp(`^${regex}$`).test(fileName);
}

export type FileFilterVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * 감시 파일의 처리 대상 여부. 확장자 화이트리스트·최대 크기·제외 glob 순으로 본다.
 * 실행 파일은 기본 화이트리스트에 없어 자동으로 제외된다.
 */
export function shouldProcessFile(
  path: string,
  sizeBytes: number,
  settings: Pick<WikiSettings, 'allowedExtensions' | 'maxFileMb' | 'excludeGlobs'>,
): FileFilterVerdict {
  const ext = extOfPath(path);
  const allowed = settings.allowedExtensions.map((e) =>
    e.toLowerCase().replace(/^\./, ''),
  );
  if (!ext || !allowed.includes(ext)) {
    return { ok: false, reason: `허용되지 않은 확장자입니다: .${ext || '(없음)'}` };
  }
  const maxBytes = Math.max(0, settings.maxFileMb) * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    return { ok: false, reason: `크기 제한 초과입니다 (${settings.maxFileMb}MB)` };
  }
  for (const glob of settings.excludeGlobs) {
    if (glob.trim() && matchesGlob(path, glob)) {
      return { ok: false, reason: `제외 패턴에 해당합니다: ${glob}` };
    }
  }
  return { ok: true };
}
