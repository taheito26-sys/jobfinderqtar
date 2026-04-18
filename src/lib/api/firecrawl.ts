export type ScrapedJob = {
  title: string;
  company: string;
  location: string;
  remote_type: string;
  description: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  employment_type: string;
  seniority_level: string;
  requirements: string[];
  apply_url: string;
  /** ISO 8601 date string from the source website, null if not exposed by source */
  source_created_at: string | null;
};

function isLinkedInSearchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('linkedin.com') && (
      parsed.pathname.includes('/jobs/search') ||
      parsed.pathname.includes('/jobs/collections') ||
      parsed.searchParams.has('currentJobId') ||
      parsed.searchParams.has('jobId') ||
      parsed.searchParams.has('referenceJobId') ||
      parsed.searchParams.has('originToLandingJobPostings')
    );
  } catch {
    return false;
  }
}

function isLinkedInJobViewUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('linkedin.com') && parsed.pathname.includes('/jobs/view/');
  } catch {
    return false;
  }
}

async function fetchReaderText(url: string): Promise<string | null> {
  try {
    const normalized = url.replace(/^https?:\/\//i, '');
    const readerUrl = `https://r.jina.ai/http://${normalized}`;
    const res = await fetch(readerUrl);
    if (!res.ok) return null;
    const text = await res.text();
    const clipped = text.slice(0, 12000).trim();
    return clipped.length >= 100 ? clipped : null;
  } catch {
    return null;
  }
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

async function invokeScrapeJobUrl(body: Record<string, unknown>) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/scrape-job-url`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { response, data };
}

export const scrapeJobUrl = async (url: string, options?: { userId?: string | null }): Promise<{ success: boolean; job?: ScrapedJob; error?: string; message?: string }> => {
  const { response, data } = await invokeScrapeJobUrl({ url, ...(options?.userId ? { user_id: options.userId } : {}) });

  if (!response.ok) {
    return { success: false, error: data?.message || data?.error || `Edge Function returned HTTP ${response.status}`, message: data?.message || data?.error };
  }

  if (data?.error) {
    return { success: false, error: data.message || data.error, message: data.message || data.error };
  }

  return { success: true, job: data.job };
};

export const scrapeJobUrlWithReaderFallback = async (
  url: string,
  options?: { jobId?: string | null; userId?: string | null },
): Promise<{ success: boolean; job?: ScrapedJob; jobs?: ScrapedJob[]; multiple?: boolean; listing?: boolean; total_count?: number; total_found?: number; failed_count?: number; error?: string; message?: string; fallback?: boolean }> => {
  const wantsMultiJobRetry = isLinkedInSearchUrl(url);
  const jobId = options?.jobId?.trim();
  const invokeBody: Record<string, unknown> = { url };
  if (jobId) invokeBody.job_id = jobId;
  if (options?.userId) invokeBody.user_id = options.userId;
  const first = await invokeScrapeJobUrl(invokeBody);

  const firstJobs = Array.isArray(first.data?.jobs) ? first.data.jobs : [];
  const firstWasMulti = Boolean(first.data?.multiple && firstJobs.length > 1);
  const firstWasSingle = Boolean(first.data?.job) && !firstWasMulti;

  if (firstWasMulti) {
    return first.data;
  }

  if (!wantsMultiJobRetry && first.response.ok && !first.data?.fallback) {
    return first.data ?? { success: false, error: 'Could not extract job data from this URL.' };
  }

  if (!wantsMultiJobRetry && firstWasSingle && !first.data?.fallback) {
    return first.data;
  }

  if (!first.response.ok && isLinkedInJobViewUrl(url) && !wantsMultiJobRetry) {
    return {
      success: false,
      error: 'LINKEDIN_LOGIN_REQUIRED',
      message: 'This LinkedIn job requires login to view. Use the "Paste Description" tab to manually paste the job details.',
      fallback: true,
    };
  }

  const readerText = await fetchReaderText(url);
  if (!readerText) {
    if (wantsMultiJobRetry) {
      return {
        success: false,
        error: 'Could not extract multiple jobs from this LinkedIn search page.',
        message: 'Could not extract multiple jobs from this LinkedIn search page.',
        fallback: true,
      };
    }
    return first.data
      ? first.data
      : { success: false, error: 'Could not extract job data from this URL.', fallback: true };
  }

  const retry = await invokeScrapeJobUrl({
    ...invokeBody,
    manualDescription: readerText,
  });

  if (!retry.response.ok) {
    if (isLinkedInJobViewUrl(url) && !wantsMultiJobRetry) {
      return {
        success: false,
        error: 'LINKEDIN_LOGIN_REQUIRED',
        message: 'This LinkedIn job requires login to view. Use the "Paste Description" tab to manually paste the job details.',
        fallback: true,
      };
    }
    return {
      success: false,
      error: retry.data?.message || retry.data?.error || `Edge Function returned HTTP ${retry.response.status}`,
      message: retry.data?.message || retry.data?.error,
      fallback: true,
    };
  }

  if (retry.data?.error) {
    if (isLinkedInJobViewUrl(url) && !wantsMultiJobRetry) {
      return {
        success: false,
        error: 'LINKEDIN_LOGIN_REQUIRED',
        message: 'This LinkedIn job requires login to view. Use the "Paste Description" tab to manually paste the job details.',
        fallback: true,
      };
    }
    return {
      success: false,
      error: retry.data.message || retry.data.error,
      message: retry.data.message || retry.data.error,
      fallback: true,
    };
  }

  const retryJobs = Array.isArray(retry.data?.jobs) ? retry.data.jobs : [];
  if (wantsMultiJobRetry && (!retry.data?.multiple || retryJobs.length <= 1)) {
    return {
      success: false,
      error: 'Could not extract multiple jobs from this LinkedIn search page.',
      message: 'Could not extract multiple jobs from this LinkedIn search page.',
      fallback: true,
    };
  }

  return retry.data;
};
