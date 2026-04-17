import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { fetchLinkedInSearch } from "../_shared/linkedin-search.ts";
import { startRunLog, updateRunLog, finishRunLog } from "../_shared/linkedin-run-log.ts";
import { parseLinkedInRelativeDate } from "../_shared/linkedin-job.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DiscoverInput {
  user_id?: string;
  source_id?: string;
  keywords: string[];
  location?: string;
  remote_preference?: "remote" | "onsite" | "hybrid" | "flexible";
  posted_within?: "24h" | "week" | "month" | "any";
  page_limit?: number;
  results_per_page?: number;
  run_mode?: "manual" | "scheduled";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate Auth or Service Role
    const authHeader = req.headers.get("Authorization");
    let userId: string;
    
    if (authHeader?.startsWith("Bearer ")) {
      const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
      if (authError || !user) throw new Error("Unauthorized");
      userId = user.id;
    } else {
      // Allow service role or explicit user_id if triggered internally
      const body = await req.clone().json();
      if (!body.user_id) throw new Error("Missing user_id for system call");
      userId = body.user_id;
    }

    const payload: DiscoverInput = await req.json();
    const {
      keywords,
      location = "United States",
      remote_preference = "flexible",
      posted_within = "any",
      page_limit = 1,
      results_per_page = 25,
      run_mode = "manual",
      source_id
    } = payload;

    if (!keywords || keywords.length === 0) throw new Error("Keywords are required");

    // Start Run Log
    const runId = await startRunLog(supabaseAdmin, {
      user_id: userId,
      source_id,
      run_mode,
      run_type: "discover",
      search_keywords: keywords,
      search_location: location,
      remote_preference,
      posted_within,
      page_limit
    });

    let discoveredCount = 0;
    let stagedCount = 0;
    let failedCount = 0;

    for (const keyword of keywords) {
      console.log(`Discovering jobs for [${keyword}] in [${location}]`);
      
      for (let page = 0; page < page_limit; page++) {
        try {
          const cards = await fetchLinkedInSearch({
            keywords: keyword,
            location,
            remotePreference: remote_preference as any,
            postedWithin: posted_within as any,
            limit: results_per_page,
            pageNum: page,
          });

          if (cards.length === 0) {
            console.log(`No cards found on page ${page} for keyword ${keyword}`);
            break; 
          }

          discoveredCount += cards.length;

          // Process and stage each card
          for (const card of cards) {
            try {
              const sourceCreatedAt = parseLinkedInRelativeDate(card.source_created_at_text);

              const { data: existing } = await supabaseAdmin
                .from('linkedin_discovered_jobs')
                .select('id, discovery_status')
                .eq('user_id', userId)
                .eq('linkedin_job_id', card.linkedin_job_id)
                .maybeSingle();

              if (existing) {
                // Update existing
                await supabaseAdmin
                  .from('linkedin_discovered_jobs')
                  .update({
                    last_seen_at: new Date().toISOString(),
                    title: card.title,
                    company: card.company,
                    location: card.location,
                    listed_at_text: card.source_created_at_text,
                    source_created_at: sourceCreatedAt || undefined,
                    discovery_status: existing.discovery_status === 'failed' ? 'new' : existing.discovery_status
                  })
                  .eq('id', existing.id);
              } else {
                // Insert new
                const { error: insError } = await supabaseAdmin
                  .from('linkedin_discovered_jobs')
                  .insert({
                    user_id: userId,
                    source_id,
                    run_id: runId,
                    linkedin_job_id: card.linkedin_job_id,
                    title: card.title,
                    company: card.company,
                    location: card.location,
                    listed_at_text: card.source_created_at_text,
                    source_created_at: sourceCreatedAt,
                    apply_url: card.apply_url,
                    search_url: null,
                    search_keyword: keyword,
                    search_location: location,
                    page_number: page,
                    raw_card_payload: card.raw_card_payload,
                    discovery_status: 'new',
                    enrichment_status: 'pending'
                  });

                if (insError) throw insError;
                stagedCount++;
              }
            } catch (cardErr) {
              console.error(`Failed to stage card ${card.linkedin_job_id}:`, cardErr.message);
              failedCount++;
            }
          }

          // Update intermittent progress
          await updateRunLog(supabaseAdmin, runId, {
            results_discovered: discoveredCount,
            results_staged: stagedCount,
            results_failed: failedCount
          });

          // Jitter/delay to avoid aggressive scraping detection
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));

        } catch (pageErr) {
          console.error(`Failed to fetch page ${page} for keyword ${keyword}:`, pageErr.message);
          failedCount++;
          if (pageErr.message.includes("rate limited")) break; // Stop this keyword
        }
      }
    }

    await finishRunLog(supabaseAdmin, runId, stagedCount > 0 ? "success" : "partial");

    return new Response(JSON.stringify({
      success: true,
      run_id: runId,
      discovered_count: discoveredCount,
      staged_count: stagedCount,
      failed_count: failedCount
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("Discovery error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
