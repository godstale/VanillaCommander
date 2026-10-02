import type { Dict } from './ko';

// P11-13 파일 작업 큐·충돌·정보·클립보드·검색 문구 (P11-11 탐색기가 이어받는다).
export const explorerKo: Dict = {
  'jobs.title': '백그라운드 작업',
  'jobs.empty': '진행 중인 작업이 없습니다.',
  'jobs.cancel': '취소',
  'jobs.dismiss': '닫기',
  'jobs.clearFinished': '완료된 작업 지우기',
  'jobs.running': '진행 중',
  'jobs.done': '완료',
  'jobs.failed': '실패',
  'jobs.cancelled': '취소됨',
  'jobs.filesProgress': '{done} / {total} 파일',
  'jobs.bytesProgress': '{done} / {total}',
  'jobs.matches': '{n}건 발견',

  'conflict.title': '같은 이름의 파일이 있습니다',
  'conflict.desc': "'{name}'이(가) 이미 있습니다. 어떻게 할까요?",
  'conflict.overwrite': '덮어쓰기',
  'conflict.skip': '건너뛰기',
  'conflict.rename': '이름 변경',
  'conflict.renameTo': '새 이름: {name}',
  'conflict.applyToAll': '모두에 적용',

  'props.title': '정보',
  'props.loading': '계산 중...',
  'props.files': '파일 {n}개',
  'props.dirs': '폴더 {n}개',
  'props.size': '전체 크기 {size}',
  'props.failed': '정보 계산 실패: {err}',

  'clipboard.copyPending': '복사 대기 {n}개',
  'clipboard.cutPending': '잘라내기 대기 {n}개',

  'search.results': '검색 결과 {n}건',
  'search.noResults': '검색 결과가 없습니다.',
  'search.searching': '검색 중...',
  'search.openFile': '파일 열기',
  'search.cancelSearch': '검색 중지',
};
