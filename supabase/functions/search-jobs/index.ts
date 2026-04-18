/**
 * search-jobs edge function
 *
 * Multi-source Qatar job search: LinkedIn + Indeed + Bayt.com + GulfTalent.
 * All sources run in parallel. Each source failure is isolated so that
 * a single source outage never returns zero results.
 *
 * Request body:
 *   { query: string, country?: string, limit?: number, sources?: object }
 *
 * Response:
 *   { success: true, jobs: MultiSourceJob[], counts: {...}, provider: "multi-source" }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { searchAllSources } from "../_shared/multi-source-search.ts";
import { recordLedgerSync } from "../_shared/hardline-ledger.ts";
import { loadLinkedInProfileContext } from "../_shared/linkedin-profile-search.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse request ───────────────────────────────────────────────────────
    const body = await req.json();
    const {
      query,
      limit = 50,
      country,
      sources,  // optional: { linkedin, indeed, bayt, gulftalent } booleans
    } = body;

    if (!query) {
      return new Response(JSON.stringify({ error: "Search query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Default location to Qatar if no country provided or if "Qatar" is implied
    const location = country || "Qatar";

    const profileContext = await loadLinkedInProfileContext(supabaseClient as any, user.id).catch(() => null);

    console.log(
      `[search-jobs] user=${user.id} query="${query}" location="${location}" limit=${limit}`
    );

    // ── Multi-source search ─────────────────────────────────────────────────
    const result = await searchAllSources({
      keywords: query,
      location,
      limit: Math.min(limit, 100),
      perSourceLimit: 25,
      sources: sources || {
        linkedin: true,
        indeed: true,
        bayt: true,
        gulftalent: true,
      },
      profile: profileContext,
    });

    const { jobs, counts, sources_with_results } = result;

    console.log(
      `[search-jobs] Returned ${jobs.length} jobs from sources: ${sources_with_results.join(", ")}`
    );

    // ── Audit ledger (best-effort, non-blocking) ────────────────────────────
    try {
      await recordLedgerSync(
        supabaseClient as any,
        user.id,
        "multi-source-search",
        "search",
        jobs,
        {
          baseUrl: "multi-source",
          configJson: { query, location, limit, counts },
          normalizationStatus: jobs.length > 0 ? "incomplete" : "valid",
          runMode: "collect",
        }
      );
    } catch (ledgerErr) {
      console.warn("[search-jobs] Ledger sync failed:", ledgerErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        jobs,
        counts,
        provider: "multi-source",
        sources_with_results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[search-jobs] Critical failure:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Search failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
