import { describe, expect, it } from 'vitest';
import { CONSENT_TEXT_VERSION } from '../constants';
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
      needsReconsent(null, { purposes: ['judge'], dataClasses: ['public-bundled'] }),
    ).toBe(true);
  });

  it('returns true when purposes widen', () => {
    expect(
      needsReconsent(
        { purposes: ['judge'], dataClasses: ['public-bundled'] },
        { purposes: ['judge', 'candidate'], dataClasses: ['public-bundled'] },
      ),
    ).toBe(true);
  });

  it('returns true when data classes widen', () => {
    expect(
      needsReconsent(
        { purposes: ['judge'], dataClasses: ['public-bundled'] },
        { purposes: ['judge'], dataClasses: ['public-bundled', 'personal'] },
      ),
    ).toBe(true);
  });

  it('returns false when scope narrows or stays equal', () => {
    expect(
      needsReconsent(
        { purposes: ['judge', 'candidate'], dataClasses: ['public-bundled', 'personal'] },
        { purposes: ['judge'], dataClasses: ['public-bundled'] },
      ),
    ).toBe(false);
    expect(
      needsReconsent(
        { purposes: ['judge'], dataClasses: ['public-bundled'] },
        { purposes: ['judge'], dataClasses: ['public-bundled'] },
      ),
    ).toBe(false);
  });
});
