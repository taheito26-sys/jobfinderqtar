import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getPipelineConfig, runPipeline } from "../_shared/ai-pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const pipelineConfig = await getPipelineConfig(user.id);

    const { job_id } = await req.json();
    if (!job_id) throw new Error("job_id is required");

    // Load job and user profile in parallel
    const [jobRes, profileRes, skillsRes, empRes] = await Promise.all([
      supabase.from("jobs").select("*").eq("id", job_id).eq("user_id", user.id).single(),
      supabase.from("profiles_v2").select("*").eq("user_id", user.id).single(),
      supabase.from("profile_skills").select("*").eq("user_id", user.id),
      supabase.from("employment_history").select("*").eq("user_id", user.id).order("start_date", { ascending: false }).limit(5),
    ]);

    if (jobRes.error || !jobRes.data) throw new Error("Job not found");
    const job = jobRes.data;
    const profile = profileRes.data;
    const skills = skillsRes.data || [];
    const employment = empRes.data || [];

    // Optionally scrape the company website for richer context
    let scrapedContext = "";
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (firecrawlKey && job.company_url) {
      try {
        const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: { "Authorization": `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: job.company_url, formats: ["markdown"], onlyMainContent: true }),
        });
        if (scrapeRes.ok) {
          const scrapeData = await scrapeRes.json();
          const content = scrapeData?.data?.markdown || "";
          scrapedContext = content.slice(0, 3000); // Cap to 3000 chars
        }
      } catch (scrapeErr) {
        console.warn("[deep-research] Firecrawl scrape failed:", scrapeErr);
      }
    }

    const candidateSummary = `
Name: ${profile?.full_name || "N/A"}
Headline: ${profile?.headline || "N/A"}
Summary: ${profile?.summary || "N/A"}
Skills: ${skills.map((s: any) => `${s.skill_name} (${s.proficiency})`).join(", ")}
Experience: ${employment.map((e: any) => `${e.title} at ${e.company} (${e.start_date} - ${e.is_current ? "Present" : e.end_date})`).join("; ")}
    `.trim();

    const jobContext = `
Company: ${job.company}
Role: ${job.title}
Industry: ${job.industry || "N/A"}
Location: ${job.location || "N/A"}
Description: ${(job.description || "").slice(0, 2000)}
Requirements: ${JSON.stringify((job.requirements || []).slice(0, 15))}
${scrapedContext ? `\nCompany website content:\n${scrapedContext}` : ""}
    `.trim();

    const systemPrompt = `You are a strategic career intelligence analyst. Your job is to produce deep company research for a job candidate preparing for an interview.

Analyze the company and role across 6 axes, then synthesize a candidate angle. Return a structured JSON report. Be specific and actionable — avoid generic filler like "they are innovative." Reference actual signals from the job description and context provided. If you cannot determine something with confidence, say so briefly and move on.

Today's date: ${new Date().toISOString().split("T")[0]}`;

    const tools = [{
      type: "function",
      function: {
        name: "company_research_report",
        description: "Structured 6-axis company research report for interview preparation",
        parameters: {
          type: "object",
          properties: {
            ai_strategy: {
              type: "string",
              description: "AI/ML/tech strategy signals: product AI features, tech stack indicators, engineering blog themes, thought leadership. 2-4 sentences.",
            },
            recent_movements: {
              type: "string",
              description: "Recent company movements inferred from context: hiring patterns (what roles they're filling), funding signals, growth stage indicators, leadership changes hinted in JD. 2-4 sentences.",
            },
            engineering_culture: {
              type: "string",
              description: "Engineering/technical culture signals: deployment practices hinted in requirements, tech stack choices, remote/hybrid stance, team size signals from JD. 2-4 sentences.",
            },
            probable_challenges: {
              type: "string",
              description: "Probable challenges this team is facing: infer from what they're hiring for and the requirements listed. What problem is this hire solving? What bottleneck or scaling challenge do they likely have? 2-4 sentences.",
            },
            competitive_positioning: {
              type: "string",
              description: "Competitive context: industry they operate in, likely competitors based on industry/role, market dynamics relevant to this hire. 2-3 sentences.",
            },
            candidate_angle: {
              type: "string",
              description: "How the candidate's specific background maps to this company's needs. Connect their experience/skills to the probable challenges and role requirements. This is the most important section — make it personal and specific. 3-5 sentences.",
            },
            summary: {
              type: "string",
              description: "One-paragraph executive summary of the opportunity and whether the candidate should pursue it strongly. Include a recommendation (pursue / pursue with caveats / low priority).",
            },
          },
          required: [
            "ai_strategy", "recent_movements", "engineering_culture",
            "probable_challenges", "competitive_positioning", "candidate_angle", "summary",
          ],
        },
      },
    }];

    const { result, providerChain } = await runPipeline({
      config: pipelineConfig,
      systemPrompt,
      userPrompt: `CANDIDATE PROFILE:\n${candidateSummary}\n\nJOB & COMPANY CONTEXT:\n${jobContext}`,
      tools,
      toolChoice: { type: "function", function: { name: "company_research_report" } },
      reviewInstruction: "Verify research is specific and grounded in the provided context. Ensure candidate_angle is personalized to this specific candidate's skills and experience — not generic advice. Check that probable_challenges identify a real hiring reason.",
    });

    const research = JSON.parse(result.tool_arguments);

    // Upsert research into DB
    const { data: saved, error: saveError } = await supabase.from("company_research").upsert({
      user_id: user.id,
      job_id,
      company: job.company,
      ...research,
      researched_at: new Date().toISOString(),
    }, { onConflict: "user_id,job_id" }).select().single();

    if (saveError) throw saveError;

    await supabase.from("activity_log").insert({
      user_id: user.id,
      action: "deep_research",
      entity_type: "company_research",
      entity_id: saved.id,
      details: { job_title: job.title, company: job.company, ai_chain: providerChain },
    });

    return new Response(JSON.stringify({ ...saved, ai_chain: providerChain }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[deep-research] error:", error);
    const status = error.status || 400;
    return new Response(JSON.stringify({ error: error.message || "Unknown error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
