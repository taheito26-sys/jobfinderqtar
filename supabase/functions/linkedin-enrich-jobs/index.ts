import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { enrichLinkedInJob } from "../_shared/linkedin-job.ts";
import { startRunLog, updateRunLog, finishRunLog } from "../_shared/linkedin-run-log.ts";
import { isJobStale } from "../_shared/linkedin-dedup.ts";
import { resolveRequestAuth } from "../_shared/request-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EnrichInput {
  user_id?: string;
  source_id?: string;
  batch_limit?: number;
  run_mode?: "manual" | "scheduled";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { userId, body } = await resolveRequestAuth(req);
    const payload = body as EnrichInput;
    const { batch_limit = 5, run_mode = "manual", source_id } = payload;

    // Start Run Log
    const runId = await startRunLog(supabaseAdmin, {
      user_id: userId,
      source_id,
      run_mode,
      run_type: "enrich",
      search_keywords: []
    });

    // 1. Find candidates in discovered table
    const { data: candidates, error: candError } = await supabaseAdmin
      .from('linkedin_discovered_jobs')
      .select('*')
      .eq('user_id', userId)
      .in('enrichment_status', ['pending', 'failed'])
      .lt('failure_count', 3)
      .order('created_at', { ascending: false })
      .limit(batch_limit);

    if (candError) throw candError;

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const cand of candidates || []) {
      // Check if already in final jobs and NOT stale
      const { data: existingJob } = await supabaseAdmin
        .from('jobs')
        .select('*')
        .eq('user_id', userId)
        .eq('linkedin_job_id', cand.linkedin_job_id)
        .maybeSingle();

      if (existingJob && !isJobStale(existingJob)) {
        console.log(`Job ${cand.linkedin_job_id} already exists and is fresh. Skipping.`);
        await supabaseAdmin
          .from('linkedin_discovered_jobs')
          .update({ enrichment_status: 'skipped' })
          .eq('id', cand.id);
        skippedCount++;
        continue;
      }

      console.log(`Enriching LinkedIn job: ${cand.linkedin_job_id} (${cand.title})`);
      
      try {
        await supabaseAdmin
          .from('linkedin_discovered_jobs')
          .update({ enrichment_status: 'running' })
          .eq('id', cand.id);

        const enriched = await enrichLinkedInJob(cand.linkedin_job_id, userId);

        if (enriched) {
          // Upsert into final jobs
          const { error: upsertError } = await supabaseAdmin
            .from('jobs')
            .upsert({
              user_id: userId,
              source_id: cand.source_id,
              linkedin_job_id: cand.linkedin_job_id,
              source_platform: 'linkedin',
              title: enriched.title || cand.title,
              company: enriched.company || cand.company,
              location: enriched.location || cand.location,
              remote_type: enriched.remote_type,
              description: enriched.description,
              employment_type: enriched.employment_type,
              seniority_level: enriched.seniority_level,
              requirements: enriched.requirements,
              apply_url: enriched.apply_url || cand.apply_url,
              source_url: `https://www.linkedin.com/jobs/view/${cand.linkedin_job_id}/`,
              source_created_at: enriched.source_created_at || cand.source_created_at,
              raw_source_card: cand.raw_card_payload,
              raw_source_detail: enriched.raw_source_detail,
              discovery_run_id: runId,
              last_seen_at: new Date().toISOString()
            }, { 
              onConflict: 'user_id, linkedin_job_id' 
            });

          if (upsertError) throw upsertError;

          await supabaseAdmin
            .from('linkedin_discovered_jobs')
            .update({ enrichment_status: 'success', discovery_status: 'enriched' })
            .eq('id', cand.id);
          
          successCount++;
          
          // Trigger scoring/notifications? 
          // (Usually handled by existing triggers or callers)
          
        } else {
          throw new Error("AI returned no data for job");
        }

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Enrichment failed for ${cand.linkedin_job_id}:`, message);
        await supabaseAdmin
          .from('linkedin_discovered_jobs')
          .update({ 
            enrichment_status: 'failed', 
            failure_count: cand.failure_count + 1,
            last_error: message
          })
          .eq('id', cand.id);
        failedCount++;
      }

      // Progress update
      await updateRunLog(supabaseAdmin, runId, {
        results_enriched: successCount + failedCount + skippedCount,
        results_upserted: successCount,
        results_failed: failedCount
      });

      // Avoid aggressive rate limits
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
    }

    await finishRunLog(supabaseAdmin, runId, successCount > 0 ? "success" : "partial");

    return new Response(JSON.stringify({
      success: true,
      run_id: runId,
      enriched_count: successCount,
      failed_count: failedCount,
      skipped_count: skippedCount
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("Enrichment error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
