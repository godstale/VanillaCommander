/**
 * choice_logprob scorer (P10-14, MCQ probability via output logprobs).
 *
 * Scores a multiple-choice trial from the logprob trace stored in
 * `extra.logprobTrace` by the logprob_trace solver — no text extraction.
 * At the first non-blank output position, choice-letter probability mass is
 * summed across surface variants ('A', ' A', '(A') and renormalized:
 *   value = P(correct letter); correct iff argmax == target.
 * No variant mass at that position yields no_answer.
 *
 * When no trace is present but `extra.logprobProbe` carries
 * `{ baseUrl, model, messages }`, the scorer performs its own short probe
 * (prompt + "output only the answer letter", num_predict 3) via
 * `requestChoiceProbe` below. A probe that fails with 'logprobs unsupported'
 * (non-Ollama provider or missing fields) yields a `skipped` verdict — the
 * N/A path. `requiresAsync` routes this scorer to the async scoring pass
 * (the runner's sync pass skips it; see runner.ts "handled by their passes").
 */
import { z } from 'zod';
import type { Scorer, ScorerInput, ScorerResult } from './types';
import { noAnswer, parseScorerOptions } from './types';
import { registerScorer } from './index';
import { targetsOf } from './shared';
import {
  isLogprobsUnsupported,
  requestLogprobs,
  type LogprobTrace,
} from '../logprobs/client';

const OptionsSchema = z.object({
  mode: z.enum(['prob']).default('prob'),
});

type Options = z.infer<typeof OptionsSchema>;

/** Surface variants summed per choice letter. */
export function choiceVariants(letter: string): string[] {
  return [letter, ` ${letter}`, `(${letter}`];
}

function choiceLetters(input: ScorerInput): string {
  const n = input.sample.choices?.length ?? 4;
  return 'ABCDEFGHIJ'.slice(0, Math.max(2, Math.min(10, n)));
}

export interface ChoiceProbability {
  letter: string;
  prob: number;
}

export interface ChoiceLogprobAnalysis {
  position: number;
  probabilities: ChoiceProbability[];
  argmax: string | null;
  targetProb: number | null;
}

/**
 * Sum-normalize P(choice) over top_logprobs at the first non-blank output
 * position. Returns null when that position carries no variant of any letter.
 */
export function analyzeChoicePosition(
  trace: LogprobTrace,
  letters: string,
): ChoiceLogprobAnalysis | null {
  let pos = -1;
  for (let i = 0; i < trace.tokens.length; i += 1) {
    if (trace.tokens[i].trim() !== '') {
      pos = i;
      break;
    }
  }
  if (pos < 0 || pos >= trace.topLogprobs.length) return null;
  const top = trace.topLogprobs[pos];
  const mass = new Map<string, number>();
  for (const c of top) {
    mass.set(c.token, (mass.get(c.token) ?? 0) + Math.exp(c.logprob));
  }
  const probs: ChoiceProbability[] = [];
  let total = 0;
  for (const letter of letters) {
    let m = 0;
    for (const v of choiceVariants(letter)) m += mass.get(v) ?? 0;
    probs.push({ letter, prob: m });
    total += m;
  }
  if (!(total > 0)) return null;
  for (const p of probs) p.prob /= total;
  let argmax: string | null = null;
  let best = -1;
  for (const p of probs) {
    if (p.prob > best) {
      best = p.prob;
      argmax = p.letter;
    }
  }
  return { position: pos, probabilities: probs, argmax, targetProb: null };
}

function isTrace(v: unknown): v is LogprobTrace {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    Array.isArray(r['tokens']) &&
    (r['tokens'] as unknown[]).every((t) => typeof t === 'string') &&
    Array.isArray(r['topLogprobs']) &&
    (r['topLogprobs'] as unknown[]).every(
      (row) =>
        Array.isArray(row) &&
        (row as unknown[]).every(
          (c) =>
            typeof c === 'object' &&
            c !== null &&
            typeof (c as Record<string, unknown>)['token'] === 'string' &&
            typeof (c as Record<string, unknown>)['logprob'] === 'number',
        ),
    )
  );
}

/** Instruction appended for the short MCQ probe (num_predict 3). */
export const CHOICE_PROBE_SUFFIX = 'Output only the answer letter (e.g. A). No explanation.';

export function buildChoiceProbeMessages(
  messages: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  return [
    ...messages.slice(0, -1),
    { ...last, content: `${last.content}\n\n${CHOICE_PROBE_SUFFIX}` },
  ];
}

export interface ChoiceProbeRequest {
  baseUrl?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  seed?: number;
}

/** Short temperature-0 probe used for MCQ P(choice); throws 'logprobs unsupported' when N/A. */
export async function requestChoiceProbe(
  req: ChoiceProbeRequest,
  signal?: AbortSignal,
): Promise<LogprobTrace> {
  return requestLogprobs(
    {
      baseUrl: req.baseUrl,
      model: req.model,
      messages: buildChoiceProbeMessages(req.messages),
      numPredict: 3,
      topLogprobs: 20,
      temperature: 0,
      seed: req.seed,
    },
    signal,
  );
}

function isProbeRequest(v: unknown): v is ChoiceProbeRequest {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['model'] === 'string' &&
    Array.isArray(r['messages']) &&
    (r['messages'] as unknown[]).every(
      (m) =>
        typeof m === 'object' &&
        m !== null &&
        typeof (m as Record<string, unknown>)['role'] === 'string' &&
        typeof (m as Record<string, unknown>)['content'] === 'string',
    )
  );
}

export const choiceLogprobScorer: Scorer = {
  type: 'choice_logprob',
  optionsSchema: OptionsSchema,
  requiresAsync: true,
  async score(
    input: ScorerInput,
    options: unknown,
    ctx: { signal: AbortSignal },
  ): Promise<ScorerResult> {
    parseScorerOptions(OptionsSchema, options) as Options;
    const letters = choiceLetters(input);
    const targets = targetsOf(input).map((t) => t.trim().toUpperCase());
    const target = targets.length > 0 ? targets[0] : null;

    let trace: LogprobTrace;
    const extra = (input.extra ?? {}) as Record<string, unknown>;
    if (extra['logprobUnsupported'] === true) {
      return { value: 0, verdict: 'skipped', reason: 'logprobs unsupported (N/A)' };
    }
    if (isTrace(extra['logprobTrace'])) {
      trace = extra['logprobTrace'];
    } else if (isProbeRequest(extra['logprobProbe'])) {
      const probe = extra['logprobProbe'];
      try {
        trace = await requestChoiceProbe(
          { baseUrl: typeof probe.baseUrl === 'string' ? probe.baseUrl : undefined, model: probe.model, messages: probe.messages },
          ctx.signal,
        );
      } catch (err: unknown) {
        if (isLogprobsUnsupported(err)) {
          return { value: 0, verdict: 'skipped', reason: 'logprobs unsupported (N/A)' };
        }
        return {
          value: 0,
          verdict: 'error',
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      return {
        value: 0,
        verdict: 'error',
        reason: 'choice_logprob needs extra.logprobTrace (logprob_trace solver) or extra.logprobProbe',
      };
    }

    const analysis = analyzeChoicePosition(trace, letters);
    if (!analysis) {
      return noAnswer('no choice variant in top_logprobs at first output position');
    }
    if (!target || !letters.includes(target)) {
      return noAnswer(`no target choice letter (${targets.join('|') || 'none'})`);
    }
    const targetProb = analysis.probabilities.find((p) => p.letter === target)?.prob ?? 0;
    const detail = `P(${target})=${targetProb.toFixed(4)} argmax=${analysis.argmax} @pos${analysis.position}`;
    if (analysis.argmax === target) {
      return { value: targetProb, verdict: 'correct', reason: detail, extracted: target };
    }
    return {
      value: targetProb,
      verdict: 'incorrect',
      reason: `expected ${target}, ${detail}`,
      extracted: analysis.argmax ?? undefined,
    };
  },
};

export function registerChoiceLogprobScorer(): void {
  registerScorer(choiceLogprobScorer);
}
