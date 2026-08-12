import { describe, expect, it } from 'vitest';

import {
  buildLinkedInSearchVariants,
  scoreLinkedInJobAgainstProfile,
  type LinkedInProfileContext,
} from '../../supabase/functions/_shared/linkedin-profile-search.ts';
import {
  rankExternalAgainstProfile,
  type MultiSourceJob,
} from '../../supabase/functions/_shared/multi-source-search.ts';

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

  it('treats specialist-style infrastructure roles as nearby matches', () => {
    const specialist = scoreLinkedInJobAgainstProfile(
      {
        title: 'Digital Infrastructure Specialist',
        company: 'International School of London',
        location: 'Doha, Qatar',
        description: 'Maintain cloud infrastructure, identity, and digital platforms.',
      },
      profile,
    );

    expect(specialist).toBeGreaterThanOrEqual(30);
  });

  // Regression: 'specialist' must exist in ROLE_FAMILY_PATTERNS, otherwise the
  // specialist branch of the scorer can never fire. This case strips every other
  // signal — no title-token overlap, no skill hits, no location match — so the
  // score comes from the specialist/architect adjacency rule alone.
  it('credits a specialist role purely on role-family adjacency', () => {
    const isolated = scoreLinkedInJobAgainstProfile(
      {
        title: 'Cloud Specialist',
        company: 'Unrelated GmbH',
        location: 'Berlin, Germany',
        description: 'General duties.',
      },
      profile,
    );

    expect(isolated).toBeGreaterThanOrEqual(35);
  });

  it('still scores a genuinely unrelated role below the relevance threshold', () => {
    const unrelated = scoreLinkedInJobAgainstProfile(
      {
        title: 'Pastry Chef',
        company: 'Unrelated GmbH',
        location: 'Berlin, Germany',
        description: 'Prepare desserts.',
      },
      profile,
    );

    expect(unrelated).toBeLessThan(20);
  });

  it('retains a nearby bucket of external roles just below the main threshold', () => {
    const jobs: MultiSourceJob[] = [
      {
        title: 'Enterprise Infrastructure Architect',
        company: 'Target Co',
        location: 'Doha, Qatar',
        apply_url: 'https://example.com/a',
        source_created_at: null,
        source_platform: 'indeed',
        remote_type: 'unknown',
        employment_type: 'full-time',
        seniority_level: '',
        normalization_status: 'incomplete',
      },
      {
        title: 'Digital Infrastructure Specialist',
        company: 'Adjacent Co',
        location: 'Doha, Qatar',
        apply_url: 'https://example.com/b',
        source_created_at: null,
        source_platform: 'indeed',
        remote_type: 'unknown',
        employment_type: 'full-time',
        seniority_level: '',
        normalization_status: 'incomplete',
      },
    ];

    const ranked = rankExternalAgainstProfile(jobs, profile);
    const titles = ranked.map((job) => job.title);

    expect(titles).toContain('Enterprise Infrastructure Architect');
    expect(titles).toContain('Digital Infrastructure Specialist');
  });
});
