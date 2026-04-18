export function getBestJobDateCandidate(job: any): string | null {
  const raw = job?.raw_data as any;
  const candidate =
    job?.source_created_at ||
    job?.posted_at ||
    job?.discovered_at ||
    raw?.source_created_at ||
    raw?.posted_at ||
    raw?.hydrated_job?.source_created_at ||
    raw?.hydrated_job?.posted_at ||
    raw?.postedAt ||
    raw?.source_created_at_text ||
    raw?.listed_at_text ||
    raw?.posted_at_text ||
    raw?.date_posted ||
    raw?.date_posted_text ||
    raw?.date ||
    raw?.details?.source_created_at ||
    raw?.details?.posted_at ||
    raw?.details?.listed_at_text ||
    raw?.details?.posted_at_text ||
    raw?.details?.date_posted ||
    raw?.details?.date ||
    raw?.snippet?.source_created_at_text ||
    raw?.snippet?.listed_at_text ||
    raw?.snippet?.posted_at_text ||
    null;

  if (!candidate) return null;
  const text = String(candidate).trim();
  return text.length ? text : null;
}

export function parseJobDate(job: any): Date | null {
  const candidate = getBestJobDateCandidate(job);
  if (!candidate) return null;

  const direct = new Date(candidate);
  if (!Number.isNaN(direct.getTime())) return direct;

  const relative = candidate.toLowerCase();
  const match = relative.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2];
  const now = new Date();
  const deltaMs =
    unit === 'second' ? value * 1000 :
    unit === 'minute' ? value * 60 * 1000 :
    unit === 'hour' ? value * 60 * 60 * 1000 :
    unit === 'day' ? value * 24 * 60 * 60 * 1000 :
    unit === 'week' ? value * 7 * 24 * 60 * 60 * 1000 :
    unit === 'month' ? value * 30 * 24 * 60 * 60 * 1000 :
    value * 365 * 24 * 60 * 60 * 1000;

  return new Date(now.getTime() - deltaMs);
}

export function formatJobDate(job: any, options?: Intl.DateTimeFormatOptions): string | null {
  const parsed = parseJobDate(job);
  if (!parsed) return null;
  return parsed.toLocaleDateString(undefined, options ?? { year: 'numeric', month: 'long', day: 'numeric' });
}

export function getBestJobDescriptionCandidate(job: any): string | null {
  const raw = job?.raw_data as any;
  const candidate =
    job?.description ||
    raw?.description ||
    raw?.hydrated_job?.description ||
    raw?.details?.description ||
    raw?.raw_source_detail?.description ||
    raw?.snippet?.description ||
    raw?.summary ||
    raw?.details?.summary ||
    raw?.snippet?.summary ||
    null;

  if (!candidate) return null;
  const text = String(candidate).trim();
  return text.length ? text : null;
}
