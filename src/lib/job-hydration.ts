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

  const data = await scrapeJobUrlWithReaderFallback(url, { jobId: target.id });

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

function hasMeaningfulText(value?: string | null) {
  return Boolean(String(value || '').trim().length > 0);
}

async function runInBatches<T>(items: T[], batchSize: number, worker: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(worker));
  }
}

export async function ensureJobsHydratedAndScored(targets: JobHydrationTarget[]) {
  const hydrateTargets = targets.filter((target) => !hasMeaningfulText(target.description) && Boolean(target.apply_url || target.source_url));
  const scoreTargets = targets.filter((target) => !target.has_match || hydrateTargets.some((hydrated) => hydrated.id === target.id));

  let hydrated = 0;
  let scored = 0;
  let skipped = 0;
  let failed = 0;

  await runInBatches(hydrateTargets, 3, async (target) => {
    const result = await hydrateImportedJob(target);
    if (result.skipped) skipped += 1;
    else if (result.ok) hydrated += 1;
    else failed += 1;
  });

  const scoreIds = [...new Set([
    ...scoreTargets.map((target) => target.id),
    ...hydrateTargets.map((target) => target.id),
  ])];

  await runInBatches(scoreIds, 4, async (jobId) => {
    const result = await scoreImportedJob(jobId);
    if (result.skipped) skipped += 1;
    else if (result.ok) scored += 1;
    else failed += 1;
  });

  return { hydrated, scored, skipped, failed };
}
