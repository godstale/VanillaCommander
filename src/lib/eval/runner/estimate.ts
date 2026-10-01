import type { EvalRunConfig } from '../types';

export interface SpeedHints {
  decodeTps?: number;
  prefillTps?: number;
}

export interface RunEstimate {
  perCandidateSec: Record<string, number>;
  totalSec: number;
}

const OUTPUT_TOKENS: Record<string, number> = {
  single_turn: 300,
  multi_turn: 300,
  tool_call: 120,
  agentic: 1000,
  perf_probe: 512,
  long_context: 60,
  compaction_recall: 120,
  logprob_trace: 256,
};

export function estimateRun(
  config: EvalRunConfig,
  packKinds: Record<string, string>,
  hints: SpeedHints = {},
): RunEstimate {
  const decode = hints.decodeTps ?? 20;
  const prefill = hints.prefillTps ?? 500;
  const perCandidateSec: Record<string, number> = {};
  let totalSec = 20 * config.candidates.length; // cold load per candidate

  for (let c = 0; c < config.candidates.length; c++) {
    const candidate = config.candidates[c];
    const reasoningX = candidate.reasoning === 'on' ? 3 : 1;
    let seconds = 0;
    for (const pack of config.packs) {
      const kind = packKinds[`${pack.scope}:${pack.packId}`] ?? 'single_turn';
      const outPerSample = (OUTPUT_TOKENS[kind] ?? 300) * reasoningX;
      const inPerSample = 800;
      const repeats = kind === 'perf_probe' ? config.options.perfRepeats : 1;
      const perSampleSec = inPerSample / prefill + outPerSample / decode;
      seconds += pack.sampleIds.length * pack.epochs * repeats * perSampleSec;
    }
    perCandidateSec[`candidate:${c}`] = Math.round(seconds);
    totalSec += seconds;
  }
  return { perCandidateSec, totalSec: Math.round(totalSec) };
}

export function formatDuration(totalSec: number): string {
  if (totalSec < 90) return `약 ${Math.max(1, Math.round(totalSec))}초`;
  const minutes = Math.round(totalSec / 60);
  if (minutes < 90) return `약 ${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `약 ${hours}시간` : `약 ${hours}시간 ${rest}분`;
}
