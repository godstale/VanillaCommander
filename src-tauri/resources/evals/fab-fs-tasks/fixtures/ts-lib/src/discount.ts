import { calcDiscount } from './price.js';

export function applyCoupon(total: number, code: string): number {
  const rate = code === 'SAVE10' ? 0.1 : 0;
  return total - calcDiscount(total, rate);
}
