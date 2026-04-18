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
): Promise<{ success: boolean; job?: ScrapedJob; jobs?: ScrapedJob[]; multiple?: boolean; listing?: boolean; total_count?: number; total_found?: number; failed_count?: number; error?: string; message?: string; fallback?: boolean }> => {
  const first = await supabase.functions.invoke('scrape-job-url', {
    body: { url },
  });

  if (!first.error && !first.data?.fallback) {
    return first.data ?? { success: false, error: 'Could not extract job data from this URL.' };
  }

  const readerText = await fetchReaderText(url);
  if (!readerText) {
    return first.error
      ? { success: false, error: first.error.message, message: first.error.message, fallback: true }
      : first.data;
  }

  const retry = await supabase.functions.invoke('scrape-job-url', {
    body: { url, manualDescription: readerText },
  });

  if (retry.error) {
    return {
      success: false,
      error: retry.error.message,
      message: retry.error.message,
      fallback: true,
    };
  }

  if (retry.data?.error) {
    return {
      success: false,
      error: retry.data.message || retry.data.error,
      message: retry.data.message || retry.data.error,
      fallback: true,
    };
  }

  return retry.data;
};
