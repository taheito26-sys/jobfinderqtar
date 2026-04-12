import { describe, expect, it } from 'vitest';

import {
  buildDuplicateClusters,
  filterJobsByFeedMode,
  getFeedSource,
  normalizeJobUrl,
} from '@/lib/job-feed';

const baseJobs = [
  {
    id: 'job-1',
    title: 'Senior React Engineer',
    company: 'Acme',
    apply_url: 'https://jobs.acme.com/roles/react?utm_source=newsletter',
    created_at: new Date().toISOString(),
    raw_data: { source: 'search' },
  },
  {
    id: 'job-2',
    title: 'Senior React Engineer',
    company: 'Acme',
    apply_url: 'https://jobs.acme.com/roles/react',
    created_at: new Date().toISOString(),
    raw_data: { source: 'search' },
  },
  {
    id: 'job-3',
    title: 'Platform Engineer',
    company: 'Beta',
    apply_url: 'https://www.linkedin.com/jobs/view/123',
    created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    raw_data: { source: 'linkedin' },
  },
  {
    id: 'job-4',
    title: 'Data Analyst',
    company: 'Gamma',
    created_at: new Date().toISOString(),
    raw_data: { source: 'subscription' },
  },
] as const;

describe('job-feed utilities', () => {
  it('normalizes URLs by removing tracking parameters', () => {
    expect(normalizeJobUrl('https://jobs.acme.com/roles/react?utm_source=test&ref=mail')).toBe(
      'jobs.acme.com/roles/react',
    );
  });

  it('detects duplicate jobs by canonical identity', () => {
    const duplicates = buildDuplicateClusters([...baseJobs]);

    expect(duplicates.clusters).toHaveLength(1);
    expect(duplicates.clusters[0].ids).toEqual(['job-1', 'job-2']);
    expect(duplicates.byJobId['job-1']?.label).toContain('Senior React Engineer');
  });

  it('filters recommended and duplicate views correctly', () => {
    const duplicates = buildDuplicateClusters([...baseJobs]);
    const matches = {
      'job-1': { overall_score: 82, recommendation: 'apply' },
      'job-3': { overall_score: 42, recommendation: 'review' },
    };

    expect(filterJobsByFeedMode([...baseJobs], matches, 'recommended', duplicates.byJobId)).toEqual([
      baseJobs[0],
    ]);
    expect(filterJobsByFeedMode([...baseJobs], matches, 'duplicates', duplicates.byJobId)).toEqual([
      baseJobs[0],
      baseJobs[1],
    ]);
    expect(filterJobsByFeedMode([...baseJobs], matches, 'unscored', duplicates.byJobId)).toEqual([
      baseJobs[1],
      baseJobs[3],
    ]);
  });

  it('classifies feed sources from raw data and URLs', () => {
    expect(getFeedSource(baseJobs[0])).toBe('search');
    expect(getFeedSource(baseJobs[2])).toBe('linkedin');
    expect(getFeedSource(baseJobs[3])).toBe('subscription');
    expect(getFeedSource({ apply_url: 'https://company.example/jobs/1' })).toBe('manual');
  });
});
