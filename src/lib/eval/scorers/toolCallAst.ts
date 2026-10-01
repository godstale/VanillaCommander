import { z } from 'zod';
import type { ExpectedToolCall } from '../types';
import type { Scorer, ScorerInput, ScorerResult } from './types';
import { correct, parseScorerOptions } from './types';

const OptionsSchema = z.object({
  orderSensitive: z.boolean().default(false),
  allowExtraCalls: z.boolean().default(false),
});

function normPath(s: string): string {
  return s.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function normString(s: string): string {
  return s.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
}

export function valuesEquivalent(actual: unknown, allowed: unknown): boolean {
  if (typeof allowed === 'boolean' || typeof actual === 'boolean') {
    return actual === allowed;
  }
  if (typeof allowed === 'number' && typeof actual === 'number') {
    return actual === allowed;
  }
  if (typeof allowed === 'number' && typeof actual === 'string') {
    const n = Number(actual.trim());
    return Number.isFinite(n) && n === allowed;
  }
  if (typeof allowed === 'string' && typeof actual === 'string') {
    if (normPath(actual) === normPath(allowed)) return true;
    return normString(actual) === normString(allowed);
  }
  if (Array.isArray(allowed) && Array.isArray(actual)) {
    if (allowed.length !== actual.length) return false;
    return allowed.every((a, i) => valuesEquivalent(actual[i], a));
  }
  if (
    allowed !== null && actual !== null &&
    typeof allowed === 'object' && typeof actual === 'object' &&
    !Array.isArray(allowed) && !Array.isArray(actual)
  ) {
    const aRec = actual as Record<string, unknown>;
    const bRec = allowed as Record<string, unknown>;
    const keys = new Set([...Object.keys(aRec), ...Object.keys(bRec)]);
    for (const k of keys) {
      if (!(k in aRec) || !(k in bRec)) return false;
      if (!valuesEquivalent(aRec[k], bRec[k])) return false;
    }
    return true;
  }
  return actual === allowed;
}

function matchCall(
  actual: { name: string; arguments: Record<string, unknown> },
  expected: ExpectedToolCall,
): { matched: boolean; reason: string } {
  if (actual.name !== expected.name) {
    return { matched: false, reason: `expected tool ${expected.name}, got ${actual.name}` };
  }
  const optional = new Set(expected.optionalArgs ?? []);
  const required = Object.keys(expected.args).filter((k) => !optional.has(k));
  for (const key of required) {
    if (!(key in actual.arguments)) {
      return { matched: false, reason: `${expected.name}: missing arg ${key}` };
    }
  }
  for (const key of Object.keys(actual.arguments)) {
    if (!(key in expected.args) && !optional.has(key)) {
      return { matched: false, reason: `${expected.name}: hallucinated arg ${key}` };
    }
  }
  for (const [key, allowedList] of Object.entries(expected.args)) {
    if (allowedList.length === 0) continue; // presence only
    if (!(key in actual.arguments)) continue; // optional arg omitted
    const actualValue = (actual.arguments as Record<string, unknown>)[key];
    const ok = (allowedList as unknown[]).some((allowed) => valuesEquivalent(actualValue, allowed));
    if (!ok) {
      return { matched: false, reason: `${expected.name}.${key}: value not in allowed list` };
    }
  }
  return { matched: true, reason: `${expected.name}: matched` };
}

export const toolCallAstScorer: Scorer = {
  type: 'tool_call_ast',
  optionsSchema: OptionsSchema,
  async score(input: ScorerInput, options: unknown): Promise<ScorerResult> {
    const opts = parseScorerOptions(OptionsSchema, options);
    const expected = input.sample.expectedToolCalls ?? [];
    const actual = input.toolCalls;
    if (expected.length === 0) {
      return { value: 0, verdict: 'error', reason: 'no expectedToolCalls in sample' };
    }

    let pairs: Array<{ a: number; e: number }>;
    if (opts.orderSensitive || expected.length * actual.length > 64) {
      pairs = expected.map((_, i) => ({ a: i, e: i })).filter(({ a, e }) => a < actual.length && e < expected.length);
    } else {
      // Greedy best matching for parallel calls.
      const used = new Set<number>();
      pairs = [];
      for (let e = 0; e < expected.length; e++) {
        let best = -1;
        for (let a = 0; a < actual.length; a++) {
          if (used.has(a)) continue;
          if (matchCall(actual[a], expected[e]).matched) {
            best = a;
            break;
          }
        }
        if (best === -1) {
          for (let a = 0; a < actual.length; a++) {
            if (used.has(a)) continue;
            if (actual[a].name === expected[e].name) {
              best = a;
              break;
            }
          }
        }
        if (best >= 0) {
          used.add(best);
          pairs.push({ a: best, e });
        }
      }
    }

    let matched = 0;
    let firstFailure = '';
    for (let e = 0; e < expected.length; e++) {
      const pair = pairs.find((p) => p.e === e);
      if (!pair) {
        if (!firstFailure) firstFailure = `missing call ${expected[e].name}`;
        continue;
      }
      const r = matchCall(actual[pair.a], expected[e]);
      if (r.matched) matched += 1;
      else if (!firstFailure) firstFailure = r.reason;
    }

    const countOk = opts.allowExtraCalls
      ? actual.length >= expected.length
      : actual.length === expected.length;
    if (!countOk && !firstFailure) {
      firstFailure = `call count ${actual.length} vs expected ${expected.length}`;
    }

    const value = matched / expected.length;
    if (matched === expected.length && countOk) {
      return correct(1, `all ${expected.length} calls matched`);
    }
    return { value, verdict: 'incorrect', reason: firstFailure || `matched ${matched}/${expected.length}` };
  },
};
