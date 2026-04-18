import { supabase } from '@/integrations/supabase/client';
import { scrapeJobUrlWithReaderFallback } from '@/lib/api/firecrawl';

export type JobHydrationTarget = {
  id: string;
  apply_url?: string | null;
  source_url?: string | null;
};

export async function hydrateImportedJob(target: JobHydrationTarget) {
  const url = String(target.apply_url || target.source_url || '').trim();
  if (!target.id || !url) {
    return { ok: false, skipped: true, reason: 'missing_url' as const };
  }

  const data = await scrapeJobUrlWithReaderFallback(url);

  if (!data?.success || data?.error) {
    return { ok: false, error: data?.message || data?.error || 'Could not hydrate job' };
  }

  return { ok: true, data };
}

export async function hydrateImportedJobs(targets: JobHydrationTarget[]) {
  const settled = await Promise.allSettled(targets.map((target) => hydrateImportedJob(target)));

  let hydrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      if (result.value.skipped) skipped += 1;
      else if (result.value.ok) hydrated += 1;
      else failed += 1;
    } else {
      failed += 1;
    }
  }

  return { hydrated, skipped, failed };
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
  const settled = await Promise.allSettled(jobIds.map((jobId) => scoreImportedJob(jobId)));

  let scored = 0;
  let skipped = 0;
  let failed = 0;

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      if (result.value.skipped) skipped += 1;
      else if (result.value.ok) scored += 1;
      else failed += 1;
    } else {
      failed += 1;
    }
  }

  return { scored, skipped, failed };
}
