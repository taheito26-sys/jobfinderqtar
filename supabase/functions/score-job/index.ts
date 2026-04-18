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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    const body = await req.json();

    let supabase: ReturnType<typeof createClient>;
    let userId: string;

    if (serviceRoleKey && bearerToken === serviceRoleKey) {
      userId = body?.user_id;
      if (!userId) throw new Error("Missing user_id");
      supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
    } else {
      supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("Unauthorized");
      userId = user.id;
    }

    const pipelineConfig = await getPipelineConfig(userId);
    console.log(`[score-job] Pipeline: ${pipelineConfig.enabled ? "ON" : "OFF"}, providers: ${pipelineConfig.providers.map(p => p.name).join(" → ")}`);

    const { job_id } = body;
    if (!job_id) throw new Error("job_id is required");

    const { data: job, error: jobError } = await supabase
      .from("jobs").select("*").eq("id", job_id).eq("user_id", userId).single();
    if (jobError || !job) throw new Error("Job not found");

    const [profileRes, skillsRes, empRes] = await Promise.all([
      supabase.from("profiles_v2").select("*").eq("user_id", userId).single(),
      supabase.from("profile_skills").select("*").eq("user_id", userId),
      supabase.from("employment_history").select("*").eq("user_id", userId).order("start_date", { ascending: false }),
    ]);

    const profile = profileRes.data;
    const skills = skillsRes.data || [];
    const employment = empRes.data || [];

    const profileSummary = `
Name: ${profile?.full_name || "N/A"}
Headline: ${profile?.headline || "N/A"}
Summary: ${profile?.summary || "N/A"}
Location: ${profile?.location || "N/A"}, ${profile?.country || "N/A"}
Remote Preference: ${profile?.remote_preference || "flexible"}
Visa: ${profile?.visa_status || "N/A"}
Work Auth: ${profile?.work_authorization || "N/A"}
Seniority: ${profile?.desired_seniority || "N/A"}
Salary Range: ${profile?.desired_salary_min || 0}-${profile?.desired_salary_max || 0} ${profile?.desired_salary_currency || "USD"}
Skills: ${skills.map((s: any) => `${s.skill_name} (${s.proficiency})`).join(", ")}
Experience: ${employment.map((e: any) => `${e.title} at ${e.company} (${e.start_date} - ${e.is_current ? "Present" : e.end_date})`).join("; ")}
    `.trim();

    const jobSummary = `
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || "N/A"}
Remote: ${job.remote_type}
Seniority: ${job.seniority_level || "N/A"}
Industry: ${job.industry || "N/A"}
Salary: ${job.salary_min || "?"}-${job.salary_max || "?"} ${job.salary_currency}
Description: ${job.description || "N/A"}
Requirements: ${JSON.stringify(job.requirements || [])}
Nice to have: ${JSON.stringify(job.nice_to_haves || [])}
    `.trim();

    const systemPrompt = `You are a job matching scoring engine. Score a candidate profile against a job listing.
Return a JSON object with exactly these fields:

CANDIDATE FIT SCORING:
- overall_score: 0-100
- hard_requirements_score: 0-100
- skill_overlap_score: 0-100
- title_relevance_score: 0-100
- seniority_fit_score: 0-100
- industry_fit_score: 0-100
- location_fit_score: 0-100
- compensation_fit_score: 0-100
- language_fit_score: 0-100
- work_auth_fit_score: 0-100
- match_reasons: string[] (3-5 concise reasons why this is a good match)
- missing_requirements: string[] (requirements the candidate doesn't clearly meet)
- blockers: string[] (dealbreakers like visa issues, missing critical certs)
- recommendation: "apply" | "review" | "skip"

BLOCK G — POSTING LEGITIMACY (independent of candidate fit):
- legitimacy_tier: "high_confidence" | "proceed_with_caution" | "suspicious"
- legitimacy_score: 0-100 (100 = definitely legitimate, 0 = definitely fake/ghost)
- legitimacy_reasons: string[] (2-4 specific observations about legitimacy)
- legitimacy_flags: string[] (specific red flags, empty array if none)

Legitimacy scoring rules:
- high_confidence (80-100): Clear company info, specific role details, realistic requirements, active/recent posting, proper JD structure
- proceed_with_caution (40-79): Vague company details, very generic description, salary range missing, unusual requirements, role may be evergreen/always-open
- suspicious (0-39): No company info, unrealistic promises, duplicate-looking JD, excessive keyword stuffing, no clear hiring manager context, ghost job indicators (posted long ago, reposted multiple times), legal red flags

The overall_score should be a weighted average:
- hard_requirements: 25%, skill_overlap: 20%, title_relevance: 10%, seniority_fit: 10%
- industry_fit: 8%, location_fit: 10%, compensation_fit: 7%, language_fit: 5%, work_auth_fit: 5%

Be realistic. If info is missing, score that dimension at 50 (neutral). Never fabricate candidate qualifications.`;

    const tools = [{
      type: "function",
      function: {
        name: "score_job_match",
        description: "Return the structured job match score including Block G legitimacy assessment",
        parameters: {
          type: "object",
          properties: {
            overall_score: { type: "integer", minimum: 0, maximum: 100 },
            hard_requirements_score: { type: "integer", minimum: 0, maximum: 100 },
            skill_overlap_score: { type: "integer", minimum: 0, maximum: 100 },
            title_relevance_score: { type: "integer", minimum: 0, maximum: 100 },
            seniority_fit_score: { type: "integer", minimum: 0, maximum: 100 },
            industry_fit_score: { type: "integer", minimum: 0, maximum: 100 },
            location_fit_score: { type: "integer", minimum: 0, maximum: 100 },
            compensation_fit_score: { type: "integer", minimum: 0, maximum: 100 },
            language_fit_score: { type: "integer", minimum: 0, maximum: 100 },
            work_auth_fit_score: { type: "integer", minimum: 0, maximum: 100 },
            match_reasons: { type: "array", items: { type: "string" } },
            missing_requirements: { type: "array", items: { type: "string" } },
            blockers: { type: "array", items: { type: "string" } },
            recommendation: { type: "string", enum: ["apply", "review", "skip"] },
            legitimacy_tier: { type: "string", enum: ["high_confidence", "proceed_with_caution", "suspicious"] },
            legitimacy_score: { type: "integer", minimum: 0, maximum: 100 },
            legitimacy_reasons: { type: "array", items: { type: "string" } },
            legitimacy_flags: { type: "array", items: { type: "string" } },
          },
          required: [
            "overall_score", "hard_requirements_score", "skill_overlap_score", "title_relevance_score",
            "seniority_fit_score", "industry_fit_score", "location_fit_score", "compensation_fit_score",
            "language_fit_score", "work_auth_fit_score", "match_reasons", "missing_requirements",
            "blockers", "recommendation",
            "legitimacy_tier", "legitimacy_score", "legitimacy_reasons", "legitimacy_flags",
          ],
        },
      },
    }];

    const { result, providerChain } = await runPipeline({
      config: pipelineConfig,
      systemPrompt,
      userPrompt: `CANDIDATE PROFILE:\n${profileSummary}\n\nJOB LISTING:\n${jobSummary}`,
      tools,
      toolChoice: { type: "function", function: { name: "score_job_match" } },
      reviewInstruction: "Verify scoring accuracy. Check that overall_score matches the weighted average. Ensure match_reasons are factual. Verify blockers are real dealbreakers. Adjust any inflated or deflated scores.",
    });

    console.log(`[score-job] Pipeline chain: ${providerChain.join(" → ")}`);
    const scores = JSON.parse(result.tool_arguments);

    // Semantic similarity — computed from stored embeddings only (embeddings are generated
    // separately by the generate-embeddings function, which uses OpenAI directly).
    let semanticSimilarity = 0;
    try {
      const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: profileEmb } = await supabaseAdmin.from("profile_embeddings").select("embedding").eq("user_id", userId).eq("section", "full").maybeSingle();
      const { data: jobEmb } = await supabaseAdmin.from("job_embeddings").select("embedding").eq("job_id", job_id).maybeSingle();
      if (profileEmb?.embedding && jobEmb?.embedding) {
        const { data: simResult } = await supabaseAdmin.rpc("compute_similarity", { _user_id: userId, _job_id: job_id });
        if (simResult !== null && simResult !== undefined) semanticSimilarity = Math.round(simResult * 100) / 100;
      }
    } catch (embErr: any) {
      console.warn("Semantic similarity skipped:", embErr.message);
    }

    const { data: match, error: matchError } = await supabase.from("job_matches").upsert({
      user_id: userId, job_id, ...scores,
      semantic_similarity: semanticSimilarity,
      scored_at: new Date().toISOString(),
      legitimacy_tier: scores.legitimacy_tier || "unknown",
      legitimacy_score: scores.legitimacy_score ?? null,
      legitimacy_reasons: scores.legitimacy_reasons || [],
      legitimacy_flags: scores.legitimacy_flags || [],
    }, { onConflict: "user_id,job_id" }).select().single();

    if (matchError) throw matchError;

    await supabase.from("activity_log").insert({
      user_id: userId,
      action: "scored_job",
      entity_type: "job_match",
      entity_id: match.id,
      details: { job_title: job.title, company: job.company, score: scores.overall_score, ai_pipeline: pipelineConfig.enabled, ai_chain: providerChain },
    });

    return new Response(JSON.stringify({ ...match, ai_chain: providerChain }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("score-job error:", error);
    const status = error.status || 400;
    return new Response(JSON.stringify({ error: error.message || "Unknown error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
