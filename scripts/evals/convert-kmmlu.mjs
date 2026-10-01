#!/usr/bin/env node
// Converter: kmmlu pack (P10-24).
// Origin: HAERAE-HUB/KMMLU (CC-BY-ND-4.0). The 45 `data/*-test.csv` files are
// bundled UNMODIFIED under data/ (byte-identical to the pinned revision) and
// loaded at runtime via source.type `kmmlu-csv`.
// NOTE: upstream headers are inconsistent: 44 files use
// `question,answer,A,B,C,D,Category,Human Accuracy` but `math-test.csv` uses
// `question,answer,A,B,C,D,Human Accuracy,Category` (columns 7-8 swapped).
// Origin files are NOT edited (ND clause); the runtime converter
// (src/lib/eval/packs/sources/kmmluCsv.ts) maps columns by header name.
import { createHash } from 'node:crypto';
import {
  CONVERTER_VERSION,
  DOWNLOAD_DATE,
  EVALS_ROOT,
  ensureDir,
  fetchBytes,
  isMain,
  log,
  writeLicense,
  writeManifest,
  writeText,
} from './lib.mjs';

const PACK_ID = 'kmmlu';
const REVISION = 'd61b3f19e552c576bf5960dd24289763edc36a88';
const ORIGIN_URL = 'https://huggingface.co/datasets/HAERAE-HUB/KMMLU';

const SUBJECTS = [
  'Accounting', 'Agricultural-Sciences', 'Aviation-Engineering-and-Maintenance',
  'Biology', 'Chemical-Engineering', 'Chemistry', 'Civil-Engineering',
  'Computer-Science', 'Construction', 'Criminal-Law', 'Ecology', 'Economics',
  'Education', 'Electrical-Engineering', 'Electronics-Engineering',
  'Energy-Management', 'Environmental-Science', 'Fashion', 'Food-Processing',
  'Gas-Technology-and-Engineering', 'Geomatics', 'Health', 'Industrial-Engineer',
  'Information-Technology', 'Interior-Architecture-and-Design', 'Law',
  'Machine-Design-and-Manufacturing', 'Management', 'Maritime-Engineering',
  'Marketing', 'Materials-Engineering', 'Mechanical-Engineering',
  'Nondestructive-Testing', 'Patent', 'Political-Science-and-Sociology',
  'Psychology', 'Public-Safety', 'Railway-and-Automotive-Engineering',
  'Real-Estate', 'Refrigerating-Machinery', 'Social-Welfare', 'Taxation',
  'Telecommunications-and-Wireless-Technology', 'korean-history', 'math',
];

const SYSTEM_PROMPT =
  '문제를 풀고 마지막 줄에 `정답: X`라고 쓰세요. X는 정답 선택지의 알파벳입니다.';

export async function build() {
  const dataDir = `${EVALS_ROOT}/${PACK_ID}/data`;
  ensureDir(dataDir);
  const files = [];
  const hashes = {};
  let n = 0;
  for (const subject of SUBJECTS) {
    const name = `${subject}-test.csv`;
    const url = `${ORIGIN_URL}/resolve/${REVISION}/data/${name}`;
    const bytes = await fetchBytes(url);
    // Byte-identical write: no transcoding, no newline normalization.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${dataDir}/${name}`, bytes);
    const sha = createHash('sha256').update(bytes).digest('hex');
    hashes[`data/${name}`] = sha;
    const header = bytes.subarray(0, bytes.indexOf(0x0a)).toString('utf8').trim();
    files.push(`data/${name}`);
    n += 1;
    if (n % 15 === 0) log(`kmmlu: downloaded ${n}/${SUBJECTS.length}`);
    await new Promise((r) => setTimeout(r, 400));
    void header;
  }
  // Count data rows (header excluded) for the tier report.
  const { readFileSync } = await import('node:fs');
  let totalRows = 0;
  const headersSeen = {};
  for (const f of files) {
    const text = readFileSync(`${EVALS_ROOT}/${PACK_ID}/${f}`, 'utf8');
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    totalRows += Math.max(0, lines.length - 1);
    headersSeen[lines[0]?.trim()] = (headersSeen[lines[0]?.trim()] ?? 0) + 1;
  }
  log(`kmmlu: headers seen: ${JSON.stringify(headersSeen)}; data rows: ${totalRows}`);
  const fullTier = totalRows >= 2250 ? 2250 : 'all';
  writeManifest(PACK_ID, {
    schemaVersion: '1.0',
    id: PACK_ID,
    version: '1.0.0',
    title: { ko: 'KMMLU 한국어 학문 지식', en: 'KMMLU Korean academic knowledge' },
    description: {
      ko: '45개 분야 한국어 4지선다(Q1). 원본 CSV를 수정 없이 그대로 묶었으며(CC-BY-ND) 런타임에 kmmlu-csv 어댑터로 읽습니다.',
      en: '45-subject Korean 4-way multiple choice (Q1). Origin CSVs are bundled unmodified (CC-BY-ND) and read at runtime via the kmmlu-csv adapter.',
    },
    category: 'Q1',
    lang: ['ko'],
    license: {
      id: 'CC-BY-ND-4.0',
      source: ORIGIN_URL,
      attribution: 'HAERAE-HUB (HAERAE-HUB/KMMLU); unmodified originals',
    },
    kind: 'single_turn',
    source: { type: 'kmmlu-csv', files },
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
    tiers: { smoke: 45, standard: 450, full: fullTier },
    stratifyBy: 'subject',
  });
  writeLicense(PACK_ID, [
    `# License — ${PACK_ID}`,
    '',
    `- Origin: ${ORIGIN_URL} (data/*-test.csv, ${SUBJECTS.length} files)`,
    `- Revision (HF commit sha): ${REVISION}`,
    `- Download date (UTC): ${DOWNLOAD_DATE}`,
    `- Converter: scripts/evals/convert-kmmlu.mjs v${CONVERTER_VERSION}`,
    `- License: CC-BY-ND-4.0 — origin files bundled UNMODIFIED under data/ (no derivatives)`,
    `- Header note: 44 files use \`question,answer,A,B,C,D,Category,Human Accuracy\`;`,
    `  math-test.csv uses \`question,answer,A,B,C,D,Human Accuracy,Category\` (cols 7-8 swapped upstream).`,
    `  The runtime kmmluCsv adapter maps columns by header name; see task report.`,
    `- Data rows (excl. headers): ${totalRows}`,
  ]);
  writeText(`${EVALS_ROOT}/${PACK_ID}/checksums.sha256`, `${Object.entries(hashes).map(([f, h]) => `${h}  ${f}`).join('\n')}\n`);
  log(`kmmlu: wrote ${files.length} files, ${totalRows} rows, full tier=${fullTier}`);
  return { packId: PACK_ID, files: files.length, totalRows, fullTier, hashes };
}

if (isMain(import.meta.url)) {
  await build();
}
