// LinkedIn Run Log Module
// Helpers for managing the linkedin_search_runs table.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

export interface RunLogUpdate {
  results_discovered?: number;
  results_staged?: number;
  results_enriched?: number;
  results_upserted?: number;
  results_failed?: number;
  status?: "running" | "success" | "partial" | "failed";
  error_summary?: string;
  completed_at?: string;
}

/** Starts a new run log entry */
export async function startRunLog(
  supabase: any,
  run: {
    user_id: string;
    source_id?: string;
    run_mode: "manual" | "scheduled";
    run_type: "discover" | "enrich" | "pipeline";
    search_keywords: string[];
    search_location?: string;
    remote_preference?: string;
    posted_within?: string;
    page_limit?: number;
  }
): Promise<string> {
  const { data, error } = await supabase
    .from('linkedin_search_runs')
    .insert({
      ...run,
      status: 'running',
      started_at: new Date().toISOString()
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/** Updates an existing run log entry */
export async function updateRunLog(
  supabase: any,
  runId: string,
  update: RunLogUpdate
) {
  const { error } = await supabase
    .from('linkedin_search_runs')
    .update(update)
    .eq('id', runId);

  if (error) console.error(`Failed to update run log ${runId}:`, error.message);
}

/** Finalizes a run log entry */
export async function finishRunLog(
  supabase: any,
  runId: string,
  status: "success" | "partial" | "failed",
  errorSummary?: string
) {
  await updateRunLog(supabase, runId, {
    status,
    error_summary: errorSummary,
    completed_at: new Date().toISOString()
  });
}
