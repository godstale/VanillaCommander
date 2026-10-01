import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cartSummary } from '../src/cart.js';
import { formatKRW } from '../src/format.js';
import type { CartItem } from '../src/types.js';

const items: CartItem[] = [{ sku: 'a-1', price: 5000, qty: 2 }];

describe('cart', () => {
  it('summarizes with formatted total', () => {
    assert.equal(cartSummary(items), `1 items: ${formatKRW(10000)}`);
  });
});
