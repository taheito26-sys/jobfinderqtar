export type InboxSubmission = {
  id: string;
  submitted_at: string;
  follow_up_date?: string | null;
  submission_status?: string | null;
  response_received_at?: string | null;
  outcome_notes?: string | null;
  jobs?: {
    title?: string | null;
    company?: string | null;
  } | null;
};

export type InboxSubscription = {
  id: string;
  name: string;
  jobs_found_total?: number | null;
  enabled?: boolean | null;
};

export type InboxJob = {
  id: string;
  raw_data?: { [key: string]: unknown } | null;
};

export type InboxMatch = {
  job_id: string;
  overall_score?: number | null;
  recommendation?: string | null;
};

export type SourceInsight = {
  subscriptionId: string;
  name: string;
  importedJobs: number;
  averageScore: number;
  recommendedJobs: number;
  jobsFoundTotal: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function getStaleApplications(submissions: InboxSubmission[], now = new Date()): InboxSubmission[] {
  return submissions.filter((submission) => {
    const status = submission.submission_status || 'submitted';
    if (!['submitted', 'acknowledged', 'no_response'].includes(status)) return false;
    if (submission.response_received_at) return false;

    const submittedAt = new Date(submission.submitted_at).getTime();
    const followUpAt = submission.follow_up_date ? new Date(submission.follow_up_date).getTime() : null;
    return (
      now.getTime() - submittedAt >= 7 * DAY_MS ||
      (followUpAt !== null && !Number.isNaN(followUpAt) && followUpAt <= now.getTime())
    );
  });
}

export function getInterviewDeadlines(submissions: InboxSubmission[], now = new Date()): InboxSubmission[] {
  return submissions.filter((submission) => {
    if (submission.submission_status !== 'interview' || !submission.follow_up_date) return false;
    const followUpAt = new Date(submission.follow_up_date).getTime();
    if (Number.isNaN(followUpAt)) return false;
    const diff = followUpAt - now.getTime();
    return diff >= -DAY_MS && diff <= 14 * DAY_MS;
  });
}

export function getTopSubscriptionSources(
  subscriptions: InboxSubscription[],
  jobs: InboxJob[],
  matches: InboxMatch[],
): SourceInsight[] {
  const matchesByJobId = new Map(matches.map((match) => [match.job_id, match]));
  const stats = new Map<string, { importedJobs: number; scoreTotal: number; scoreCount: number; recommendedJobs: number }>();

  jobs.forEach((job) => {
    const subscriptionId = typeof job.raw_data?.subscription_id === 'string' ? job.raw_data.subscription_id : null;
    if (!subscriptionId) return;

    const existing = stats.get(subscriptionId) ?? {
      importedJobs: 0,
      scoreTotal: 0,
      scoreCount: 0,
      recommendedJobs: 0,
    };

    existing.importedJobs += 1;
    const match = matchesByJobId.get(job.id);
    if (typeof match?.overall_score === 'number') {
      existing.scoreTotal += match.overall_score;
      existing.scoreCount += 1;
    }
    if (match?.recommendation === 'apply') {
      existing.recommendedJobs += 1;
    }

    stats.set(subscriptionId, existing);
  });

  return subscriptions
    .filter((subscription) => stats.has(subscription.id))
    .map((subscription) => {
      const stat = stats.get(subscription.id)!;
      return {
        subscriptionId: subscription.id,
        name: subscription.name,
        importedJobs: stat.importedJobs,
        averageScore: stat.scoreCount > 0 ? Math.round(stat.scoreTotal / stat.scoreCount) : 0,
        recommendedJobs: stat.recommendedJobs,
        jobsFoundTotal: subscription.jobs_found_total ?? 0,
      };
    })
    .sort((a, b) =>
      b.recommendedJobs - a.recommendedJobs ||
      b.averageScore - a.averageScore ||
      b.importedJobs - a.importedJobs,
    );
}
