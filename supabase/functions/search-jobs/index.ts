import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getPipelineConfig } from "../_shared/ai-pipeline.ts";
import { recordLedgerSync } from "../_shared/hardline-ledger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { query, limit = 10, country } = await req.json();
    if (!query) {
      return new Response(JSON.stringify({ error: "Search query is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pipelineConfig = await getPipelineConfig(user.id);
    console.log(`[search-jobs] Pipeline: ${pipelineConfig.enabled ? "ON" : "OFF"}, country: ${country || 'Global'}, query: ${query}`);

    // --- LinkedIn Native Search ONLY ---
    // Firecrawl is removed to avoid 402 Payment Required in production
    const { linkedinProvider } = await import("../_shared/linkedin-provider.ts");
    const searchResult = await linkedinProvider.searchJobs({
      keywords: query,
      location: country || "",
      limit: Math.min(limit, 25),
    });

    if (searchResult.success) {
      const jobs = searchResult.jobs || [];
      
      // Record in ledger for auditing
      try {
        await recordLedgerSync(supabaseClient as any, user.id, "linkedin-native-search", "search", jobs, {
          baseUrl: "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search",
          configJson: { query, country: country || null, limit },
          normalizationStatus: jobs.length > 0 ? "incomplete" : "valid",
          runMode: "collect",
        });
      } catch (ledgerError) {
        console.warn("Ledger sync failed for search-jobs:", ledgerError);
      }

      return new Response(JSON.stringify({ 
        success: true, 
        jobs, 
        provider: "linkedin-native" 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle provider error
    console.error("LinkedIn native search error:", searchResult.error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: searchResult.error || "Search failed",
      error_type: searchResult.error_type || "PROVIDER_ERROR",
      message: `LinkedIn provider error: ${searchResult.error}`
    }), {
      status: searchResult.error_type === "RATE_LIMIT" ? 429 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Critical search failure:", error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error.message || "Search failed" 
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
