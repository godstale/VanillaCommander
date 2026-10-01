import type { ScorerInput } from './types';
import { stripThinking } from './extract';

export function targetsOf(input: ScorerInput): string[] {
  const t = input.sample.target;
  if (t === undefined) return [];
  const arr = Array.isArray(t) ? t : [t];
  return arr.map((v) => String(v));
}

export function cleanOutput(input: ScorerInput): string {
  return stripThinking(input.outputText);
}

export function truncate(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
