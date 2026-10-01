import { z } from 'zod';
import type { Scorer, ScorerInput, ScorerResult } from './types';
import { correct, incorrect, noAnswer, parseScorerOptions } from './types';
import {
  extractAnswerLine,
  extractFirstLetter,
  extractLastLetter,
  extractParenChoice,
  letterFromExtraction,
  stripThinking,
  type ChoiceExtractRule,
} from './extract';
import { targetsOf } from './shared';

const OptionsSchema = z.object({
  extract: z
    .array(z.enum(['answer_line', 'paren', 'last_letter', 'first_letter']))
    .default(['answer_line', 'paren', 'last_letter']),
  letters: z.string().optional(),
});

function choiceLetters(input: ScorerInput): string {
  const n = input.sample.choices?.length ?? 4;
  return 'ABCDEFGHIJ'.slice(0, Math.max(2, Math.min(10, n)));
}

export const choiceScorer: Scorer = {
  type: 'choice',
  optionsSchema: OptionsSchema,
  async score(input: ScorerInput, options: unknown): Promise<ScorerResult> {
    const opts = parseScorerOptions(OptionsSchema, options);
    const letters = opts.letters ?? choiceLetters(input);
    const text = stripThinking(input.outputText);
    for (const rule of opts.extract as ChoiceExtractRule[]) {
      let letter: string | null = null;
      if (rule === 'answer_line') {
        const ext = extractAnswerLine(text);
        if (ext) letter = letterFromExtraction(ext);
      } else if (rule === 'paren') {
        letter = extractParenChoice(text)?.value ?? null;
      } else if (rule === 'last_letter') {
        letter = extractLastLetter(text, letters)?.value ?? null;
      } else {
        letter = extractFirstLetter(text, letters)?.value ?? null;
      }
      if (letter && letters.includes(letter)) {
        const targets = targetsOf(input).map((t) => t.trim().toUpperCase());
        if (targets.includes(letter)) return correct(1, `choice ${letter} via ${rule}`, letter);
        return incorrect(`expected ${targets.join('|')}, got ${letter}`, letter);
      }
    }
    return noAnswer('no choice letter extracted');
  },
};
