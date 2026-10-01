import { describe, expect, it } from 'vitest';
import { endChecker, quotation } from './startend';

describe('startend:end_checker', () => {
  it('passes matching ending', () => {
    expect(endChecker('see you soon', { end_phrase: 'you soon' }).pass).toBe(
      true,
    );
  });

  it('fails different ending', () => {
    expect(endChecker('see you soon', { end_phrase: 'goodbye' }).pass).toBe(
      false,
    );
  });
});

describe('startend:quotation', () => {
  it('passes quoted response', () => {
    expect(quotation('"hello"', {}).pass).toBe(true);
  });

  it('fails unquoted response', () => {
    expect(quotation('hello', {}).pass).toBe(false);
  });

  it('fails half-quoted response', () => {
    expect(quotation('"hello', {}).pass).toBe(false);
  });
});
