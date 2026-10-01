import { z } from 'zod';
import type { EvalRunConfig } from '../types';
import type { Scorer, ScorerInput, ScorerResult } from './types';
import { parseScorerOptions } from './types';
import { registerScorer } from './index';
import { extractCode } from './codeExtract';
import { runJsTests } from '../runtimes/jsWorkerHost';
import { canRunPython, runPythonTests } from '../runtimes/python';
import { detectRuntimesCached } from '../runtimes/detect';
import { getIntegrationSettings } from '@/lib/db/repositories/integrationsRepo';

const OptionsSchema = z.object({
  timeoutMs: z.number().int().positive().default(5000),
});

function firstLine(s: string): string {
  const line = s.split('\n')[0].trim();
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

export const codeExecScorer: Scorer = {
  type: 'code_exec',
  optionsSchema: OptionsSchema,
  requiresAsync: true,
  async score(input: ScorerInput, options: unknown): Promise<ScorerResult> {
    const opts = parseScorerOptions(OptionsSchema, options);
    const spec = input.sample.code;
    if (!spec) {
      return { value: 0, verdict: 'error', reason: 'sample has no code spec' };
    }
    const { entryPoint, tests, language } = spec;
    const extracted = extractCode(input.outputText, language, entryPoint);
    if (extracted.code === null) {
      return { value: 0, verdict: 'no_answer', reason: extracted.reason };
    }
    const code = extracted.code;
    if (language === 'js') {
      const r = await runJsTests(code, tests, opts.timeoutMs);
      if (r.timedOut) {
        return { value: 0, verdict: 'error', reason: firstLine(r.error ?? 'JS execution timed out') };
      }
      if (r.passed === 0 && r.failed === 0) {
        return { value: 0, verdict: 'incorrect', reason: 'no test assertions ran' };
      }
      if (r.failed === 0) {
        return { value: 1, verdict: 'correct', reason: `all ${r.passed} assertion(s) passed`, extracted: code };
      }
      return {
        value: 0,
        verdict: 'incorrect',
        reason: `${r.failed} failed / ${r.passed} passed: ${firstLine(r.error ?? 'assertion failed')}`,
        extracted: code,
      };
    }
    const [settings, runtimes] = await Promise.all([
      getIntegrationSettings(),
      detectRuntimesCached(),
    ]);
    const confirmations = (input.extra?.['confirmations'] ?? null) as
      | EvalRunConfig['confirmations']
      | null;
    if (!canRunPython(settings, confirmations, runtimes)) {
      throw new Error('python execution not permitted');
    }
    const r = await runPythonTests(code, tests, entryPoint);
    if (r.timedOut) {
      return { value: 0, verdict: 'error', reason: 'Python execution timed out after 10s' };
    }
    if (r.passed) {
      return {
        value: 1,
        verdict: 'correct',
        reason: 'all python tests passed (exit 0)',
        extracted: code,
      };
    }
    const detail = firstLine(r.stderr || r.stdout || `exit ${r.exitCode}`);
    return { value: 0, verdict: 'incorrect', reason: `python tests failed: ${detail}`, extracted: code };
  },
};

registerScorer(codeExecScorer);
