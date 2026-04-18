import { supabase } from '@/integrations/supabase/client';

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

export const scrapeJobUrl = async (url: string): Promise<{ success: boolean; job?: ScrapedJob; error?: string; message?: string }> => {
  const { data, error } = await supabase.functions.invoke('scrape-job-url', {
    body: { url },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  if (data?.error) {
    return { success: false, error: data.message || data.error, message: data.message || data.error };
  }

  return { success: true, job: data.job };
};

export const scrapeJobUrlWithReaderFallback = async (
  url: string,
  options?: { jobId?: string | null },
): Promise<{ success: boolean; job?: ScrapedJob; jobs?: ScrapedJob[]; multiple?: boolean; listing?: boolean; total_count?: number; total_found?: number; failed_count?: number; error?: string; message?: string; fallback?: boolean }> => {
  const wantsMultiJobRetry = isLinkedInSearchUrl(url);
  const jobId = options?.jobId?.trim();
  const invokeBody: Record<string, unknown> = { url };
  if (jobId) invokeBody.job_id = jobId;
  const first = await supabase.functions.invoke('scrape-job-url', {
    body: invokeBody,
  });

  const firstJobs = Array.isArray(first.data?.jobs) ? first.data.jobs : [];
  const firstWasMulti = Boolean(first.data?.multiple && firstJobs.length > 1);
  const firstWasSingle = Boolean(first.data?.job) && !firstWasMulti;

  if (firstWasMulti) {
    return first.data;
  }

  if (!wantsMultiJobRetry && !first.error && !first.data?.fallback) {
    return first.data ?? { success: false, error: 'Could not extract job data from this URL.' };
  }

  if (!wantsMultiJobRetry && firstWasSingle && !first.data?.fallback && !first.error) {
    return first.data;
  }

  if (first.error && isLinkedInJobViewUrl(url) && !wantsMultiJobRetry) {
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
    return first.error
      ? { success: false, error: first.error.message, message: first.error.message, fallback: true }
      : first.data;
  }

  const retry = await supabase.functions.invoke('scrape-job-url', {
    body: {
      ...invokeBody,
      manualDescription: readerText,
    },
  });

  if (retry.error) {
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
      error: retry.error.message,
      message: retry.error.message,
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
