import { invoke } from '@tauri-apps/api/core';
import basicLlmWikiSkill from './bundled/basic-llm-wiki/SKILL.md?raw';

/** 앱이 기본 제공하는 스킬. 에이전트에서 활성화하면 워크스페이스 `.agents/skills/<name>/`로 복사된다. */
export interface BundledSkill {
  name: string;
  description: string;
  files: Record<string, string>; // 스킬 폴더 기준 상대경로 -> 내용
}

export const BUNDLED_SKILLS: BundledSkill[] = [
  {
    name: 'basic-llm-wiki',
    description:
      'Minimal workspace wiki: register, look up, and delete knowledge pages under wiki/.',
    files: { 'SKILL.md': basicLlmWikiSkill },
  },
];

export function getBundledSkill(name: string): BundledSkill | undefined {
  return BUNDLED_SKILLS.find((s) => s.name === name);
}

/**
 * 활성화된 번들 스킬 중 워크스페이스에 아직 없는 것을 `.agents/skills/<name>/`로 복사한다.
 * 이미 존재하는 파일은 사용자 수정본일 수 있으므로 덮어쓰지 않는다.
 * @returns 새로 복사된 스킬 이름 목록
 */
export async function installBundledSkills(
  workspaceRoot: string,
  skillNames: string[],
): Promise<string[]> {
  const installed: string[] = [];
  for (const name of skillNames) {
    const skill = getBundledSkill(name);
    if (!skill) continue;
    let copied = false;
    for (const [rel, contents] of Object.entries(skill.files)) {
      const path = `.agents/skills/${skill.name}/${rel}`;
      try {
        await invoke<string>('read_text_file', { path, workspaceRoot });
        continue; // 이미 존재
      } catch {
        // 없음 -> 생성
      }
      await invoke('write_text_file', { path, contents, workspaceRoot });
      copied = true;
    }
    if (copied) installed.push(skill.name);
  }
  return installed;
}
