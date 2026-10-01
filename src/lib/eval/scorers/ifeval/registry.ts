export interface CheckerOutcome {
  pass: boolean;
  detail: string;
}

export type CheckerFn = (
  text: string,
  kwargs: Record<string, unknown>,
) => CheckerOutcome;

const checkers = new Map<string, CheckerFn>();

export function registerChecker(id: string, fn: CheckerFn): void {
  checkers.set(id, fn);
}

export function getChecker(id: string): CheckerFn | undefined {
  return checkers.get(id);
}

export function listCheckerIds(): string[] {
  return [...checkers.keys()];
}

export type Relation = 'less than' | 'at least';

export function strArg(
  kwargs: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = kwargs[key];
  return typeof value === 'string' ? value : undefined;
}

export function numArg(
  kwargs: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = kwargs[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

export function strArrayArg(
  kwargs: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = kwargs[key];
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return undefined;
    out.push(item);
  }
  return out;
}

export function relationArg(
  kwargs: Record<string, unknown>,
  key: string,
): Relation | undefined {
  const value = kwargs[key];
  if (value === 'less than' || value === 'at least') return value;
  return undefined;
}

export function checkRelation(
  count: number,
  threshold: number,
  relation: Relation,
): boolean {
  return relation === 'at least' ? count >= threshold : count < threshold;
}

export function fail(detail: string): CheckerOutcome {
  return { pass: false, detail };
}
