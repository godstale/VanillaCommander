import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcTotal, calcDiscount } from '../src/price.js';
import type { CartItem } from '../src/types.js';

const items: CartItem[] = [{ sku: 'a-1', price: 5000, qty: 2 }];

describe('price', () => {
  it('calcTotal sums price times qty', () => {
    assert.equal(calcTotal(items), 10000);
  });
  it('calcDiscount rounds', () => {
    assert.equal(calcDiscount(10000, 0.1), 1000);
  });
});
