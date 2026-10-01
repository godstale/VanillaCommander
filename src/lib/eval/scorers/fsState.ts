import { z } from 'zod';
import type { FsExpectation } from '../types';
import type { Scorer, ScorerInput, ScorerResult } from './types';
import { parseScorerOptions } from './types';

const OptionsSchema = z.object({});

interface StateFile {
  path: string;
  hash: string;
  content?: string;
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function matchSegment(globSeg: string, pathSeg: string): boolean {
  let re = '';
  for (const ch of globSeg) {
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += escapeRegExp(ch);
  }
  return new RegExp(`^${re}$`).test(pathSeg);
}

export function matchFsGlob(glob: string, filePath: string): boolean {
  const gSegs = normPath(glob).split('/');
  const pSegs = normPath(filePath).split('/');
  const memo = new Map<string, boolean>();
  const rec = (gi: number, pi: number): boolean => {
    const key = `${gi}:${pi}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (gi === gSegs.length) {
      result = pi === pSegs.length;
    } else if (gSegs[gi] === '**') {
      result = false;
      for (let k = pi; k <= pSegs.length; k++) {
        if (rec(gi + 1, k)) {
          result = true;
          break;
        }
      }
    } else if (pi === pSegs.length) {
      result = false;
    } else if (!matchSegment(gSegs[gi], pSegs[pi])) {
      result = false;
    } else {
      result = rec(gi + 1, pi + 1);
    }
    memo.set(key, result);
    return result;
  };
  return rec(0, 0);
}

function extractInitialState(extra: unknown): { files: StateFile[] } | null {
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) return null;
  const initial = (extra as Record<string, unknown>)['initialState'];
  if (initial === null || typeof initial !== 'object' || Array.isArray(initial)) return null;
  const files = (initial as Record<string, unknown>)['files'];
  if (!Array.isArray(files)) return null;
  const valid: StateFile[] = [];
  for (const f of files) {
    if (f === null || typeof f !== 'object' || Array.isArray(f)) return null;
    const rec = f as Record<string, unknown>;
    if (typeof rec['path'] !== 'string' || typeof rec['hash'] !== 'string') return null;
    const entry: StateFile = { path: rec['path'], hash: rec['hash'] };
    if (typeof rec['content'] === 'string') entry.content = rec['content'];
    valid.push(entry);
  }
  return { files: valid };
}

function checkContentExpectation(
  exp: { path: string; contains?: string[]; notContains?: string[]; regex?: string; equals?: string; caseSensitive?: boolean },
  files: Map<string, StateFile>,
): { pass: boolean; reason: string } {
  const file = files.get(normPath(exp.path));
  if (!file) return { pass: false, reason: `missing file ${exp.path}` };
  if (file.content === undefined) {
    return { pass: false, reason: `no text content for ${exp.path}` };
  }
  const cs = exp.caseSensitive ?? true;
  const hay = cs ? file.content : file.content.toLowerCase();
  for (const needle of exp.contains ?? []) {
    const n = cs ? needle : needle.toLowerCase();
    if (!hay.includes(n)) return { pass: false, reason: `${exp.path}: missing ${JSON.stringify(needle)}` };
  }
  for (const needle of exp.notContains ?? []) {
    const n = cs ? needle : needle.toLowerCase();
    if (hay.includes(n)) return { pass: false, reason: `${exp.path}: forbidden ${JSON.stringify(needle)} present` };
  }
  if (exp.regex !== undefined) {
    let re: RegExp;
    try {
      re = new RegExp(exp.regex, cs ? '' : 'i');
    } catch {
      return { pass: false, reason: `${exp.path}: invalid regex ${JSON.stringify(exp.regex)}` };
    }
    if (!re.test(file.content)) return { pass: false, reason: `${exp.path}: regex ${JSON.stringify(exp.regex)} did not match` };
  }
  if (exp.equals !== undefined) {
    const ok = cs ? file.content === exp.equals : hay === exp.equals.toLowerCase();
    if (!ok) return { pass: false, reason: `${exp.path}: content differs from expected` };
  }
  return { pass: true, reason: `${exp.path}: content ok` };
}

function checkExpectation(
  exp: FsExpectation,
  finalFiles: Map<string, StateFile>,
  initialFiles: Map<string, StateFile> | null,
): { pass: boolean; reason: string } {
  if ('glob' in exp) {
    if ('unchanged' in exp) {
      if (!initialFiles) {
        return { pass: false, reason: `${exp.glob}: no initial state for unchanged check` };
      }
      const paths = new Set<string>();
      for (const f of finalFiles.values()) {
        if (matchFsGlob(exp.glob, f.path)) paths.add(normPath(f.path));
      }
      for (const f of initialFiles.values()) {
        if (matchFsGlob(exp.glob, f.path)) paths.add(normPath(f.path));
      }
      for (const p of paths) {
        const before = initialFiles.get(p);
        const after = finalFiles.get(p);
        if (!before || !after) {
          return { pass: false, reason: `${p}: ${before ? 'deleted' : 'added'}` };
        }
        if (before.hash !== after.hash) {
          return { pass: false, reason: `${p}: modified` };
        }
      }
      return { pass: true, reason: `${exp.glob}: unchanged` };
    }
    let count = 0;
    for (const f of finalFiles.values()) {
      if (matchFsGlob(exp.glob, f.path)) count += 1;
    }
    if (count <= exp.maxFiles) {
      return { pass: true, reason: `${exp.glob}: ${count} <= ${exp.maxFiles} files` };
    }
    return { pass: false, reason: `${exp.glob}: ${count} > ${exp.maxFiles} files` };
  }
  if ('exists' in exp) {
    const found = finalFiles.has(normPath(exp.path));
    if (found === exp.exists) {
      return { pass: true, reason: `${exp.path}: exists=${exp.exists} ok` };
    }
    return { pass: false, reason: `${exp.path}: exists=${found}, expected ${exp.exists}` };
  }
  return checkContentExpectation(exp, finalFiles);
}

export const fsStateScorer: Scorer = {
  type: 'fs_state',
  optionsSchema: OptionsSchema,
  async score(input: ScorerInput, options: unknown): Promise<ScorerResult> {
    parseScorerOptions(OptionsSchema, options);
    const expectations = input.sample.expectState;
    if (!expectations || expectations.length === 0) {
      return { value: 0, verdict: 'error', reason: 'no expectState in sample' };
    }
    const finalState = input.finalState;
    if (!finalState) {
      return { value: 0, verdict: 'error', reason: 'no finalState from solver' };
    }
    const initial = extractInitialState(input.extra);
    const finalFiles = new Map<string, StateFile>();
    for (const f of finalState.files) {
      finalFiles.set(normPath(f.path), { path: f.path, hash: f.hash, content: f.content });
    }
    const initialFiles = initial
      ? new Map<string, StateFile>(initial.files.map((f) => [normPath(f.path), f]))
      : null;
    let passed = 0;
    let firstFailure = '';
    for (const exp of expectations) {
      const r = checkExpectation(exp, finalFiles, initialFiles);
      if (r.pass) passed += 1;
      else if (!firstFailure) firstFailure = r.reason;
    }
    const value = passed / expectations.length;
    if (passed === expectations.length) {
      return { value: 1, verdict: 'correct', reason: `all ${passed} fs expectations passed` };
    }
    return { value, verdict: 'incorrect', reason: firstFailure || `matched ${passed}/${expectations.length}` };
  },
};
