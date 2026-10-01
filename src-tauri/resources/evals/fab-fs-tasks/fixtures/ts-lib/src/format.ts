export function formatKRW(amount: number): string {
  return `₩${amount.toLocaleString('en-US')}`;
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}
