#!/usr/bin/env node
// Converter: kobest pack (P10-24).
// Origin: skt/kobest_v1 (CC-BY-SA-4.0), test splits, 200 items per task.
// Label semantics verified against sample rows on 2026-09-25:
// boolq 1=예/0=아니오; copa label->alternative_{label+1}; wic 1=같은 의미;
// hellaswag label(0-3)->ending_{label+1}; sentineg 1=긍정/0=부정.
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

const PACK_ID = 'kobest';
const DATASET = 'skt/kobest_v1';
const REVISION = 'a5ea15e3ac77ed694b79f6204eb31889a2ba989f';
const ORIGIN_URL = 'https://huggingface.co/datasets/skt/kobest_v1';
const PER_TASK = 200;

const SYSTEM_PROMPT =
  '문제를 풀고 마지막 줄에 `정답: X`라고 쓰세요. X는 정답 선택지의 알파벳입니다.';

function letter(i) {
  return 'ABCD'[i];
}

function convertTask(task, row, rowIdx) {
  const id = `kobest-${task}-${rowIdx}`;
  const meta = { task, lang: 'ko' };
  if (task === 'boolq') {
    const choices = ['아니오', '예'];
    return {
      id,
      input: `지문: ${row.paragraph}\n질문: ${row.question}\n\nA. 아니오\nB. 예`,
      choices,
      target: row.label === 1 ? 'B' : 'A',
      metadata: meta,
    };
  }
  if (task === 'copa') {
    const choices = [row.alternative_1, row.alternative_2];
    const kind = row.question === '원인' ? '원인' : '결과';
    return {
      id,
      input: `전제: ${row.premise}\n위 전제의 ${kind}으로 가장 적절한 것은?\n\nA. ${choices[0]}\nB. ${choices[1]}`,
      choices,
      target: letter(row.label),
      metadata: meta,
    };
  }
  if (task === 'wic') {
    const choices = ['다른 의미', '같은 의미'];
    return {
      id,
      input: `단어 '${row.word}'의 의미가 다음 두 문장에서 같은지 판단하세요.\n문장 1: ${row.context_1}\n문장 2: ${row.context_2}\n\nA. 다른 의미\nB. 같은 의미`,
      choices,
      target: row.label === 1 ? 'B' : 'A',
      metadata: meta,
    };
  }
  if (task === 'hellaswag') {
    const choices = [row.ending_1, row.ending_2, row.ending_3, row.ending_4];
    return {
      id,
      input: `상황: ${row.context}\n이어질 결말로 가장 적절한 것은?\n\nA. ${choices[0]}\nB. ${choices[1]}\nC. ${choices[2]}\nD. ${choices[3]}`,
      choices,
      target: letter(row.label),
      metadata: meta,
    };
  }
  if (task === 'sentineg') {
    const choices = ['부정', '긍정'];
    return {
      id,
      input: `문장: ${row.sentence}\n이 문장에 드러난 감정은?\n\nA. 부정\nB. 긍정`,
      choices,
      target: row.label === 1 ? 'B' : 'A',
      metadata: meta,
    };
  }
  throw new Error(`unknown task ${task}`);
}

export async function build() {
  const rng = mulberry32(SEED);
  const tasks = ['boolq', 'copa', 'wic', 'hellaswag', 'sentineg'];
  const counts = {};
  const samples = [];
  for (const task of tasks) {
    const { rows, total } = await fetchAllDsRows(DATASET, task, 'test');
    counts[task] = { fetched: rows.length, total };
    const order = shuffleInPlace(rows.map((_, i) => i), rng).slice(0, PER_TASK);
    if (order.length < PER_TASK) {
      throw new Error(`kobest: task ${task} has only ${order.length} rows`);
    }
    for (const i of order) samples.push(convertTask(task, rows[i], i));
    log(`kobest: ${task} fetched ${rows.length}/${total}`);
  }
  // Deterministic bundle order.
  shuffleInPlace(samples, rng);
  assertUniqueIds(samples, PACK_ID);
  const tagged = tagReliability(samples, SEED);
  writeManifest(PACK_ID, {
    schemaVersion: '1.0',
    id: PACK_ID,
    version: '1.0.0',
    title: { ko: 'KoBEST 한국어 이해 5종', en: 'KoBEST Korean NLU x5' },
    description: {
      ko: 'KoBEST 5개 과제(boolq/copa/wic/hellaswag/sentineg) 각 200문항, 총 1000문항(Q1, 과제별 정답 형식에 맞는 선택형).',
      en: '200 items each from 5 KoBEST tasks (Q1), 1000 total, with task-appropriate choice formats.',
    },
    category: 'Q1',
    lang: ['ko'],
    license: { id: 'CC-BY-SA-4.0', source: ORIGIN_URL, attribution: 'SK Telecom (skt/kobest_v1)' },
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
    tiers: { smoke: 25, standard: 250, full: 'all' },
    stratifyBy: 'task',
  });
  writeJsonl(`${EVALS_ROOT}/${PACK_ID}/samples.jsonl`, samples);
  writeLicense(PACK_ID, [
    `# License — ${PACK_ID}`,
    '',
    `- Origin: ${ORIGIN_URL} (test splits)`,
    `- Revision (HF commit sha): ${REVISION}`,
    `- Download date (UTC): ${DOWNLOAD_DATE}`,
    `- Converter: scripts/evals/convert-kobest.mjs v${CONVERTER_VERSION} (seed ${SEED})`,
    `- License: CC-BY-SA-4.0 (marked accordingly; share-alike applies to adaptations)`,
    `- Bundled samples: ${samples.length} (${PER_TASK}/task x ${tasks.length})`,
    `- Source rows: ${JSON.stringify(counts)}`,
  ]);
  log(`kobest: wrote ${samples.length} samples, reliability=${tagged}`);
  return { packId: PACK_ID, samples: samples.length, counts };
}

if (isMain(import.meta.url)) {
  await build();
}
