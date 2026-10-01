import type { EvalSample } from '../../types';

export interface GeneratorContext {
  candidateContextSize?: number;
  tokensPerChar?: number;
}

export type SampleGenerator = (
  params: Record<string, unknown>,
  ctx: GeneratorContext,
) => Promise<EvalSample[]>;

const registry = new Map<string, SampleGenerator>();

export function registerGenerator(name: string, fn: SampleGenerator): void {
  registry.set(name, fn);
}

export function getGenerator(name: string): SampleGenerator {
  const fn = registry.get(name);
  if (!fn) throw new Error(`Unknown sample generator: ${name}`);
  return fn;
}

export function listGenerators(): string[] {
  return [...registry.keys()];
}
