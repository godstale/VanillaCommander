import type { Dict } from '../ko';

export const evalJudgeKo: Dict = {
  'eval.judge.selfSkipped': '자기 평가 방지: 판단 모델과 후보 모델이 같아 건너뜀',
  'eval.judge.sameFamilyWarn': '동일 계열 주의: 판단자와 후보가 같은 모델 계열일 수 있어 편향 가능',
  'eval.judge.parseFailed': '판단 결과 JSON 파싱 실패',
  'eval.judge.noReference': 'pairwise 비교용 정답(reference)이 없음',
  'eval.judge.emptyOutput': '빈 출력',
  'eval.judge.noOpponent': '비교 상대 없음',
  'eval.judge.judgeError': '판단 호출 실패',
  'eval.judge.lengthBiasWarn': '길이 편향 의심(|Spearman ρ| ≥ 0.5)',
  'eval.judge.lowTrust': '판단자-사람 일치도 낮음(κ < 0.4): 신뢰도 낮음',
};
