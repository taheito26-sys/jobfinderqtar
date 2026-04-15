import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getPipelineConfig, runPipelineText } from "../_shared/ai-pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeText(value: string | null | undefined) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

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

function buildResultIdentity(result: any) {
  const urlKey = normalizeUrl(result?.url);
  if (urlKey) return `url:${urlKey}`;

  const title = normalizeText(result?.metadata?.title || result?.title || "");
  const description = normalizeText(result?.metadata?.description || "");
  return `text:${title}|${description}`;
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
    const seenIdentities = new Set<string>();
    const dedupedResults = rawResults.filter((result: any) => {
      const identity = buildResultIdentity(result);
      if (!identity) return false;
      if (seenIdentities.has(identity)) return false;
      seenIdentities.add(identity);
      return true;
    });

    if (dedupedResults.length > 0) {
      try {
        const summaries = dedupedResults.map((r: any, i: number) => {
          const title = r.metadata?.title || r.title || "";
          const desc = r.metadata?.description || "";
          const markdown = (r.markdown || "").substring(0, 800);
          return `[${i}] URL: ${r.url}\nTitle: ${title}\nDescription: ${desc}\nContent: ${markdown}`;
        }).join("\n---\n");

        const { result: raw, providerChain } = await runPipelineText({
          config: pipelineConfig,
          systemPrompt: "You extract structured job listing data. Return ONLY valid JSON array. No markdown wrapping.",
          userPrompt: `Extract job details from these search results. Return a JSON array of objects.

IMPORTANT: Some search result pages list MULTIPLE distinct job positions (e.g. a company careers page). If a page at index [N] contains multiple different roles, emit one object per role — all with the same index value. Do NOT merge different roles into one entry.

Each object must have these fields:
- index (number matching [N] above — repeat the same index for multiple jobs from the same page)
- title (job title only, not company name)
- company (company name)
- location (city/country)
- remote_type ("remote"|"hybrid"|"onsite"|"unknown") — if a job has a physical city and does NOT say "remote" or "work from home", use "onsite"
- employment_type ("full-time"|"part-time"|"contract"|"internship")
- seniority_level ("Senior"|"Mid"|"Junior"|"Lead"|"Executive"|"")
- salary_min (number or null)
- salary_max (number or null)
- salary_currency ("USD"|"QAR"|etc. or null)
- requirements (array of key requirements, max 5 per job)
- description (the description for THIS specific role only, not all roles combined)
- source_created_at (ISO 8601 string only if the content explicitly states the original posting date, e.g. "Posted 2 days ago" or "Posted Jan 15 2025". null otherwise. Never invent a date.)

Skip entries that are not actual job postings.

Results:
${summaries}`,
          reviewInstruction: "Verify extracted job data is accurate. Ensure titles don't include company names. Check that indices match source results. Each role from a multi-job page must be its own separate entry. Remove non-job-posting entries.",
        });

        console.log(`[search-jobs] Pipeline chain: ${providerChain.join(" → ")}`);

        const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          const enriched = parsed.map((p: any) => {
            const source = dedupedResults[p.index];
            if (!source) return null;
            // Prefer AI-extracted date; fall back to Firecrawl metadata fields if present
            const metaDate = source.metadata?.publishedDate
              || source.metadata?.datePublished
              || source.metadata?.datePosted
              || null;
            return {
              title: p.title || "Untitled Job",
              company: p.company || "Unknown Company",
              location: p.location || "",
              remote_type: p.remote_type || "unknown",
              description: p.description || source.metadata?.description || (source.markdown || "").substring(0, 1000),
              salary_min: p.salary_min || null,
              salary_max: p.salary_max || null,
              salary_currency: p.salary_currency || null,
              employment_type: p.employment_type || "full-time",
              seniority_level: p.seniority_level || "",
              requirements: Array.isArray(p.requirements) ? p.requirements : [],
              apply_url: source.url || "",
              source_url: source.url || "",
              source_created_at: p.source_created_at || metaDate || null,
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
    const results = dedupedResults.map((result: any) => {
      const title = result.metadata?.title || result.title || "";
      const description = result.metadata?.description || (result.markdown || "").substring(0, 1000);
      const titleParts = title.split(/\s[-–|@]\s/);
      const metaDate = result.metadata?.publishedDate
        || result.metadata?.datePublished
        || result.metadata?.datePosted
        || null;
      return {
        title: titleParts[0]?.trim() || "Untitled Job",
        company: titleParts[1]?.trim() || "Unknown Company",
        location: "", remote_type: "unknown", description,
        salary_min: null, salary_max: null, salary_currency: null,
        employment_type: "full-time", seniority_level: "", requirements: [],
        apply_url: result.url || "", source_url: result.url || "",
        source_created_at: metaDate || null,
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
