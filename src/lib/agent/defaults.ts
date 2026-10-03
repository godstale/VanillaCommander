import type { ApprovalMode, BuiltinToolId } from '@/lib/types/agent';

// P11-04(V4): 앱 전역 기본값 상수. 설정 화면의 전역 모델/승인값 대신 사용한다.
// P11-04/V4·V6: 전역 모델·승인 설정 화면 대신 이 상수가 유일한 기본값이다.

/** 기본 승인 모드 (V4·V6: dangerous-only). */
export const APP_DEFAULT_APPROVAL_MODE: ApprovalMode = 'dangerous-only';

/** 새 에이전트 기본 내장 도구 (V6: 셸 제외 전체 + P11-24 파일 커맨더). */
export const APP_DEFAULT_BUILTIN_TOOLS: BuiltinToolId[] = [
  'read',
  'ls',
  'grep',
  'find',
  'write',
  'edit',
  'web_search',
  'web_fetch',
  'wiki',
  'fs_copy',
  'fs_move',
  'fs_rename',
  'fs_mkdir',
  'fs_trash',
  'fs_zip',
  'fs_unzip',
  'fs_info',
  'fs_search',
  'explorer',
  'doc_read',
];

/** 새 에이전트 기본 스킬 (V6: basic-llm-wiki). */
export const APP_DEFAULT_SKILLS: string[] = ['basic-llm-wiki'];

export const APP_DEFAULT_TEMPERATURE = 0.2;
export const APP_DEFAULT_CONTEXT_SIZE = 8192;
/** 0 = 자동(컨텍스트 크기별 단계표). */
export const APP_DEFAULT_RESERVE_TOKENS = 0;
/** 0 = 자동(컨텍스트 크기별 단계표). */
export const APP_DEFAULT_KEEP_RECENT_TOKENS = 0;
