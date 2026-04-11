import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getPipelineConfig, runPipelineText } from "../_shared/ai-pipeline.ts";

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

    const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Firecrawl not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pipelineConfig = await getPipelineConfig(user.id);
    console.log(`[search-jobs] Pipeline: ${pipelineConfig.enabled ? "ON" : "OFF"}, providers: ${pipelineConfig.providers.map(p => p.name).join(" → ")}`);

    const searchQuery = country ? `${query} ${country} job listing` : `${query} job listing`;
    console.log("Searching jobs:", searchQuery, "limit:", limit);

    const searchResponse = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: searchQuery, limit: Math.min(limit, 20) }),
    });

    const searchData = await searchResponse.json();
    if (!searchResponse.ok) {
      console.error("Firecrawl search error:", searchData);
      return new Response(JSON.stringify({ error: searchData.error || "Search failed" }), {
        status: searchResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawResults = searchData.data || [];

    if (rawResults.length > 0) {
      try {
        const summaries = rawResults.map((r: any, i: number) => {
          const title = r.metadata?.title || r.title || "";
          const desc = r.metadata?.description || "";
          const markdown = (r.markdown || "").substring(0, 800);
          return `[${i}] URL: ${r.url}\nTitle: ${title}\nDescription: ${desc}\nContent: ${markdown}`;
        }).join("\n---\n");

        const { result: raw, providerChain } = await runPipelineText({
          config: pipelineConfig,
          systemPrompt: "You extract structured job listing data. Return ONLY valid JSON array. No markdown wrapping.",
          userPrompt: `Extract job details from these search results. Return a JSON array of objects with these fields:
- index (number matching [N] above)
- title (job title only, not company)
- company (company name)
- location (city/country)
- remote_type ("remote"|"hybrid"|"onsite"|"unknown")
- employment_type ("full-time"|"part-time"|"contract"|"internship")
- seniority_level (e.g. "Senior", "Mid", "Junior", "")
- salary_min (number or null)
- salary_max (number or null)
- salary_currency (e.g. "USD","QAR" or null)
- requirements (array of key requirements, max 5)

Skip entries that are not actual job postings.

Results:
${summaries}`,
          reviewInstruction: "Verify extracted job data is accurate. Ensure titles don't include company names. Check that indices match the source results. Remove any entries that aren't real job postings. Fix formatting issues.",
        });

        console.log(`[search-jobs] Pipeline chain: ${providerChain.join(" → ")}`);

        const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          const enriched = parsed.map((p: any) => {
            const source = rawResults[p.index];
            if (!source) return null;
            return {
              title: p.title || "Untitled Job",
              company: p.company || "Unknown Company",
              location: p.location || "",
              remote_type: p.remote_type || "unknown",
              description: source.metadata?.description || (source.markdown || "").substring(0, 1000),
              salary_min: p.salary_min || null,
              salary_max: p.salary_max || null,
              salary_currency: p.salary_currency || null,
              employment_type: p.employment_type || "full-time",
              seniority_level: p.seniority_level || "",
              requirements: Array.isArray(p.requirements) ? p.requirements : [],
              apply_url: source.url || "",
              source_url: source.url || "",
            };
          }).filter(Boolean);

          if (enriched.length > 0) {
            console.log(`AI extracted ${enriched.length} structured jobs`);
            return new Response(JSON.stringify({ success: true, jobs: enriched, ai_chain: providerChain }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      } catch (e) {
        console.error("AI extraction failed, falling back:", e);
      }
    }

    // Fallback: basic extraction without AI
    const results = rawResults.map((result: any) => {
      const title = result.metadata?.title || result.title || "";
      const description = result.metadata?.description || (result.markdown || "").substring(0, 1000);
      const titleParts = title.split(/\s[-–|@]\s/);
      return {
        title: titleParts[0]?.trim() || "Untitled Job",
        company: titleParts[1]?.trim() || "Unknown Company",
        location: "", remote_type: "unknown", description,
        salary_min: null, salary_max: null, salary_currency: null,
        employment_type: "full-time", seniority_level: "", requirements: [],
        apply_url: result.url || "", source_url: result.url || "",
      };
    }).filter((j: any) => j.title !== "Untitled Job" || j.company !== "Unknown Company");

    return new Response(JSON.stringify({ success: true, jobs: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message || "Search failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
