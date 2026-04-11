import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AIConfig {
  provider: string;
  apiKey: string;
  url: string;
  model: string;
}

async function getAIConfig(userId: string): Promise<AIConfig> {
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: prefs } = await supabaseAdmin
    .from("user_preferences")
    .select("key, value")
    .eq("user_id", userId)
    .in("key", ["ai_provider", "ai_api_key"]);

  const prefMap: Record<string, string> = {};
  (prefs || []).forEach((p: any) => { prefMap[p.key] = p.value; });

  const provider = prefMap["ai_provider"] || "lovable";
  const userKey = prefMap["ai_api_key"] || "";

  switch (provider) {
    case "anthropic":
      if (!userKey) throw new Error("Anthropic API key not configured. Go to Settings to add it.");
      return { provider, apiKey: userKey, url: "https://api.anthropic.com/v1/messages", model: "claude-sonnet-4-20250514" };
    case "openai":
      if (!userKey) throw new Error("OpenAI API key not configured. Go to Settings to add it.");
      return { provider, apiKey: userKey, url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o" };
    case "gemini":
      if (!userKey) throw new Error("Google API key not configured. Go to Settings to add it.");
      return { provider, apiKey: userKey, url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-2.5-flash" };
    default: {
      const lovableKey = Deno.env.get("LOVABLE_API_KEY");
      if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");
      return { provider: "lovable", apiKey: lovableKey, url: "https://ai.gateway.lovable.dev/v1/chat/completions", model: "google/gemini-3-flash-preview" };
    }
  }
}

async function callAI(config: AIConfig, messages: any[], tools?: any[], tool_choice?: any) {
  if (config.provider === "anthropic") {
    // Anthropic uses a different API format
    const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";
    const userMsgs = messages.filter((m: any) => m.role !== "system");
    
    const body: any = {
      model: config.model,
      max_tokens: 4096,
      system: systemMsg,
      messages: userMsgs,
    };
    if (tools) {
      body.tools = tools.map((t: any) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
      if (tool_choice) {
        body.tool_choice = { type: "tool", name: tool_choice.function.name };
      }
    }

    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic error:", response.status, err);
      throw new Error(`AI error: ${response.status}`);
    }

    const data = await response.json();
    // Extract tool use result
    const toolUse = data.content?.find((c: any) => c.type === "tool_use");
    if (toolUse) {
      return { tool_arguments: JSON.stringify(toolUse.input) };
    }
    // Fallback to text
    const text = data.content?.find((c: any) => c.type === "text")?.text || "{}";
    return { tool_arguments: text };
  }

  // OpenAI-compatible (OpenAI, Gemini, Lovable)
  const body: any = { model: config.model, messages };
  if (tools) body.tools = tools;
  if (tool_choice) body.tool_choice = tool_choice;

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("AI error:", response.status, errText);
    if (response.status === 429) throw Object.assign(new Error("Rate limited"), { status: 429 });
    if (response.status === 402) throw Object.assign(new Error("Credits exhausted"), { status: 402 });
    throw new Error(`AI error: ${response.status}`);
  }

  const aiResult = await response.json();
  const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall) {
    return { tool_arguments: toolCall.function.arguments };
  }
  // Fallback: try to extract from content
  const content = aiResult.choices?.[0]?.message?.content || "{}";
  return { tool_arguments: content };
}

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

    const aiConfig = await getAIConfig(user.id);
    console.log(`Using AI provider: ${aiConfig.provider}`);

    const { job_id } = await req.json();
    if (!job_id) throw new Error("job_id is required");

    // Fetch job
    const { data: job, error: jobError } = await supabase
      .from("jobs").select("*").eq("id", job_id).eq("user_id", user.id).single();
    if (jobError || !job) throw new Error("Job not found");

    // Fetch profile, skills, employment
    const [profileRes, skillsRes, empRes] = await Promise.all([
      supabase.from("profiles_v2").select("*").eq("user_id", user.id).single(),
      supabase.from("profile_skills").select("*").eq("user_id", user.id),
      supabase.from("employment_history").select("*").eq("user_id", user.id).order("start_date", { ascending: false }),
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
- hard_requirements: 25%, skill_overlap: 20%, title_relevance: 10%, seniority_fit: 10%
- industry_fit: 8%, location_fit: 10%, compensation_fit: 7%, language_fit: 5%, work_auth_fit: 5%

Be realistic. If info is missing, score that dimension at 50 (neutral). Never fabricate candidate qualifications.`;

    const tools = [{
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
    }];

    const result = await callAI(
      aiConfig,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `CANDIDATE PROFILE:\n${profileSummary}\n\nJOB LISTING:\n${jobSummary}` },
      ],
      tools,
      { type: "function", function: { name: "score_job_match" } }
    );

    const scores = JSON.parse(result.tool_arguments);

    // Upsert match
    const { data: match, error: matchError } = await supabase.from("job_matches").upsert({
      user_id: user.id,
      job_id,
      ...scores,
      semantic_similarity: 0,
      scored_at: new Date().toISOString(),
    }, { onConflict: "user_id,job_id" }).select().single();

    if (matchError) throw matchError;

    await supabase.from("activity_log").insert({
      user_id: user.id,
      action: "scored_job",
      entity_type: "job_match",
      entity_id: match.id,
      details: { job_title: job.title, company: job.company, score: scores.overall_score, ai_provider: aiConfig.provider },
    });

    return new Response(JSON.stringify(match), {
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