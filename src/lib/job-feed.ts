export type FeedMode = 'all' | 'recommended' | 'unscored' | 'recent' | 'duplicates';

export type FeedJob = {
  id: string;
  title?: string | null;
  company?: string | null;
  apply_url?: string | null;
  source_url?: string | null;
  created_at?: string | null;
  raw_data?: { [key: string]: unknown } | null;
  salary_min?: number | null;
  salary_max?: number | null;
  status?: string | null;
};

export type FeedMatch = {
  overall_score?: number | null;
  recommendation?: string | null;
};

export type DuplicateCluster = {
  key: string;
  ids: string[];
  label: string;
};

export function normalizeJobText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeJobUrl(value: string | null | undefined): string {
  if (!value) return '';

  try {
    const url = new URL(value);
    url.hash = '';
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'trk',
      'ref',
      'refid',
    ];
    trackingParams.forEach((param) => url.searchParams.delete(param));
    const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';
    const search = url.searchParams.toString();
    return `${url.hostname.toLowerCase()}${normalizedPath.toLowerCase()}${search ? `?${search}` : ''}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

export function getJobIdentity(job: Pick<FeedJob, 'title' | 'company' | 'apply_url' | 'source_url'>): string {
  const normalizedUrl = normalizeJobUrl(job.apply_url || job.source_url);
  if (normalizedUrl) return `url:${normalizedUrl}`;

  const normalizedTitle = normalizeJobText(job.title);
  const normalizedCompany = normalizeJobText(job.company);
  return `title-company:${normalizedTitle}|${normalizedCompany}`;
}

export function buildDuplicateClusters<T extends FeedJob>(jobs: T[]): {
  clusters: DuplicateCluster[];
  byJobId: Record<string, DuplicateCluster>;
} {
  const groups = new Map<string, T[]>();

  jobs.forEach((job) => {
    const key = getJobIdentity(job);
    if (!key || key === 'title-company:|') return;

    const existing = groups.get(key) ?? [];
    existing.push(job);
    groups.set(key, existing);
  });

  const clusters = [...groups.entries()]
    .filter(([, groupedJobs]) => groupedJobs.length > 1)
    .map(([key, groupedJobs]) => {
      const first = groupedJobs[0];
      const labelParts = [first.title, first.company].filter(Boolean);
      return {
        key,
        ids: groupedJobs.map((job) => job.id),
        label: labelParts.join(' at ') || 'Duplicate job',
      };
    })
    .sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label));

  const byJobId: Record<string, DuplicateCluster> = {};
  clusters.forEach((cluster) => {
    cluster.ids.forEach((id) => {
      byJobId[id] = cluster;
    });
  });

  return { clusters, byJobId };
}

export function isRecentJob(job: Pick<FeedJob, 'created_at'>, days = 7): boolean {
  if (!job.created_at) return false;
  const createdAt = new Date(job.created_at).getTime();
  if (Number.isNaN(createdAt)) return false;
  return Date.now() - createdAt <= days * 24 * 60 * 60 * 1000;
}

export function filterJobsByFeedMode<T extends FeedJob>(
  jobs: T[],
  matches: Record<string, FeedMatch>,
  mode: FeedMode,
  duplicateLookup: Record<string, DuplicateCluster>,
): T[] {
  switch (mode) {
    case 'recommended':
      return jobs.filter((job) => {
        const match = matches[job.id];
        return match?.recommendation === 'apply' || (match?.overall_score ?? 0) >= 75;
      });
    case 'unscored':
      return jobs.filter((job) => !matches[job.id]);
    case 'recent':
      return jobs.filter((job) => isRecentJob(job));
    case 'duplicates':
      return jobs.filter((job) => Boolean(duplicateLookup[job.id]));
    default:
      return jobs;
  }
}

export function getFeedSource(job: Pick<FeedJob, 'apply_url' | 'source_url' | 'raw_data'>): string {
  const rawSource = String(job.raw_data?.source ?? '').toLowerCase();
  const sourceUrl = `${job.source_url ?? ''} ${job.apply_url ?? ''}`.toLowerCase();

  if (rawSource === 'subscription') return 'subscription';
  if (rawSource === 'search' || rawSource === 'auto_search') return 'search';
  if (rawSource === 'linkedin' || sourceUrl.includes('linkedin.com')) return 'linkedin';
  return 'manual';
}
