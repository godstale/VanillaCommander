import { formatKRW } from './format.js';
import { calcTotal } from './price.js';
import type { CartItem } from './types.js';

export function cartSummary(items: CartItem[]): string {
  const total = calcTotal(items);
  return `${items.length} items: ${formatKRW(total)}`;
}
