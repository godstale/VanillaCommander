// P14-06: 위키 질의 전용 채팅의 시스템 프롬프트 보충. 위키 폴더 위치와 탐색 절차를 알려
// 에이전트가 스킬 문서를 찾지 않고 곧바로 위키를 읽어 답하게 한다.

export function buildWikiChatAddendum(workspaceRoot: string | null | undefined): string {
  const root = (workspaceRoot ?? '').replace(/[\\/]+$/, '');
  const sep = root.includes('\\') ? '\\' : '/';
  const wikiDir = root ? `${root}${sep}wiki` : 'wiki';
  return [
    '[위키 질의 모드]',
    `이 대화는 사용자의 위키를 검색·요약하기 위한 전용 채팅이다. 위키 폴더는 이미 정해져 있다: ${wikiDir}`,
    '- 구조: wiki/index.md(전체 목록), wiki/sources/<slug>.md(등록된 페이지), wiki/log.md(등록 기록).',
    '- 절차: ① wiki/index.md를 읽어 관련 페이지를 고른다 → ② 필요하면 wiki 도구(action: query/list) 또는 grep으로 키워드를 찾는다 → ③ 후보 페이지를 read로 열어 내용을 확인한다 → ④ 근거에 기반해 답한다.',
    '- 답변 끝에 근거로 쓴 페이지를 [[slug]] 형태로 나열하고, 페이지에 적힌 "출처:" 원본 파일 경로가 있으면 함께 알려라.',
    '- 위키에 없는 내용은 추측하지 말고 "위키에 해당 내용이 없다"고 말한 뒤, 다른 키워드로 한 번 더 찾아보라.',
    '- 스킬(SKILL.md)을 찾거나 읽을 필요 없다. 위키 폴더를 직접 탐색하라. 사용자가 요청하지 않는 한 위키 파일을 수정하지 마라.',
  ].join('\n');
}
