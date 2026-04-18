import { describe, expect, it } from 'vitest';

import {
  extractAllLinkedInJobIds,
  isLinkedInSearchUrl,
  normalizeLinkedInUrl,
} from '../../supabase/functions/_shared/linkedin-job-helpers.ts';

describe('LinkedIn job URL helpers', () => {
  it('keeps LinkedIn search URLs with currentJobId as search pages', () => {
    const url = 'https://www.linkedin.com/jobs/search/?currentJobId=4402162417';

    expect(isLinkedInSearchUrl(url)).toBe(true);
    expect(normalizeLinkedInUrl(url)).toBe(url);
    expect(extractAllLinkedInJobIds(url)).toEqual(['4402162417']);
  });

  it('keeps other LinkedIn search URLs intact', () => {
    const url = 'https://www.linkedin.com/jobs/search/?keywords=engineer&location=Qatar';

    expect(isLinkedInSearchUrl(url)).toBe(true);
    expect(normalizeLinkedInUrl(url)).toBe(url);
    expect(extractAllLinkedInJobIds(url)).toEqual([]);
  });
});
