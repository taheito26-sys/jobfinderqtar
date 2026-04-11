import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { job_id } = await req.json();
    if (!job_id) throw new Error("job_id is required");

    // Fetch job
    const { data: job, error: jobError } = await supabase
      .from("jobs").select("*").eq("id", job_id).eq("user_id", user.id).single();
    if (jobError || !job) throw new Error("Job not found");

    // Fetch profile
    const { data: profile } = await supabase
      .from("profiles_v2").select("*").eq("user_id", user.id).single();
    
    // Fetch skills
    const { data: skills } = await supabase
      .from("profile_skills").select("*").eq("user_id", user.id);

    // Fetch employment
    const { data: employment } = await supabase
      .from("employment_history").select("*").eq("user_id", user.id)
      .order("start_date", { ascending: false });

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
Skills: ${(skills || []).map(s => `${s.skill_name} (${s.proficiency})`).join(", ")}
Experience: ${(employment || []).map(e => `${e.title} at ${e.company} (${e.start_date} - ${e.is_current ? "Present" : e.end_date})`).join("; ")}
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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a job matching scoring engine. Score a candidate profile against a job listing.
Return a JSON object with exactly these fields:
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

The overall_score should be a weighted average:
- hard_requirements: 25%
- skill_overlap: 20%
- title_relevance: 10%
- seniority_fit: 10%
- industry_fit: 8%
- location_fit: 10%
- compensation_fit: 7%
- language_fit: 5%
- work_auth_fit: 5%

Be realistic. If info is missing, score that dimension at 50 (neutral). Never fabricate candidate qualifications.`,
          },
          {
            role: "user",
            content: `CANDIDATE PROFILE:\n${profileSummary}\n\nJOB LISTING:\n${jobSummary}`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "score_job_match",
            description: "Return the structured job match score",
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
              },
              required: ["overall_score", "hard_requirements_score", "skill_overlap_score", "title_relevance_score", "seniority_fit_score", "industry_fit_score", "location_fit_score", "compensation_fit_score", "language_fit_score", "work_auth_fit_score", "match_reasons", "missing_requirements", "blockers", "recommendation"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "score_job_match" } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in workspace settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

    const scores = JSON.parse(toolCall.function.arguments);

    // Upsert match
    const { data: match, error: matchError } = await supabase.from("job_matches").upsert({
      user_id: user.id,
      job_id,
      ...scores,
      semantic_similarity: 0,
      scored_at: new Date().toISOString(),
    }, { onConflict: "user_id,job_id" }).select().single();

    if (matchError) throw matchError;

    // Log activity
    await supabase.from("activity_log").insert({
      user_id: user.id,
      action: "scored_job",
      entity_type: "job_match",
      entity_id: match.id,
      details: { job_title: job.title, company: job.company, score: scores.overall_score },
    });

    return new Response(JSON.stringify(match), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("score-job error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
