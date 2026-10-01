import type { Dict } from '../ko';

export const evalJudgeEn: Dict = {
  'eval.judge.selfSkipped': 'Self-judging prevented: judge and candidate models match, skipped',
  'eval.judge.sameFamilyWarn': 'Same-family caution: judge and candidate may share a model family, bias possible',
  'eval.judge.parseFailed': 'Failed to parse judge JSON output',
  'eval.judge.noReference': 'No reference answer available for pairwise comparison',
  'eval.judge.emptyOutput': 'Empty output',
  'eval.judge.noOpponent': 'No comparison opponent',
  'eval.judge.judgeError': 'Judge call failed',
  'eval.judge.lengthBiasWarn': 'Suspected length bias (|Spearman ρ| ≥ 0.5)',
  'eval.judge.lowTrust': 'Low judge–human agreement (κ < 0.4): low trust',
};
