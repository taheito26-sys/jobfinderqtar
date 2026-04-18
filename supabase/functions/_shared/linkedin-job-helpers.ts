/** Extract ALL job IDs from a LinkedIn search/collection URL */
export function extractAllLinkedInJobIds(url: string): string[] {
  const ids = new Set<string>();

  const currentMatch = url.match(/currentJobId=(\d+)/);
  if (currentMatch) ids.add(currentMatch[1]);

  const referenceMatch = url.match(/referenceJobId=(\d+)/);
  if (referenceMatch) ids.add(referenceMatch[1]);

  const landingMatch = url.match(/originToLandingJobPostings=([^&]+)/);
  if (landingMatch) {
    const decoded = decodeURIComponent(landingMatch[1]);
    decoded.split(/[,%2C]+/).forEach((id) => {
      const trimmed = id.trim();
      if (/^\d+$/.test(trimmed)) ids.add(trimmed);
    });
  }

  const viewMatch = url.match(/\/jobs\/view\/(\d+)/);
  if (viewMatch) ids.add(viewMatch[1]);

  return [...ids];
}

/** Check if this is a LinkedIn search/collection page (not a single job view) */
export function isLinkedInSearchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (path.includes('/jobs/search') || path.includes('/jobs/collections')) return true;
    if (path.includes('/jobs/search') && (
      u.searchParams.has('currentJobId') ||
      u.searchParams.has('jobId') ||
      u.searchParams.has('referenceJobId') ||
      u.searchParams.has('originToLandingJobPostings')
    )) return true;
    if (u.searchParams.get('originToLandingJobPostings')) return true;
    return false;
  } catch {
    return false;
  }
}

/** Extract LinkedIn Job ID from various URL patterns */
export function extractLinkedInJobId(url: string): string | null {
  const match = url.match(/\/jobs\/view\/(?:[^\/]*-)?(\d+)\/?/) ||
    url.match(/currentJobId=(\d+)/) ||
    url.match(/\/jobs\/search\/\?.*jobId=(\d+)/);
  return match ? match[1] : null;
}

/** Normalize LinkedIn URL by removing tracking parameters */
export function normalizeLinkedInUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('linkedin.com')) {
      if (parsed.pathname.includes('/jobs/search') || parsed.pathname.includes('/jobs/collections')) {
        return url;
      }
      const jobId = extractLinkedInJobId(url);
      if (jobId) return `https://www.linkedin.com/jobs/view/${jobId}/`;
    }
    return url;
  } catch {
    return url;
  }
}
