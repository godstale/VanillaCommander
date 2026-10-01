import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatKRW } from '../src/format.js';

describe('formatKRW', () => {
  it('formats with thousand separators', () => {
    assert.equal(formatKRW(10000), '₩10,000');
  });
});
