import { sum } from './math.js';
import type { CartItem } from './types.js';

export const TAX_RATE = 0.1;

export function calcTotal(items: CartItem[]): number {
  return sum(items.map((item) => item.price * item.qty));
}

export function calcDiscount(total: number, rate: number): number {
  return Math.round(total * rate);
}

export function totalWithTax(items: CartItem[]): number {
  return Math.round(calcTotal(items) * (1 + TAX_RATE));
}
