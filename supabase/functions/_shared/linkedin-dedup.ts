// LinkedIn Dedup Module
// Handles logic for checking if jobs are new, duplicate, or stale.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

/**
 * Checks if a job should be re-enriched
 */
export function isJobStale(job: any, thresholdDays: number = 7): boolean {
  if (!job) return true;
  
  // Missing critical fields
  if (!job.description || job.description.length < 100) return true;
  if (!job.company || job.company === 'Unknown Company') return true;
  if (!job.apply_url) return true;
  
  // Last seen too long ago
  const lastSeen = new Date(job.last_seen_at || job.updated_at || 0);
  const now = new Date();
  const diffDays = (now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);
  
  return diffDays > thresholdDays;
}

/**
 * Checks status in discovered table vs final jobs table
 */
export async function checkLinkedInJobStatus(
  supabase: any,
  userId: string,
  linkedinJobId: string
): Promise<{ 
  inDiscovered: boolean; 
  inJobs: boolean; 
  discoveredRow?: any; 
  jobRow?: any; 
}> {
  // Check discovered table
  const { data: discovered } = await supabase
    .from('linkedin_discovered_jobs')
    .select('*')
    .eq('user_id', userId)
    .eq('linkedin_job_id', linkedinJobId)
    .maybeSingle();

  // Check final jobs table
  const { data: job } = await supabase
    .from('jobs')
    .select('*')
    .eq('user_id', userId)
    .eq('linkedin_job_id', linkedinJobId)
    .maybeSingle();

  return {
    inDiscovered: !!discovered,
    inJobs: !!job,
    discoveredRow: discovered,
    jobRow: job
  };
}
