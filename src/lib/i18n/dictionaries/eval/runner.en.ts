import type { Dict } from '../ko';

export const evalRunnerEn: Dict = {
  'eval.runner.reason.solver-missing': 'No solver for this pack kind',
  'eval.runner.reason.model-missing': 'Model not found',
  'eval.runner.reason.connection-failed': 'Server connection failed',
  'eval.runner.reason.tools-unsupported': 'Model lacks tool support',
  'eval.runner.reason.logprobs-unsupported': 'logprobs unsupported',
  'eval.runner.reason.python-missing': 'Python missing',
  'eval.runner.reason.context-too-small': 'Context too small',
  'eval.runner.reason.no-consented-integration': 'No consented external integration',
  'eval.runner.reason.pack-changed': 'Pack changed since run was configured',
  'eval.runner.reason.lock-busy': 'Another evaluation or chat is running',
};
