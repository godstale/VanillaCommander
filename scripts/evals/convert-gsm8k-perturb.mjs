#!/usr/bin/env node
// Converter: gsm8k-perturb pack (P10-24).
// Origin: openai/gsm8k test (MIT-derived note in LICENSE.md).
// 100 fixed-seed (20260925) number/name variants of GSM8K test items.
// Numbers: every numeric token shared between question and solution steps is
// shifted by a per-sample delta; each `<<expr=result>>` step is re-evaluated
// with a small arithmetic parser and the new final result becomes the target.
// Samples whose steps do not parse, do not re-evaluate to the stated results,
// or hit ambiguous constant/result collisions are EXCLUDED (never fabricated).
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
  mulberry32,
  shuffleInPlace,
  tagReliability,
  writeJsonl,
  writeLicense,
  writeManifest,
} from './lib.mjs';

const PACK_ID = 'gsm8k-perturb';
const DATASET = 'openai/gsm8k';
const REVISION = '740312add88f781978c0658806c59bc2815b9866';
const ORIGIN_URL = 'https://huggingface.co/datasets/openai/gsm8k';
const WANT = 100;

const SYSTEM_PROMPT =
  'Solve the problem. Write the final line as `ANSWER: <number>` and nothing else on that line.';

function numPattern() {
  // Integer/decimal tokens, optionally thousands-grouped; never part of a
  // longer digit run, a decimal, or a word (protects ordinals like 3rd).
  return /(?<![\d.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d.]|[a-zA-Z])|(?<![\d.])\d+(?:\.\d+)?(?![\d.]|[a-zA-Z])/g;
}

function plainNumber(token) {
  return Number(token.replace(/,/g, ''));
}

const NAME_STOP = new Set(
  [
    'The', 'This', 'That', 'These', 'Those', 'There', 'Here', 'What', 'Which', 'Who',
    'Whose', 'When', 'Where', 'Why', 'How', 'If', 'Then', 'Than', 'So', 'And',
    'But', 'Or', 'Nor', 'For', 'Yet', 'As', 'At', 'In', 'On', 'Of', 'To',
    'From', 'With', 'Without', 'Each', 'Every', 'Both', 'All', 'Some', 'Many',
    'Much', 'More', 'Most', 'Few', 'Several', 'One', 'Two', 'Three', 'Four',
    'Five', 'No', 'Yes', 'Not', 'It', 'Its', 'He', 'She', 'They', 'We',
    'You', 'His', 'Her', 'Their', 'Our', 'Your', 'My', 'Mr', 'Mrs', 'Ms',
    'Dr', 'St', 'English', 'Spanish', 'French',
    'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December',
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  ],
);

const FIRST_NAMES = [
  'Maya', 'Liam', 'Sofia', 'Noah', 'Aisha', 'Mateo', 'Priya', 'Jonas', 'Nina',
  'Omar', 'Elena', 'Kai', 'Zara', 'Felix', 'Amara', 'Ravi', 'Lucia', 'Tariq',
  'Hana', 'Diego', 'Yuki', 'Carlos', 'Mei', 'Piotr', 'Anya', 'Kwame', 'Ines',
  'Sven', 'Lena', 'Oscar', 'Tessa', 'Hugo', 'Iris', 'Marco', 'Nadia', 'Pablo',
  'Rosa', 'Sam', 'Tara', 'Umar', 'Vera', 'Wren', 'Yusuf', 'Dana', 'Elif',
];

function parseTarget(answer) {
  const m = /####\s*(-?[\d,]+(?:\.\d+)?)/.exec(answer);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Tiny arithmetic parser: numbers, + - * / ( ), unary minus. Returns null on
// any unsupported construct (percent, variables, implicit multiplication...).
function evalArith(src) {
  let pos = 0;
  const fail = () => null;
  function skip() {
    while (pos < src.length && src[pos] === ' ') pos++;
  }
  function parseNum() {
    skip();
    const m = /\d+(?:\.\d+)?/y;
    m.lastIndex = pos;
    const t = m.exec(src);
    if (!t) return null;
    pos += t[0].length;
    return Number(t[0]);
  }
  function parsePrimary() {
    skip();
    if (src[pos] === '(') {
      pos++;
      const v = parseAdd();
      if (v === null) return null;
      skip();
      if (src[pos] !== ')') return null;
      pos++;
      return v;
    }
    if (src[pos] === '-') {
      pos++;
      const v = parsePrimary();
      return v === null ? null : -v;
    }
    if (src[pos] === '+') {
      pos++;
      return parsePrimary();
    }
    return parseNum();
  }
  function parseMul() {
    let v = parsePrimary();
    if (v === null) return null;
    for (;;) {
      skip();
      const op = src[pos];
      if (op !== '*' && op !== '/') return v;
      pos++;
      const rhs = parsePrimary();
      if (rhs === null) return null;
      if (op === '*') v *= rhs;
      else {
        if (rhs === 0) return null;
        v /= rhs;
      }
    }
  }
  function parseAdd() {
    let v = parseMul();
    if (v === null) return null;
    for (;;) {
      skip();
      const op = src[pos];
      if (op !== '+' && op !== '-') return v;
      pos++;
      const rhs = parseMul();
      if (rhs === null) return null;
      v = op === '+' ? v + rhs : v - rhs;
    }
  }
  const v = parseAdd();
  if (v === null || !Number.isFinite(v)) return fail();
  skip();
  if (pos !== src.length) return fail();
  return v;
}

function formatShifted(token, delta) {
  const hasComma = token.includes(',');
  const dot = token.indexOf('.');
  const decimals = dot === -1 ? 0 : token.length - dot - 1;
  const v = plainNumber(token) + delta;
  if (!hasComma) return decimals === 0 ? String(Math.round(v)) : v.toFixed(decimals);
  return v.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function questionTokens(question) {
  return new Set(question.match(numPattern()) ?? []);
}

// Returns { question, answer } or null when the sample must be excluded.
function perturb(question, solution, rng, stats) {
  const steps = [];
  for (const m of solution.matchAll(/<<([^<>=]*?)=([^<>]*?)>>/g)) {
    steps.push({ expr: m[1].trim(), stated: m[2].trim() });
  }
  if (steps.length === 0) {
    stats.noSteps += 1;
    return null;
  }
  const target = parseTarget(solution);
  if (target === null) {
    stats.badTarget += 1;
    return null;
  }
  const qToks = questionTokens(question);
  const exprToks = new Set();
  for (const s of steps) {
    for (const t of s.expr.match(numPattern()) ?? []) exprToks.add(t);
  }
  const delta = 2 + Math.floor(rng() * 8);
  const qmap = new Map();
  for (const t of exprToks) {
    if (qToks.has(t)) qmap.set(t, formatShifted(t, delta));
  }
  if (qmap.size === 0) {
    stats.noSharedNumbers += 1;
    return null;
  }

  const oldResults = [];
  const newResults = [];
  for (const s of steps) {
    const rewritten = s.expr.replace(numPattern(), (tok) => {
      if (qmap.has(tok)) return qmap.get(tok);
      for (let k = 0; k < oldResults.length; k++) {
        if (plainNumber(tok) === oldResults[k]) {
          // Ambiguous when the same literal also occurs in the question as an
          // unmapped number (likely a true constant, not the old result).
          if (qToks.has(tok) && !qmap.has(tok)) {
            const err = new Error('ambiguous-constant');
            err.code = 'ambiguous-constant';
            throw err;
          }
          return String(newResults[k]);
        }
      }
      return tok;
    });
    // The ORIGINAL expr must re-evaluate to the stated result (parser check).
    const oldValue = evalArith(s.expr);
    const stated = Number(s.stated.replace(/,/g, ''));
    if (oldValue === null || !Number.isFinite(stated) || Math.abs(oldValue - stated) > 1e-9) {
      stats.evalMismatch += 1;
      return null;
    }
    // The REWRITTEN expr gives the perturbed intermediate result.
    const value = evalArith(rewritten);
    if (value === null || !Number.isFinite(value)) {
      stats.evalMismatch += 1;
      return null;
    }
    oldResults.push(oldValue);
    newResults.push(value);
  }
  const finalOld = oldResults[oldResults.length - 1];  const finalNew = newResults[newResults.length - 1];
  if (Math.abs(finalOld - target) > 1e-9) {
    stats.targetMismatch += 1;
    return null;
  }
  if (!Number.isFinite(finalNew) || Math.abs(finalNew) > 1e12) {
    stats.badAnswer += 1;
    return null;
  }

  let newQuestion = question.replace(numPattern(), (tok) => qmap.get(tok) ?? tok);
  // Name variant: most frequent capitalized token (not sentence-initial).
  const counts = new Map();
  for (const m of newQuestion.matchAll(/\b([A-Z][a-z]{1,19})\b/g)) {
    if (m.index === 0 || NAME_STOP.has(m[1])) continue;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  if (counts.size > 0) {
    const [name] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const pool = FIRST_NAMES.filter((n) => n.toLowerCase() !== name.toLowerCase());
    const replacement = pool[Math.floor(rng() * pool.length)];
    newQuestion = newQuestion.replace(new RegExp(`\\b${name}\\b`, 'g'), replacement);
  }
  if (newQuestion === question) {
    stats.noChange += 1;
    return null;
  }
  return { question: newQuestion, answer: finalNew };
}

export async function build() {
  const { rows, total } = await fetchAllDsRows(DATASET, 'main', 'test');
  log(`gsm8k-perturb: fetched ${rows.length}/${total}`);
  const rng = mulberry32(SEED);
  const order = shuffleInPlace(rows.map((_, i) => i), rng);
  const stats = {
    noSteps: 0, badTarget: 0, noSharedNumbers: 0, ambiguous: 0,
    evalMismatch: 0, targetMismatch: 0, badAnswer: 0, noChange: 0,
  };
  const samples = [];
  for (const idx of order) {
    if (samples.length >= WANT) break;
    let out = null;
    try {
      out = perturb(rows[idx].question, rows[idx].answer, rng, stats);
    } catch (err) {
      if (err && err.code === 'ambiguous-constant') stats.ambiguous += 1;
      else stats.evalMismatch += 1;
      out = null;
    }
    if (!out) continue;
    samples.push({
      id: `gsm8k-perturb-${String(samples.length).padStart(3, '0')}`,
      input: out.question,
      target: out.answer,
      metadata: { task: 'gsm8k-perturb', variant_of: `gsm8k-test-${idx}`, lang: 'en' },
    });
  }
  if (samples.length < WANT) {
    throw new Error(`gsm8k-perturb: only ${samples.length}/${WANT} accepted: ${JSON.stringify(stats)}`);
  }
  assertUniqueIds(samples, PACK_ID);
  const tagged = tagReliability(samples, SEED);
  writeManifest(PACK_ID, {
    schemaVersion: '1.0',
    id: PACK_ID,
    version: '1.0.0',
    title: { ko: 'GSM8K 변형(고정 시드 숫자/이름 치환)', en: 'GSM8K perturbed variants (fixed seed)' },
    description: {
      ko: 'GSM8K 테스트의 숫자/이름 변형 100개(Q2). 정답은 원본 풀이의 연산을 재계산하여 구했으며 파싱 불가 문항은 제외했습니다.',
      en: '100 number/name variants of GSM8K test items (Q2). Answers were recomputed by re-evaluating the original arithmetic; unparseable items excluded.',
    },
    category: 'Q2',
    lang: ['en'],
    license: {
      id: 'MIT',
      source: ORIGIN_URL,
      attribution: 'Derived from OpenAI openai/gsm8k (MIT); perturbed by Fortress converter',
    },
    kind: 'single_turn',
    source: { type: 'jsonl', file: 'samples.jsonl' },
    systemPrompt: SYSTEM_PROMPT,
    scorers: [{ type: 'numeric' }],
    metrics: [metricAccuracy(0)],
    tiers: { smoke: 20, standard: 100, full: 100 },
  });
  writeJsonl(`${EVALS_ROOT}/${PACK_ID}/samples.jsonl`, samples);
  writeLicense(PACK_ID, [
    `# License — ${PACK_ID}`,
    '',
    `- Origin: ${ORIGIN_URL} (test split, ${total} rows)`,
    `- Revision (HF commit sha): ${REVISION}`,
    `- Download date (UTC): ${DOWNLOAD_DATE}`,
    `- Converter: scripts/evals/convert-gsm8k-perturb.mjs v${CONVERTER_VERSION} (seed ${SEED})`,
    `- License: MIT-derived (note origin above); perturbation (number shift + name swap) by Fortress`,
    `- Bundled samples: ${samples.length}; exclusions: ${JSON.stringify(stats)}`,
  ]);
  log(`gsm8k-perturb: wrote ${samples.length}, reliability=${tagged}, stats=${JSON.stringify(stats)}`);
  return { packId: PACK_ID, samples: samples.length, stats };
}

if (isMain(import.meta.url)) {
  await build();
}
