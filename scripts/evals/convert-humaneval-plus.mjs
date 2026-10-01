#!/usr/bin/env node
// Converter: humaneval-plus pack (P10-24).
// Origin: evalplus/humanevalplus (Apache-2.0), test split, 164 rows.
// code.tests = <test field> + "\ncheck(<entry_point>)" per the EvalPlus harness
// convention. NOTE: running this pack needs a Python runtime opt-in.
import {
  CONVERTER_VERSION,
  DOWNLOAD_DATE,
  EVALS_ROOT,
  SEED,
  assertUniqueIds,
  fetchAllDsRows,
  isMain,
  log,
  tagReliability,
  writeJsonl,
  writeLicense,
  writeManifest,
} from './lib.mjs';

const PACK_ID = 'humaneval-plus';
const DATASET = 'evalplus/humanevalplus';
const REVISION = 'd32357cf319e50e9c8d8dab5ea876c72b0fd321b';
const ORIGIN_URL = 'https://huggingface.co/datasets/evalplus/humanevalplus';

const SYSTEM_PROMPT =
  'Complete the Python function from the prompt. Return only one ```python code block that defines the function. Do not use network access.';

export async function build() {
  const { rows, total } = await fetchAllDsRows(DATASET, 'default', 'test');
  log(`humaneval-plus: fetched ${rows.length}/${total}`);
  const samples = rows.map((row) => {
    if (!row.entry_point || !row.test || !row.prompt) {
      throw new Error(`humaneval-plus: row ${row.task_id} missing entry_point/test/prompt`);
    }
    return {
      id: `humaneval-plus-${String(row.task_id).replace(/[^A-Za-z0-9]+/g, '-')}`,
      input: row.prompt,
      reference: row.canonical_solution,
      code: {
        language: 'python',
        entryPoint: row.entry_point,
        tests: `${row.test}\ncheck(${row.entry_point})\n`,
      },
      metadata: { task: 'humaneval-plus', lang: 'en' },
    };
  });
  assertUniqueIds(samples, PACK_ID);
  const tagged = tagReliability(samples, SEED);
  const testBytes = samples.reduce((n, s) => n + s.code.tests.length, 0);
  writeManifest(PACK_ID, {
    schemaVersion: '1.0',
    id: PACK_ID,
    version: '1.0.0',
    title: { ko: 'HumanEval+ 파이썬 코딩', en: 'HumanEval+ Python coding' },
    description: {
      ko: 'EvalPlus HumanEval+ 164 과제(Q5). 실행에는 Python 런타임 동의가 필요합니다.',
      en: '164 EvalPlus HumanEval+ tasks (Q5). Execution requires Python runtime opt-in.',
    },
    category: 'Q5',
    lang: ['en'],
    license: { id: 'Apache-2.0', source: ORIGIN_URL, attribution: 'EvalPlus (evalplus/humanevalplus)' },
    kind: 'single_turn',
    source: { type: 'jsonl', file: 'samples.jsonl' },
    systemPrompt: SYSTEM_PROMPT,
    scorers: [{ type: 'code_exec' }],
    metrics: [
      {
        id: 'pass_at_1',
        description: { ko: '1회 시도 통과율', en: 'Single-attempt pass rate' },
        source: 'score',
        aggregation: 'pass_at_k',
        k: 1,
        lowerIsBetter: false,
        scoreType: 'binary',
        range: { min: 0, max: 1 },
        normalization: { kind: 'baseline', baseline: 0 },
      },
    ],
    tiers: { smoke: 10, standard: 50, full: 'all' },
    requires: { codeRuntime: 'python' },
  });
  writeJsonl(`${EVALS_ROOT}/${PACK_ID}/samples.jsonl`, samples);
  writeLicense(PACK_ID, [
    `# License — ${PACK_ID}`,
    '',
    `- Origin: ${ORIGIN_URL} (test split, ${total} rows)`,
    `- Revision (HF commit sha): ${REVISION}`,
    `- Download date (UTC): ${DOWNLOAD_DATE}`,
    `- Converter: scripts/evals/convert-humaneval-plus.mjs v${CONVERTER_VERSION} (seed ${SEED})`,
    `- License: Apache-2.0`,
    `- Bundled samples: ${samples.length} (test payload ~${(testBytes / 1048576).toFixed(1)} MiB UTF-8)`,
    `- NOTE: executing this pack requires a Python runtime opt-in at run time.`,
  ]);
  log(`humaneval-plus: wrote ${samples.length} samples, reliability=${tagged}`);
  return { packId: PACK_ID, samples: samples.length };
}

if (isMain(import.meta.url)) {
  await build();
}
