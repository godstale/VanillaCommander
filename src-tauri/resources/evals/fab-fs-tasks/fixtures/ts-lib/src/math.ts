export function sum(values: number[]): number {
  return values.reduce((acc, cur) => acc + cur, 0);
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}
