import { describe, expect, it } from 'vitest';
import { numberPlaceholders, postscript } from './detectableContent';

describe('detectable_content:number_placeholders', () => {
  it('passes when enough placeholders exist', () => {
    expect(
      numberPlaceholders('Dear [name], your [order] ships', {
        num_placeholders: 2,
      }).pass,
    ).toBe(true);
  });

  it('fails when placeholders are missing', () => {
    expect(
      numberPlaceholders('Dear customer, hello', { num_placeholders: 1 }).pass,
    ).toBe(false);
  });
});

describe('detectable_content:postscript', () => {
  it('passes when marker has content after it', () => {
    expect(
      postscript('Main text. P.S. remember this', {
        postscript_marker: 'P.S.',
      }).pass,
    ).toBe(true);
  });

  it('fails when marker is missing', () => {
    expect(
      postscript('Main text only', { postscript_marker: 'P.S.' }).pass,
    ).toBe(false);
  });

  it('fails when nothing follows the marker', () => {
    expect(postscript('Main text. P.S.', { postscript_marker: 'P.S.' }).pass).toBe(
      false,
    );
  });
});
