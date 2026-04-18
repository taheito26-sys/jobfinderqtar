import { supabase } from '@/integrations/supabase/client';
import { scrapeJobUrlWithReaderFallback } from '@/lib/api/firecrawl';

export type JobHydrationTarget = {
  id: string;
  apply_url?: string | null;
  source_url?: string | null;
  description?: string | null;
  has_match?: boolean;
};

export async function hydrateImportedJob(target: JobHydrationTarget) {
  const url = String(target.apply_url || target.source_url || '').trim();
  if (!target.id || !url) {
    return { ok: false, skipped: true, reason: 'missing_url' as const };
  }

  const data = await scrapeJobUrlWithReaderFallback(url, { jobId: target.id, userId });

  if (!data?.success || data?.error) {
    return { ok: false, error: data?.message || data?.error || 'Could not hydrate job' };
  }

  return { ok: true, data };
}

export async function hydrateImportedJobs(targets: JobHydrationTarget[]) {
  const jobIds = [...new Set(targets.map((target) => String(target.id || '').trim()).filter(Boolean))];
  if (jobIds.length === 0) {
    return { hydrated: 0, scored: 0, skipped: 1, failed: 0 };
  }

  const { data, error } = await supabase.functions.invoke('backfill-jobs', {
    body: { job_ids: jobIds },
  });

  if (error) {
    return { hydrated: 0, scored: 0, skipped: 0, failed: jobIds.length, error: error.message };
  }
  if (data?.error) {
    return { hydrated: 0, scored: 0, skipped: 0, failed: jobIds.length, error: data.error };
  }

  return {
    hydrated: data?.hydrated ?? 0,
    scored: data?.scored ?? 0,
    skipped: data?.skipped ?? 0,
    failed: data?.failed ?? 0,
  };
}

export async function scoreImportedJob(jobId: string) {
  const trimmedJobId = String(jobId || '').trim();
  if (!trimmedJobId) {
    return { ok: false, skipped: true, reason: 'missing_job_id' as const };
  }

  const { data, error } = await supabase.functions.invoke('score-job', {
    body: { job_id: trimmedJobId },
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  if (data?.error) {
    return { ok: false, error: data.error };
  }

  return { ok: true, data };
}

export async function scoreImportedJobs(jobIds: string[]) {
  const uniqueJobIds = [...new Set(jobIds.map((jobId) => String(jobId || '').trim()).filter(Boolean))];
  if (uniqueJobIds.length === 0) {
    return { hydrated: 0, scored: 0, skipped: 1, failed: 0 };
  }

  const { data, error } = await supabase.functions.invoke('backfill-jobs', {
    body: { job_ids: uniqueJobIds },
  });

  if (error) {
    return { hydrated: 0, scored: 0, skipped: 0, failed: uniqueJobIds.length, error: error.message };
  }
  if (data?.error) {
    return { hydrated: 0, scored: 0, skipped: 0, failed: uniqueJobIds.length, error: data.error };
  }

  return {
    hydrated: data?.hydrated ?? 0,
    scored: data?.scored ?? 0,
    skipped: data?.skipped ?? 0,
    failed: data?.failed ?? 0,
  };
}

function hasMeaningfulText(value?: string | null) {
  return Boolean(String(value || '').trim().length > 0);
}

async function runInBatches<T>(items: T[], batchSize: number, worker: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(worker));
  }
}
