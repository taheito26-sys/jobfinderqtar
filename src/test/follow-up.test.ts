import { describe, expect, it } from 'vitest';

import {
  getInterviewDeadlines,
  getStaleApplications,
  getTopSubscriptionSources,
} from '@/lib/follow-up';

const now = new Date('2026-04-12T10:00:00.000Z');

describe('follow-up helpers', () => {
  it('detects stale submissions by age or due follow-up', () => {
    const stale = getStaleApplications([
      {
        id: 'sub-1',
        submitted_at: '2026-04-01T10:00:00.000Z',
        submission_status: 'submitted',
      },
      {
        id: 'sub-2',
        submitted_at: '2026-04-10T10:00:00.000Z',
        follow_up_date: '2026-04-11',
        submission_status: 'acknowledged',
      },
      {
        id: 'sub-3',
        submitted_at: '2026-04-10T10:00:00.000Z',
        submission_status: 'interview',
      },
    ], now);

    expect(stale.map((submission) => submission.id)).toEqual(['sub-1', 'sub-2']);
  });

  it('detects upcoming interview deadlines', () => {
    const interviews = getInterviewDeadlines([
      {
        id: 'sub-1',
        submitted_at: '2026-04-08T10:00:00.000Z',
        follow_up_date: '2026-04-15',
        submission_status: 'interview',
      },
      {
        id: 'sub-2',
        submitted_at: '2026-04-08T10:00:00.000Z',
        follow_up_date: '2026-05-10',
        submission_status: 'interview',
      },
    ], now);

    expect(interviews.map((submission) => submission.id)).toEqual(['sub-1']);
  });

  it('ranks top subscription sources by recommendations and score', () => {
    const sources = getTopSubscriptionSources(
      [
        { id: 'source-1', name: 'React Alerts', jobs_found_total: 18 },
        { id: 'source-2', name: 'Data Alerts', jobs_found_total: 9 },
      ],
      [
        { id: 'job-1', raw_data: { subscription_id: 'source-1' } },
        { id: 'job-2', raw_data: { subscription_id: 'source-1' } },
        { id: 'job-3', raw_data: { subscription_id: 'source-2' } },
      ],
      [
        { job_id: 'job-1', overall_score: 82, recommendation: 'apply' },
        { job_id: 'job-2', overall_score: 74, recommendation: 'review' },
        { job_id: 'job-3', overall_score: 91, recommendation: 'apply' },
      ],
    );

    expect(sources[0]).toMatchObject({ subscriptionId: 'source-2', averageScore: 91, recommendedJobs: 1 });
    expect(sources[1]).toMatchObject({ subscriptionId: 'source-1', importedJobs: 2, averageScore: 78 });
  });
});
