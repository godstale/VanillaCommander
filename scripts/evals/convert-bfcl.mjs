#!/usr/bin/env node
// Converter: bfcl pack (P10-24).
// Origin: ShishirPatil/gorilla (Apache-2.0), BFCL v3 non-live Python files at
// pinned commit c15b2a1: question files BFCL_v3_{simple,multiple,parallel,
// parallel_multiple,irrelevance}.json (JSONL) + possible_answer/
// BFCL_v3_{simple,multiple,parallel,parallel_multiple}.json (JSONL).
// 100 items per category (fixed seed). Function docs become per-sample tools
// (BFCL `dict` params mapped to JSON Schema `object`); possible_answer
// allowed-value lists become expectedToolCalls verbatim; irrelevance items get
// the no_tool_call scorer and no expectedToolCalls.
import {
  CONVERTER_VERSION,
  DOWNLOAD_DATE,
  EVALS_ROOT,
  SEED,
  assertUniqueIds,
  fetchBytes,
  isMain,
  log,
  mulberry32,
  shuffleInPlace,
  tagReliability,
  writeJsonl,
  writeLicense,
  writeManifest,
} from './lib.mjs';

const PACK_ID = 'bfcl';
const COMMIT = 'c15b2a151662cac9839c96d7dfb1493b5329c975';
const ORIGIN_URL = 'https://github.com/ShishirPatil/gorilla';
const DATA_BASE = `${'https://raw.githubusercontent.com'}/ShishirPatil/gorilla/${COMMIT}/berkeley-function-call-leaderboard/bfcl_eval/data`;
const CATEGORIES = ['simple', 'multiple', 'parallel', 'parallel_multiple', 'irrelevance'];
const PER_CATEGORY = 100;

const SYSTEM_PROMPT =
  'You have tools you can call. Fulfill the user request with tool calls only, using the exact function names and argument values.';

function toJsonSchemaParams(params) {
  if (!params || typeof params !== 'object') return { type: 'object', properties: {} };
  const out = { ...params };
  // BFCL v3 uses "dict" for objects; map to JSON Schema.
  if (out.type === 'dict') out.type = 'object';
  if (out.properties && typeof out.properties === 'object') {
    const props = {};
    for (const [k, v] of Object.entries(out.properties)) {
      props[k] = toJsonSchemaParams(v);
    }
    out.properties = props;
  }
  if (out.items && typeof out.items === 'object') out.items = toJsonSchemaParams(out.items);
  return out;
}

function parseJsonl(text, file) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        throw new Error(`bfcl: ${file} line ${i} is not valid JSON`);
      }
    });
}

function userText(question) {
  // v3 non-live: [[{role, content}]] (single turn).
  const turns = Array.isArray(question) ? question.flat(Infinity) : [];
  const users = turns.filter((t) => t && t.role === 'user').map((t) => String(t.content));
  if (users.length === 0) throw new Error('bfcl: question has no user turn');
  return users.join('\n');
}

export async function build() {
  const rng = mulberry32(SEED);
  const samples = [];
  const counts = {};
  for (const category of CATEGORIES) {
    const qText = (await fetchBytes(`${DATA_BASE}/BFCL_v3_${category}.json`)).toString('utf8');
    const questions = parseJsonl(qText, `BFCL_v3_${category}.json`);
    let answers = new Map();
    if (category !== 'irrelevance') {
      const aText = (
        await fetchBytes(`${DATA_BASE}/possible_answer/BFCL_v3_${category}.json`)
      ).toString('utf8');
      for (const row of parseJsonl(aText, `possible_answer/BFCL_v3_${category}.json`)) {
        answers.set(row.id, row.ground_truth);
      }
    }
    counts[category] = { questions: questions.length, answers: answers.size };
    const order = shuffleInPlace(questions.map((_, i) => i), rng).slice(0, PER_CATEGORY);
    if (order.length < PER_CATEGORY) {
      throw new Error(`bfcl: category ${category} has only ${order.length} rows`);
    }
    for (const i of order) {
      const q = questions[i];
      const tools = (q.function ?? []).map((f) => ({
        name: f.name,
        description: f.description ?? '',
        parameters: toJsonSchemaParams(f.parameters),
      }));
      if (category === 'irrelevance') {
        samples.push({
          id: `bfcl-${q.id}`,
          input: userText(q.question),
          tools,
          scorers: [{ type: 'no_tool_call' }],
          metadata: { task: 'bfcl', subtype: category, lang: 'en' },
        });
      } else {
        const groundTruth = answers.get(q.id);
        if (!Array.isArray(groundTruth) || groundTruth.length === 0) {
          throw new Error(`bfcl: no ground truth for ${q.id}`);
        }
        const expectedToolCalls = groundTruth.map((call) => {
          const names = Object.keys(call);
          if (names.length !== 1) throw new Error(`bfcl: multi-name call in ${q.id}`);
          const name = names[0];
          const args = {};
          for (const [param, allowed] of Object.entries(call[name] ?? {})) {
            if (!Array.isArray(allowed)) {
              throw new Error(`bfcl: non-list allowed values in ${q.id}.${String(param)}`);
            }
            args[param] = allowed;
          }
          return { name, args };
        });
        samples.push({
          id: `bfcl-${q.id}`,
          input: userText(q.question),
          tools,
          expectedToolCalls,
          scorers: [{ type: 'tool_call_ast' }],
          metadata: { task: 'bfcl', subtype: category, lang: 'en' },
        });
      }
    }
    log(`bfcl: ${category} picked ${PER_CATEGORY}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  shuffleInPlace(samples, rng);
  assertUniqueIds(samples, PACK_ID);
  const tagged = tagReliability(samples, SEED);
  writeManifest(PACK_ID, {
    schemaVersion: '1.0',
    id: PACK_ID,
    version: '1.0.0',
    title: { ko: 'BFCL v3 함수 호출', en: 'BFCL v3 function calling' },
    description: {
      ko: 'BFCL v3 Python 5개 범주 각 100문항, 총 500문항(A1). irrelevance는 no_tool_call로 평가합니다.',
      en: '100 items each from 5 BFCL v3 Python categories, 500 total (A1). Irrelevance items are scored with no_tool_call.',
    },
    category: 'A1',
    lang: ['en'],
    license: { id: 'Apache-2.0', source: ORIGIN_URL, attribution: 'Gorilla/Berkeley Function-Calling Leaderboard' },
    kind: 'tool_call',
    source: { type: 'jsonl', file: 'samples.jsonl' },
    systemPrompt: SYSTEM_PROMPT,
    scorers: [{ type: 'tool_call_ast' }, { type: 'no_tool_call' }],
    metrics: [
      {
        id: 'accuracy',
        description: { ko: '정확도', en: 'Accuracy' },
        source: 'score',
        aggregation: 'mean',
        lowerIsBetter: false,
        scoreType: 'binary',
        range: { min: 0, max: 1 },
        normalization: { kind: 'baseline', baseline: 0 },
      },
    ],
    tiers: { smoke: 20, standard: 100, full: 500 },
    stratifyBy: 'subtype',
    requires: { toolCalling: true },
  });
  writeJsonl(`${EVALS_ROOT}/${PACK_ID}/samples.jsonl`, samples);
  writeLicense(PACK_ID, [
    `# License — ${PACK_ID}`,
    '',
    `- Origin: ${ORIGIN_URL} (berkeley-function-call-leaderboard/bfcl_eval/data)`,
    `- Revision (git commit): ${COMMIT}`,
    `- Files: ${CATEGORIES.map((c) => `BFCL_v3_${c}.json`).join(', ')}`,
    `  + possible_answer/BFCL_v3_{simple,multiple,parallel,parallel_multiple}.json`,
    `- Download date (UTC): ${DOWNLOAD_DATE}`,
    `- Converter: scripts/evals/convert-bfcl.mjs v${CONVERTER_VERSION} (seed ${SEED})`,
    `- License: Apache-2.0`,
    `- Bundled samples: ${samples.length} (${PER_CATEGORY}/category x ${CATEGORIES.length})`,
    `- Source rows: ${JSON.stringify(counts)}`,
  ]);
  log(`bfcl: wrote ${samples.length} samples, reliability=${tagged}`);
  return { packId: PACK_ID, samples: samples.length, counts };
}

if (isMain(import.meta.url)) {
  await build();
}
