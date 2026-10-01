import { z } from 'zod';
import type { EvalSample, ScorerSpec } from '../../types';
import { mulberry32 } from '../../stats/random';
import { EN_PARAGRAPHS, KO_PARAGRAPHS } from './fillerCorpus';
import { registerGenerator, type GeneratorContext } from './index';

const GENERATOR_NAME = 'long-context-v1';

const DEFAULT_LENGTHS = [2048, 4096, 8192, 16384, 32768, 65536, 131072];
const DEFAULT_DEPTHS = [0.1, 0.5, 0.9];
const DEFAULT_TASKS = ['niah-single', 'niah-multikey', 'niah-multivalue', 'var-trace'] as const;
const DEFAULT_PER_CELL = 2;
const DEFAULT_LANGS = ['ko', 'en'] as const;
const DEFAULT_SEED = 20260925;

type LongContextTask = (typeof DEFAULT_TASKS)[number];
type LongContextLang = (typeof DEFAULT_LANGS)[number];

const ParamsSchema = z.object({
  lengths: z.array(z.number().int().positive()).default(DEFAULT_LENGTHS),
  depths: z.array(z.number().min(0).max(1)).default(DEFAULT_DEPTHS),
  tasks: z.array(z.enum(DEFAULT_TASKS)).default([...DEFAULT_TASKS]),
  perCell: z.number().int().positive().default(DEFAULT_PER_CELL),
  lang: z.array(z.enum(DEFAULT_LANGS)).default([...DEFAULT_LANGS]),
  seed: z.number().int().default(DEFAULT_SEED),
});

type Params = z.infer<typeof ParamsSchema>;

const KO_ANIMALS = ['다람쥐', '토끼', '여우', '부엉이'];
const EN_ANIMALS = ['squirrel', 'rabbit', 'fox', 'owl'];
const KO_COLORS = ['빨강', '파랑', '초록'];
const EN_COLORS = ['red', 'blue', 'green'];

interface Needle {
  lines: string[];
  question: string;
  target: string | string[];
  scorers: ScorerSpec[];
}

function includesScorer(mode: 'any' | 'all'): ScorerSpec {
  return mode === 'all'
    ? { type: 'includes', weight: 1, gate: false, options: { mode: 'all' } }
    : { type: 'includes', weight: 1, gate: false, options: {} };
}

function sixDigit(rng: () => number): string {
  return String(100000 + Math.floor(rng() * 900000));
}

function twoDigit(rng: () => number): string {
  return String(10 + Math.floor(rng() * 90));
}

function buildNeedle(task: LongContextTask, lang: LongContextLang, rng: () => number): Needle {
  if (task === 'niah-single') {
    const code = sixDigit(rng);
    if (lang === 'ko') {
      return {
        lines: [`이 문서의 비밀 코드는 ${code}이다.`],
        question: '이 문서에 적힌 6자리 비밀 코드는 무엇인가? 코드만 답하라.',
        target: code,
        scorers: [includesScorer('any')],
      };
    }
    return {
      lines: [`The secret code in this document is ${code}.`],
      question: 'What is the 6-digit secret code in this document? Answer with the code only.',
      target: code,
      scorers: [includesScorer('any')],
    };
  }
  if (task === 'niah-multikey') {
    const animals = lang === 'ko' ? KO_ANIMALS : EN_ANIMALS;
    const numbers = [twoDigit(rng), twoDigit(rng), twoDigit(rng), twoDigit(rng)];
    const ask = Math.floor(rng() * animals.length);
    const pairs = animals.map((a, i) => `${a} ${numbers[i]}`).join(', ');
    if (lang === 'ko') {
      return {
        lines: [`동물 번호표: ${pairs}.`],
        question: `${animals[ask]}의 번호는 무엇인가? 숫자만 답하라.`,
        target: numbers[ask],
        scorers: [includesScorer('any')],
      };
    }
    return {
      lines: [`Animal number tags: ${pairs}.`],
      question: `What is the number for the ${animals[ask]}? Answer with the number only.`,
      target: numbers[ask],
      scorers: [includesScorer('any')],
    };
  }
  if (task === 'niah-multivalue') {
    const colors = lang === 'ko' ? KO_COLORS : EN_COLORS;
    const values = colors.map((c) => `${c}-${twoDigit(rng)}`);
    if (lang === 'ko') {
      return {
        lines: [`등대 신호 목록: ${values.join(', ')}.`],
        question: '등대 신호 목록의 세 값을 모두 나열하라.',
        target: values,
        scorers: [includesScorer('all')],
      };
    }
    return {
      lines: [`Lighthouse signal list: ${values.join(', ')}.`],
      question: 'List all three values of the lighthouse signal list.',
      target: values,
      scorers: [includesScorer('all')],
    };
  }
  // var-trace: a short arithmetic chain X1..X5; the model must report X5.
  const start = 10000 + Math.floor(rng() * 90000);
  const values = [start];
  for (let k = 0; k < 4; k++) {
    const step = 3 + Math.floor(rng() * 17);
    const op = rng() < 0.5 ? 1 : -1;
    values.push(values[k] + op * step);
  }
  const ops = values.slice(1).map((v, k) => {
    const diff = v - values[k];
    return diff >= 0 ? `+ ${diff}` : `- ${-diff}`;
  });
  if (lang === 'ko') {
    return {
      lines: [
        `X1 = ${values[0]}.`,
        `X2 = X1 ${ops[0]}.`,
        `X3 = X2 ${ops[1]}.`,
        `X4 = X3 ${ops[2]}.`,
        `X5 = X4 ${ops[3]}.`,
      ],
      question: 'X5의 값은 무엇인가? 숫자만 답하라.',
      target: String(values[4]),
      scorers: [includesScorer('any')],
    };
  }
  return {
    lines: [
      `X1 = ${values[0]}.`,
      `X2 = X1 ${ops[0]}.`,
      `X3 = X2 ${ops[1]}.`,
      `X4 = X3 ${ops[2]}.`,
      `X5 = X4 ${ops[3]}.`,
    ],
    question: 'What is the value of X5? Answer with the number only.',
    target: String(values[4]),
    scorers: [includesScorer('any')],
  };
}

// Fit filler + needle lines into an exact char budget so that the requested
// token length holds regardless of language. Single-line needles are spliced
// at the depth position; var-trace lines are scattered across the document.
function buildDocument(
  pool: string[],
  startIdx: number,
  budgetChars: number,
  depth: number,
  needleLines: string[],
): string {
  const needleBlock = needleLines.join('\n');
  const room = Math.max(0, budgetChars - needleBlock.length - needleLines.length);
  let filler = '';
  let idx = startIdx;
  while (filler.length < room + 512) {
    filler += pool[idx % pool.length] + '\n\n';
    idx += 1;
  }
  if (needleLines.length === 1) {
    const cut = Math.floor(room * depth);
    const before = filler.slice(0, cut);
    const after = filler.slice(cut, room);
    return `${before}\n${needleBlock}\n${after}`;
  }
  const cuts = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => Math.floor(room * f));
  const points = [0, ...cuts, room];
  const segments: string[] = [];
  for (let k = 0; k < needleLines.length; k++) {
    segments.push(filler.slice(points[k], points[k + 1]));
    segments.push(needleLines[k]);
  }
  segments.push(filler.slice(points[needleLines.length], room));
  return segments.join('\n');
}

async function generate(
  rawParams: Record<string, unknown>,
  ctx: GeneratorContext,
): Promise<EvalSample[]> {
  const params: Params = ParamsSchema.parse(rawParams ?? {});
  const rng = mulberry32(params.seed);
  const samples: EvalSample[] = [];
  for (const length of params.lengths) {
    for (const depth of params.depths) {
      for (const task of params.tasks) {
        for (const lang of params.lang) {
          const pool = lang === 'ko' ? KO_PARAGRAPHS : EN_PARAGRAPHS;
          const charsPerToken = ctx.tokensPerChar ?? (lang === 'ko' ? 1.6 : 4);
          const budgetChars = Math.round(length * charsPerToken);
          for (let n = 0; n < params.perCell; n++) {
            const needle = buildNeedle(task, lang, rng);
            const startIdx = Math.floor(rng() * pool.length);
            const doc = buildDocument(pool, startIdx, budgetChars, depth, needle.lines);
            const instruction =
              lang === 'ko'
                ? '다음 문서를 읽고 마지막 질문에 답하세요.'
                : 'Read the following document and answer the final question.';
            samples.push({
              id: `L${length}-D${Math.round(depth * 100)}-${task}-${lang}-${n + 1}`,
              input: `${instruction}\n\n${doc}\n\n${needle.question}`,
              target: needle.target,
              scorers: needle.scorers,
              tags: ['long-context', task, lang],
              metadata: {
                generator: GENERATOR_NAME,
                length,
                depth,
                task,
                lang,
                rep: n + 1,
              },
            });
          }
        }
      }
    }
  }
  return samples;
}

export function registerLongContextGenerator(): void {
  registerGenerator(GENERATOR_NAME, generate);
}

registerLongContextGenerator();
