import { z } from 'zod';
import type { Scorer, ScorerInput, ScorerResult } from './types';
import { parseScorerOptions } from './types';

const OptionsSchema = z.object({});

const READ_PATH_ARG_KEYS = ['path', 'filePath', 'file_path', 'filename', 'file'];

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

function readPathsOf(call: { name: string; arguments: Record<string, unknown> }): string[] {
  if (call.name !== 'read') return [];
  const paths: string[] = [];
  for (const key of READ_PATH_ARG_KEYS) {
    const value = call.arguments[key];
    if (typeof value === 'string' && value.trim() !== '') paths.push(normPath(value));
  }
  return paths;
}

interface Condition {
  ratio: number;
  ok: boolean;
  label: string;
}

export const trajectoryScorer: Scorer = {
  type: 'trajectory',
  optionsSchema: OptionsSchema,
  async score(input: ScorerInput, options: unknown): Promise<ScorerResult> {
    parseScorerOptions(OptionsSchema, options);
    const traj = input.sample.trajectory;
    if (!traj) {
      return { value: 0, verdict: 'error', reason: 'no trajectory in sample' };
    }
    const calls = input.toolCalls;
    const called = new Set(calls.map((c) => c.name));
    const conditions: Condition[] = [];

    if (traj.mustCall && traj.mustCall.length > 0) {
      const missing = traj.mustCall.filter((n) => !called.has(n));
      const hit = traj.mustCall.length - missing.length;
      conditions.push({
        ratio: hit / traj.mustCall.length,
        ok: missing.length === 0,
        label: missing.length === 0 ? 'all mustCall satisfied' : `missing calls: ${missing.join(', ')}`,
      });
    }
    if (traj.mustNotCall && traj.mustNotCall.length > 0) {
      const violated = traj.mustNotCall.filter((n) => called.has(n));
      const okCount = traj.mustNotCall.length - violated.length;
      conditions.push({
        ratio: okCount / traj.mustNotCall.length,
        ok: violated.length === 0,
        label: violated.length === 0 ? 'no forbidden calls' : `forbidden calls: ${violated.join(', ')}`,
      });
    }
    if (traj.maxCalls !== undefined) {
      if (calls.length <= traj.maxCalls) {
        conditions.push({ ratio: 1, ok: true, label: `call count ${calls.length} <= ${traj.maxCalls}` });
      } else {
        conditions.push({
          ratio: traj.maxCalls / calls.length,
          ok: false,
          label: `call count ${calls.length} > ${traj.maxCalls}`,
        });
      }
    }
    if (traj.mustReadPaths && traj.mustReadPaths.length > 0) {
      const read = new Set(calls.flatMap((c) => readPathsOf(c)));
      const missing = traj.mustReadPaths.filter((p) => !read.has(normPath(p)));
      const hit = traj.mustReadPaths.length - missing.length;
      conditions.push({
        ratio: hit / traj.mustReadPaths.length,
        ok: missing.length === 0,
        label: missing.length === 0 ? 'all mustReadPaths satisfied' : `unread paths: ${missing.join(', ')}`,
      });
    }

    if (conditions.length === 0) {
      return { value: 0, verdict: 'error', reason: 'empty trajectory spec' };
    }
    const value = conditions.reduce((a, c) => a + c.ratio, 0) / conditions.length;
    if (conditions.every((c) => c.ok)) {
      return { value: 1, verdict: 'correct', reason: `all ${conditions.length} trajectory conditions satisfied` };
    }
    const firstFailure = conditions.find((c) => !c.ok);
    return { value, verdict: 'incorrect', reason: firstFailure?.label ?? 'trajectory mismatch' };
  },
};
