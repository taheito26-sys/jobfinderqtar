import { describe, expect, it } from 'vitest';

import {
  buildLinkedInSearchVariants,
  scoreLinkedInJobAgainstProfile,
  type LinkedInProfileContext,
} from '../../supabase/functions/_shared/linkedin-profile-search.ts';

const profile: LinkedInProfileContext = {
  desiredTitles: ['Enterprise Infrastructure Architect', 'Solution Architect', 'Senior System Engineer'],
  headline: 'Enterprise Infrastructure & Cloud Architect | Solution Architect',
  location: 'Doha, Qatar',
  country: 'Qatar',
  remotePreference: 'flexible',
  skills: ['Enterprise Architecture', 'Solution Architecture', 'Cloud Migration', 'IAM', 'Security Architecture'],
  salaryFloor: 25000,
};

describe('LinkedIn profile search helpers', () => {
  it('builds broader title variants around an exact title seed', () => {
    const variants = buildLinkedInSearchVariants({
      keywords: 'Enterprise Infrastructure Architect',
      profile,
    });

    expect(variants).toContain('Enterprise Infrastructure Architect');
    expect(variants).toContain('infrastructure architect');
    expect(variants).toContain('enterprise architect');
    expect(variants).toContain('architect');
  });

  it('scores nearby architect roles as relevant even when the title is not exact', () => {
    const related = scoreLinkedInJobAgainstProfile(
      {
        title: 'Digital Solutions Architect',
        company: 'Anotech',
        location: 'Doha, Qatar',
        description: 'Lead solution architecture for cloud and infrastructure programs.',
      },
      profile,
    );

    const unrelated = scoreLinkedInJobAgainstProfile(
      {
        title: 'Senior Director of Sales',
        company: 'Example Co',
        location: 'Doha, Qatar',
        description: 'Drive revenue and partnerships.',
      },
      profile,
    );

    expect(related).toBeGreaterThanOrEqual(40);
    expect(unrelated).toBeLessThan(20);
  });
});
