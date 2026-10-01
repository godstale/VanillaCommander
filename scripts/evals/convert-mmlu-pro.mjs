#!/usr/bin/env node
// Converter: mmlu-pro pack (P10-24).
// Origin: TIGER-Lab/MMLU-Pro (MIT), test split, 12032 rows via datasets-server.
// Bundles a stratified 14 subjects x 100 = 1400 subset (seed 20260925).
// Drops cot_content. Option counts vary (9-10); target = answer letter.
import {
  CONVERTER_VERSION,
  DOWNLOAD_DATE,
  EVALS_ROOT,
  SEED,
  assertUniqueIds,
  fetchAllDsRows,
  isMain,
  log,
  mulberry32,
  shuffleInPlace,
  tagReliability,
  writeJsonl,
  writeLicense,
  writeManifest,
} from './lib.mjs';

const PACK_ID = 'mmlu-pro';
const DATASET = 'TIGER-Lab/MMLU-Pro';
const REVISION = 'b189ec765aa7ed75c8acfea42df31fdae71f97be';
const ORIGIN_URL = 'https://huggingface.co/datasets/TIGER-Lab/MMLU-Pro';
const PER_SUBJECT = 100;

const LETTERS = 'ABCDEFGHIJ';

const SYSTEM_PROMPT =
  'Solve the problem, then write the final line as `ANSWER: X` where X is the letter of the correct choice.';

export async function build() {
  const { rows, total } = await fetchAllDsRows(DATASET, 'default', 'test');
  log(`mmlu-pro: fetched ${rows.length}/${total}`);
  const rng = mulberry32(SEED);
  const byCat = new Map();
  for (let i = 0; i < rows.length; i++) {
    const cat = rows[i].category;
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(i);
  }
  const categories = [...byCat.keys()].sort();
  log(`mmlu-pro: categories (${categories.length}): ${categories.join(', ')}`);
  const picked = [];
  for (const cat of categories) {
    const idxs = shuffleInPlace([...byCat.get(cat)], rng);
    if (idxs.length < PER_SUBJECT) {
      throw new Error(`mmlu-pro: category ${cat} has only ${idxs.length} rows`);
    }
    picked.push(...idxs.slice(0, PER_SUBJECT));
  }
  const bundleOrder = shuffleInPlace(picked, rng);
  const seenQid = new Set();
  const samples = bundleOrder.map((i) => {
    const row = rows[i];
    const letters = LETTERS.slice(0, row.options.length);
    if (!letters.includes(row.answer)) {
      throw new Error(`mmlu-pro: row ${i} answer ${row.answer} outside ${row.options.length} options`);
    }
    let qid = `mmlu-pro-${row.question_id}`;
    if (seenQid.has(qid)) qid += `-${i}`;
    seenQid.add(qid);
    const choices = row.options.map((o, k) => `${letters[k]}. ${o}`);
    return {
      id: qid,
      input: `${row.question}\n\n${choices.join('\n')}`,
      choices: row.options,
      target: row.answer,
      metadata: { category: row.category, subject: row.category, lang: 'en' },
    };
  });
  assertUniqueIds(samples, PACK_ID);
  const tagged = tagReliability(samples, SEED);
  writeManifest(PACK_ID, {
    schemaVersion: '1.0',
    id: PACK_ID,
    version: '1.0.0',
    title: { ko: 'MMLU-Pro (14개 분야 층화 1400)', en: 'MMLU-Pro (stratified 1400, 14 subjects)' },
    description: {
      ko: 'MMLU-Pro 테스트의 분야별 층화 표본 1400개(Q1, 10지선다 기준 자동 보정). chain-of-thought는 포함하지 않습니다.',
      en: 'Stratified sample of the MMLU-Pro test set, 100 per subject x 14 (Q1, 10-way baseline auto). Chain-of-thought content is dropped.',
    },
    category: 'Q1',
    lang: ['en'],
    license: { id: 'MIT', source: ORIGIN_URL, attribution: 'TIGER-Lab (TIGER-Lab/MMLU-Pro)' },
    kind: 'single_turn',
    source: { type: 'jsonl', file: 'samples.jsonl' },
    systemPrompt: SYSTEM_PROMPT,
    scorers: [{ type: 'choice' }],
    metrics: [
      {
        id: 'accuracy',
        description: { ko: '정확도', en: 'Accuracy' },
        source: 'score',
        aggregation: 'mean',
        lowerIsBetter: false,
        scoreType: 'binary',
        range: { min: 0, max: 1 },
        normalization: { kind: 'baseline', baseline: 'auto_choices' },
      },
    ],
    tiers: { smoke: 28, standard: 140, full: 'all' },
    stratifyBy: 'category',
  });
  writeJsonl(`${EVALS_ROOT}/${PACK_ID}/samples.jsonl`, samples);
  writeLicense(PACK_ID, [
    `# License — ${PACK_ID}`,
    '',
    `- Origin: ${ORIGIN_URL} (test split, ${total} rows)`,
    `- Revision (HF commit sha): ${REVISION}`,
    `- Download date (UTC): ${DOWNLOAD_DATE}`,
    `- Converter: scripts/evals/convert-mmlu-pro.mjs v${CONVERTER_VERSION} (seed ${SEED})`,
    `- License: MIT (cot_content dropped)`,
    `- Bundled samples: ${samples.length} (stratified ${PER_SUBJECT}/subject x ${categories.length})`,
  ]);
  log(`mmlu-pro: wrote ${samples.length} samples, reliability=${tagged}`);
  return { packId: PACK_ID, samples: samples.length, categories };
}

if (isMain(import.meta.url)) {
  await build();
}
