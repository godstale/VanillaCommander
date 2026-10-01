#!/usr/bin/env node
// Converter: gsm8k pack (P10-24).
// Origin: openai/gsm8k (MIT), test split, 1319 rows via datasets-server.
// Drops solution text; target = number after `####`.
import {
  CONVERTER_VERSION,
  DOWNLOAD_DATE,
  EVALS_ROOT,
  SEED,
  assertUniqueIds,
  fetchAllDsRows,
  isMain,
  log,
  metricAccuracy,
  tagReliability,
  writeJsonl,
  writeLicense,
  writeManifest,
} from './lib.mjs';

const PACK_ID = 'gsm8k';
const DATASET = 'openai/gsm8k';
const REVISION = '740312add88f781978c0658806c59bc2815b9866';
const ORIGIN_URL = 'https://huggingface.co/datasets/openai/gsm8k';

const SYSTEM_PROMPT =
  'Solve the problem. Write the final line as `ANSWER: <number>` and nothing else on that line.';

function parseTarget(answer) {
  const m = /####\s*(-?[\d,]+(?:\.\d+)?)/.exec(answer);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export async function build() {
  const { rows, total } = await fetchAllDsRows(DATASET, 'main', 'test');
  log(`gsm8k: fetched ${rows.length}/${total}`);
  const samples = [];
  let skipped = 0;
  rows.forEach((row, i) => {
    const target = parseTarget(row.answer);
    if (target === null) {
      skipped += 1;
      return;
    }
    samples.push({
      id: `gsm8k-test-${i}`,
      input: row.question,
      target,
      metadata: { task: 'gsm8k', lang: 'en' },
    });
  });
  assertUniqueIds(samples, PACK_ID);
  const tagged = tagReliability(samples, SEED);
  const dir = writeManifest(PACK_ID, {
    schemaVersion: '1.0',
    id: PACK_ID,
    version: '1.0.0',
    title: { ko: 'GSM8K 초등 수학 문제', en: 'GSM8K grade-school math' },
    description: {
      ko: '초등 수준 수학 문장제 1319개(Q2). 풀이 텍스트는 포함하지 않으며 정답 숫자만 평가합니다.',
      en: '1319 grade-school math word problems (Q2). Solution text is dropped; only the final number is scored.',
    },
    category: 'Q2',
    lang: ['en'],
    license: { id: 'MIT', source: ORIGIN_URL, attribution: 'OpenAI (openai/gsm8k)' },
    kind: 'single_turn',
    source: { type: 'jsonl', file: 'samples.jsonl' },
    systemPrompt: SYSTEM_PROMPT,
    scorers: [{ type: 'numeric' }],
    metrics: [metricAccuracy(0)],
    tiers: { smoke: 20, standard: 100, full: 'all' },
  });
  writeJsonl(`${EVALS_ROOT}/${PACK_ID}/samples.jsonl`, samples);
  void dir;
  writeLicense(PACK_ID, [
    `# License — ${PACK_ID}`,
    '',
    `- Origin: ${ORIGIN_URL} (test split, ${total} rows)`,
    `- Revision (HF commit sha): ${REVISION}`,
    `- Download date (UTC): ${DOWNLOAD_DATE}`,
    `- Converter: scripts/evals/convert-gsm8k.mjs v${CONVERTER_VERSION} (seed ${SEED})`,
    `- License: MIT (solution text dropped; only question + final number bundled)`,
    `- Bundled samples: ${samples.length} (skipped ${skipped} unparseable)`,
  ]);
  log(`gsm8k: wrote ${samples.length} samples, reliability=${tagged}, skipped=${skipped}`);
  return { packId: PACK_ID, samples: samples.length, skipped };
}

if (isMain(import.meta.url)) {
  await build();
}
