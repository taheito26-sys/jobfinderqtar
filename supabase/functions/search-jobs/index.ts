import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getPipelineConfig, runPipelineText } from "../_shared/ai-pipeline.ts";
import { recordLedgerSync } from "../_shared/hardline-ledger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "ref", "refid"].forEach((param) => {
      url.searchParams.delete(param);
    });
    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
    const search = url.searchParams.toString();
    return `${url.hostname.toLowerCase()}${normalizedPath.toLowerCase()}${search ? `?${search}` : ""}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

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
    console.log(`[search-jobs] Pipeline: ${pipelineConfig.enabled ? "ON" : "OFF"}, providers: ${pipelineConfig.providers.map(p => p.name).join(" → ")}`);

    // --- LinkedIn Native Search ---
    const { linkedinProvider } = await import("../_shared/linkedin-provider.ts");
    const searchResult = await linkedinProvider.searchJobs({
      keywords: query,
      location: country || "",
      limit: Math.min(limit, 25),
    });

    if (searchResult.success && searchResult.jobs && searchResult.jobs.length > 0) {
      const jobs = searchResult.jobs;
      
      // Record in ledger
      try {
        await recordLedgerSync(supabaseClient as any, user.id, "linkedin-native-search", "search", jobs, {
          baseUrl: "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search",
          configJson: { query, country: country || null, limit },
          normalizationStatus: "incomplete",
          runMode: "collect",
        });
      } catch (ledgerError) {
        console.warn("Ledger sync failed for search-jobs:", ledgerError);
      }

      return new Response(JSON.stringify({ success: true, jobs, provider: "linkedin-native" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If LinkedIn fails or returns nothing, we checked the mission requirement:
    // "Remove Firecrawl as the primary search backend for LinkedIn job discovery"
    // "Firecrawl may remain optional fallback for non-LinkedIn general web search only"
    
    // If it was explicitly a LinkedIn search and failed, return error
    if (!searchResult.success && (query.toLowerCase().includes("linkedin") || searchResult.error_type === "RATE_LIMIT")) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: searchResult.error,
        error_type: searchResult.error_type || "PROVIDER_ERROR"
      }), {
        status: searchResult.error_type === "RATE_LIMIT" ? 429 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Fallback to Firecrawl for non-LinkedIn or as secondary fallback ---
    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: searchResult.error || "No results found and Firecrawl not configured" }), {
        status: searchResult.success ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const searchQuery = country ? `${query} ${country} job listing` : `${query} job listing`;
    const searchResponse = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: searchQuery, limit: Math.min(limit, 20) }),
    });

    const searchData = await searchResponse.json();
    if (!searchResponse.ok) {
      return new Response(JSON.stringify({ error: searchData.error || "Search failed" }), {
        status: searchResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = (searchData.data || []).map((r: any) => ({
      title: (r.metadata?.title || r.title || "Untitled Job").split(/\s[-–|@]\s/)[0]?.trim(),
      company: (r.metadata?.title || r.title || "").split(/\s[-–|@]\s/)[1]?.trim() || "Unknown Company",
      location: country || "",
      description: r.metadata?.description || (r.markdown || "").substring(0, 500),
      apply_url: r.url || "",
      source_url: r.url || "",
      source_created_at: r.metadata?.publishedDate || null,
      normalization_status: "incomplete"
    }));

    return new Response(JSON.stringify({ success: true, jobs: results, provider: "firecrawl-fallback" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message || "Search failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
