import type { Dict } from '../ko';

export const evalRunnerKo: Dict = {
  'eval.runner.reason.solver-missing': '해당 팩 종류를 실행할 솔버가 없습니다',
  'eval.runner.reason.model-missing': '모델을 찾을 수 없습니다',
  'eval.runner.reason.connection-failed': '서버 연결 실패',
  'eval.runner.reason.tools-unsupported': '도구 호출 미지원 모델',
  'eval.runner.reason.logprobs-unsupported': 'logprobs 미지원',
  'eval.runner.reason.python-missing': 'Python 없음',
  'eval.runner.reason.context-too-small': '컨텍스트 부족',
  'eval.runner.reason.no-consented-integration': '동의된 외부 연동 없음',
  'eval.runner.reason.pack-changed': '실행 설정 이후 팩이 변경됨',
  'eval.runner.reason.lock-busy': '다른 평가 또는 채팅이 실행 중',
};
