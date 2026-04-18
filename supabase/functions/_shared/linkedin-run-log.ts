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

function isMissingTableError(error: any): boolean {
  const message = String(error?.message || error?.details || error || '');
  return message.includes("linkedin_search_runs") && message.includes("Could not find the table");
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
): Promise<string | null> {
  const { data, error } = await supabase
    .from('linkedin_search_runs')
    .insert({
      ...run,
      status: 'running',
      started_at: new Date().toISOString()
    })
    .select('id')
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('[linkedin-run-log] linkedin_search_runs table is missing; skipping run logging.');
      return null;
    }
    throw error;
  }
  return data.id;
}

/** Updates an existing run log entry */
export async function updateRunLog(
  supabase: any,
  runId: string | null,
  update: RunLogUpdate
) {
  if (!runId) return;
  const { error } = await supabase
    .from('linkedin_search_runs')
    .update(update)
    .eq('id', runId);

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('[linkedin-run-log] linkedin_search_runs table is missing; skipping run log update.');
      return;
    }
    console.error(`Failed to update run log ${runId}:`, error.message);
  }
}

/** Finalizes a run log entry */
export async function finishRunLog(
  supabase: any,
  runId: string | null,
  status: "success" | "partial" | "failed",
  errorSummary?: string
) {
  if (!runId) return;
  await updateRunLog(supabase, runId, {
    status,
    error_summary: errorSummary,
    completed_at: new Date().toISOString()
  });
}
