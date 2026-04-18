import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { startRunLog, finishRunLog, updateRunLog } from "../_shared/linkedin-run-log.ts";
import { resolveRequestAuth } from "../_shared/request-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { userId, body } = await resolveRequestAuth(req);
    const payload = body as Record<string, unknown>;
    const { 
      source_id, 
      run_mode = "manual",
      discover_page_limit = 1,
      enrich_batch_limit = 10
    } = payload as any;

    // Find LinkedIn sources for this user
    let query = supabaseAdmin
      .from('job_sources')
      .select('*')
      .eq('user_id', userId)
      .eq('enabled', true);
    
    if (source_id) {
      query = query.eq('id', source_id);
    } else {
      // Find sources that look like LinkedIn
      query = query.or('source_name.ilike.%linkedin%,source_type.ilike.%linkedin%');
    }

    const { data: sources, error: sourceError } = await query;
    if (sourceError) throw sourceError;

    if (!sources || sources.length === 0) {
      return new Response(JSON.stringify({ message: "No enabled LinkedIn sources found", success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Start Pipeline Run Log
    const runId = await startRunLog(supabaseAdmin, {
      user_id: userId,
      run_mode,
      run_type: "pipeline",
      search_keywords: []
    });

    let totalDiscovered = 0;
    let totalStaged = 0;
    let totalEnriched = 0;

    for (const source of sources) {
      const config = (source.config as any) || {};
      const keywords = config.search_keywords || [config.search_query || source.source_name];
      const location = config.search_location || "United States";
      const remote_preference = config.remote_preference || "flexible";
      const posted_within = config.posted_within || "any";

      console.log(`Starting pipeline for source: ${source.source_name}`);

      // 1. Invoke Discover
      try {
        const discRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/linkedin-discover-jobs`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userId,
            source_id: source.id,
            keywords,
            location,
            remote_preference,
            posted_within,
            page_limit: config.page_limit || discover_page_limit,
            results_per_page: config.results_per_page || 25,
            run_mode
          })
        });

        if (discRes.ok) {
          const discData = await discRes.json();
          totalDiscovered += discData.discovered_count || 0;
          totalStaged += discData.staged_count || 0;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Discovery failed for source ${source.id}:`, message);
      }

      // Update progress
      await updateRunLog(supabaseAdmin, runId, {
        results_discovered: totalDiscovered,
        results_staged: totalStaged
      });

      // 2. Invoke Enrich
      try {
        const enrRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/linkedin-enrich-jobs`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userId,
            source_id: source.id,
            batch_limit: enrich_batch_limit,
            run_mode
          })
        });

        if (enrRes.ok) {
          const enrData = await enrRes.json();
          totalEnriched += enrData.enriched_count || 0;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Enrichment failed for source ${source.id}:`, message);
      }

      // Final progress update for this source
      await updateRunLog(supabaseAdmin, runId, {
        results_upserted: totalEnriched
      });
      
      // Update last synced
      await supabaseAdmin
        .from('job_sources')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', source.id);
    }

    await finishRunLog(supabaseAdmin, runId, totalEnriched > 0 ? "success" : "partial");

    return new Response(JSON.stringify({
      success: true,
      run_id: runId,
      discovery_count: totalDiscovered,
      new_stage_count: totalStaged,
      enrichment_count: totalEnriched
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("Pipeline error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
