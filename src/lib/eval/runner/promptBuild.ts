import type {
  CandidateSnapshot,
  EvalPackManifest,
  EvalSample,
  EvalMessage,
} from '../types';

export interface BuiltPrompt {
  system: string | null;
  messages: EvalMessage[];
}

export function buildPrompt(
  candidate: CandidateSnapshot,
  pack: EvalPackManifest,
  sample: EvalSample,
  rotation = 0,
): BuiltPrompt {
  const parts: string[] = [];
  if (pack.useAgentSystemPrompt && candidate.systemPrompt) parts.push(candidate.systemPrompt);
  if (pack.systemPrompt) parts.push(pack.systemPrompt);
  const system = parts.length > 0 ? parts.join('\n\n') : null;

  const messages: EvalMessage[] = [...(pack.fewshot ?? [])];
  const inputMessages: EvalMessage[] =
    typeof sample.input === 'string' ? [{ role: 'user', content: sample.input }] : [...sample.input];

  if (sample.choices && sample.choices.length > 0 && inputMessages.length > 0) {
    const rotated = rotateChoices(sample.choices, rotation);
    const letters = 'ABCDEFGHIJ';
    const list = rotated.map((c, i) => `${letters[i]}. ${c}`).join('\n');
    const last = inputMessages[inputMessages.length - 1];
    inputMessages[inputMessages.length - 1] = {
      role: last.role,
      content: `${last.content}\n\n${list}`,
    };
  }
  messages.push(...inputMessages);
  return { system, messages };
}

export function rotateChoices(choices: string[], rotation: number): string[] {
  if (choices.length === 0 || rotation <= 0) return [...choices];
  const r = rotation % choices.length;
  return [...choices.slice(r), ...choices.slice(0, r)];
}

// Original index of the correct choice after rotating left by r (target letter follows the choice).
export function rotatedTargetLetter(
  choices: string[],
  targetLetter: string,
  rotation: number,
): string {
  const letters = 'ABCDEFGHIJ';
  const idx = letters.indexOf(targetLetter.toUpperCase());
  if (idx < 0 || idx >= choices.length) return targetLetter;
  const n = choices.length;
  const newIdx = (idx - (rotation % n) + n) % n;
  return letters[newIdx];
}

export function rotationCount(sample: EvalSample, circular: boolean): number {
  if (!circular) return 1;
  const n = sample.choices?.length ?? 0;
  if (n < 2) return 1;
  return Math.min(n, 4);
}
