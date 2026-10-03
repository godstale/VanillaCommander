import { describe, expect, it } from 'vitest';
import { CONSENT_TEXT_VERSION } from './types';
import {
  INTEGRATION_CONSENT_TEXT,
  INTEGRATION_CONSENT_TEXT_VERSION,
  needsReconsent,
} from './consent';

describe('consent', () => {
  it('consent text version matches CONSENT_TEXT_VERSION', () => {
    expect(INTEGRATION_CONSENT_TEXT_VERSION).toBe(CONSENT_TEXT_VERSION);
    expect(INTEGRATION_CONSENT_TEXT).toContain(CONSENT_TEXT_VERSION);
  });

  it('requires consent when there is no previous consent', () => {
    expect(
      needsReconsent(null, { purposes: ['chat-agent'], dataClasses: ['public-bundled'] }),
    ).toBe(true);
  });

  it('returns true when purposes widen', () => {
    expect(
      needsReconsent(
        { purposes: ['chat-agent'], dataClasses: ['public-bundled'] },
        { purposes: ['chat-agent', 'wiki-ingest'], dataClasses: ['public-bundled'] },
      ),
    ).toBe(true);
  });

  it('returns true when data classes widen', () => {
    expect(
      needsReconsent(
        { purposes: ['chat-agent'], dataClasses: ['public-bundled'] },
        { purposes: ['chat-agent'], dataClasses: ['public-bundled', 'personal'] },
      ),
    ).toBe(true);
  });

  it('returns false when scope narrows or stays equal', () => {
    expect(
      needsReconsent(
        { purposes: ['chat-agent', 'wiki-ingest'], dataClasses: ['public-bundled', 'personal'] },
        { purposes: ['chat-agent'], dataClasses: ['public-bundled'] },
      ),
    ).toBe(false);
    expect(
      needsReconsent(
        { purposes: ['chat-agent'], dataClasses: ['public-bundled'] },
        { purposes: ['chat-agent'], dataClasses: ['public-bundled'] },
      ),
    ).toBe(false);
  });
});
