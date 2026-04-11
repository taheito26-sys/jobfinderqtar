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
    .from("user_preferences").select("key, value")
    .eq("user_id", userId).in("key", ["ai_provider", "ai_api_key"]);

  const prefMap: Record<string, string> = {};
  (prefs || []).forEach((p: any) => { prefMap[p.key] = p.value; });
  const provider = prefMap["ai_provider"] || "lovable";
  const userKey = prefMap["ai_api_key"] || "";

  switch (provider) {
    case "anthropic":
      if (!userKey) throw new Error("Anthropic API key not configured. Go to Settings.");
      return { provider, apiKey: userKey, url: "https://api.anthropic.com/v1/messages", model: "claude-sonnet-4-20250514" };
    case "openai":
      if (!userKey) throw new Error("OpenAI API key not configured. Go to Settings.");
      return { provider, apiKey: userKey, url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o" };
    case "gemini":
      if (!userKey) throw new Error("Google API key not configured. Go to Settings.");
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
    const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";
    const userMsgs = messages.filter((m: any) => m.role !== "system");
    const body: any = { model: config.model, max_tokens: 8192, system: systemMsg, messages: userMsgs };
    if (tools) {
      body.tools = tools.map((t: any) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
      if (tool_choice) body.tool_choice = { type: "tool", name: tool_choice.function.name };
    }
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) { const err = await response.text(); console.error("Anthropic error:", err); throw new Error(`AI error: ${response.status}`); }
    const data = await response.json();
    const toolUse = data.content?.find((c: any) => c.type === "tool_use");
    if (toolUse) return { tool_arguments: JSON.stringify(toolUse.input) };
    return { tool_arguments: data.content?.find((c: any) => c.type === "text")?.text || "{}" };
  }

  const body: any = { model: config.model, messages };
  if (tools) body.tools = tools;
  if (tool_choice) body.tool_choice = tool_choice;
  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 429) throw Object.assign(new Error("Rate limited"), { status: 429 });
    if (response.status === 402) throw Object.assign(new Error("Credits exhausted"), { status: 402 });
    throw new Error(`AI error: ${response.status}`);
  }
  const aiResult = await response.json();
  const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall) return { tool_arguments: toolCall.function.arguments };
  return { tool_arguments: aiResult.choices?.[0]?.message?.content || "{}" };
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

    const { job_id, document_type = "cv" } = await req.json();
    if (!job_id) throw new Error("job_id is required");

    const [jobRes, profileRes, skillsRes, empRes, proofRes, matchRes] = await Promise.all([
      supabase.from("jobs").select("*").eq("id", job_id).eq("user_id", user.id).single(),
      supabase.from("profiles_v2").select("*").eq("user_id", user.id).single(),
      supabase.from("profile_skills").select("*").eq("user_id", user.id),
      supabase.from("employment_history").select("*").eq("user_id", user.id).order("start_date", { ascending: false }),
      supabase.from("proof_points").select("*").eq("user_id", user.id),
      supabase.from("job_matches").select("*").eq("job_id", job_id).eq("user_id", user.id).maybeSingle(),
    ]);

    if (!jobRes.data) throw new Error("Job not found");
    if (!profileRes.data) throw new Error("Profile not found. Please complete your profile first.");

    const job = jobRes.data;
    const profile = profileRes.data;
    const skills = skillsRes.data || [];
    const employment = empRes.data || [];
    const proofPoints = proofRes.data || [];
    const match = matchRes.data;

    const systemPrompt = document_type === "cv"
      ? `You are a professional CV tailoring assistant. Given a candidate's profile and a target job, produce a tailored CV content.

CRITICAL RULES:
- NEVER invent achievements, employers, dates, certifications, skills, or metrics
- ONLY use facts from the provided profile data
- Reorder and prioritize relevant experience
- Highlight matching achievements and skills
- Update the professional summary to align with the job
- Remove less relevant content but don't fabricate replacements
- Flag any claims that cannot be verified from the profile data

Return a JSON object with:
- summary: string (tailored professional summary)
- experience: array of {company, title, start_date, end_date, is_current, highlights: string[]}
- skills: string[] (prioritized and relevant)
- changes_summary: string[] (what was changed and why)
- unsupported_claims: string[] (any claims that couldn't be verified - should be empty if done correctly)`
      : `You are a professional cover letter writer. Given a candidate's profile and a target job, write a compelling cover letter.

CRITICAL RULES:
- NEVER invent achievements, employers, dates, or qualifications
- ONLY reference real experience from the profile
- Address key job requirements with specific examples from the candidate's background
- Keep it concise (3-4 paragraphs)
- Professional but personable tone

Return a JSON object with:
- content: string (the full cover letter text)
- changes_summary: string[] (key points addressed)
- unsupported_claims: string[] (should be empty)`;

    const userPrompt = `CANDIDATE PROFILE:
Name: ${profile.full_name}
Headline: ${profile.headline}
Summary: ${profile.summary}
Skills: ${skills.map((s: any) => s.skill_name).join(", ")}
Experience:
${employment.map((e: any) => `- ${e.title} at ${e.company} (${e.start_date} - ${e.is_current ? "Present" : e.end_date || "N/A"})
  ${e.description || ""}
  Achievements: ${JSON.stringify(e.achievements || [])}
  Technologies: ${JSON.stringify(e.technologies || [])}`).join("\n")}
Proof Points:
${proofPoints.map((p: any) => `- ${p.statement} (${p.metric_value || "no metric"})`).join("\n")}

TARGET JOB:
Title: ${job.title}
Company: ${job.company}
Description: ${job.description}
Requirements: ${JSON.stringify(job.requirements || [])}
Nice to have: ${JSON.stringify(job.nice_to_haves || [])}

${match ? `Match Score: ${match.overall_score}/100
Match Reasons: ${JSON.stringify(match.match_reasons)}
Missing: ${JSON.stringify(match.missing_requirements)}` : ""}`;

    const contentSchema = document_type === "cv"
      ? {
          type: "object",
          properties: {
            summary: { type: "string", description: "Tailored professional summary" },
            experience: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  company: { type: "string" },
                  title: { type: "string" },
                  start_date: { type: "string" },
                  end_date: { type: "string" },
                  is_current: { type: "boolean" },
                  highlights: { type: "array", items: { type: "string" } },
                },
                required: ["company", "title", "start_date", "highlights"],
              },
            },
            skills: { type: "array", items: { type: "string" } },
          },
          required: ["summary", "experience", "skills"],
        }
      : {
          type: "object",
          properties: {
            letter_text: { type: "string", description: "The full cover letter text" },
          },
          required: ["letter_text"],
        };

    const tools = [{
      type: "function",
      function: {
        name: "generate_tailored_document",
        description: "Return the tailored document content with all fields populated",
        parameters: {
          type: "object",
          properties: {
            content: contentSchema,
            changes_summary: { type: "array", items: { type: "string" }, description: "List of changes made and why" },
            unsupported_claims: { type: "array", items: { type: "string" }, description: "Claims that could not be verified from profile data" },
          },
          required: ["content", "changes_summary", "unsupported_claims"],
        },
      },
    }];

    const result = await callAI(
      aiConfig,
      [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      tools,
      { type: "function", function: { name: "generate_tailored_document" } }
    );

    const parsed = JSON.parse(result.tool_arguments);
    const hasUnsupportedClaims = (parsed.unsupported_claims || []).length > 0;
    const approvalStatus = hasUnsupportedClaims ? "needs_revision" : "pending";

    const { data: tailoredDoc, error: docError } = await supabase.from("tailored_documents").insert({
      user_id: user.id,
      job_id,
      match_id: match?.id || null,
      document_type,
      content: parsed.content,
      original_content: { summary: profile.summary, experience: employment, skills: skills.map((s: any) => s.skill_name) },
      changes_summary: parsed.changes_summary,
      unsupported_claims: parsed.unsupported_claims,
      approval_status: approvalStatus,
    }).select().single();

    if (docError) throw docError;

    await supabase.from("activity_log").insert({
      user_id: user.id,
      action: "tailored_document",
      entity_type: "tailored_document",
      entity_id: tailoredDoc.id,
      details: { job_title: job.title, document_type, approval_status: approvalStatus, ai_provider: aiConfig.provider },
    });

    return new Response(JSON.stringify(tailoredDoc), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("tailor-cv error:", error);
    const status = error.status || 400;
    return new Response(JSON.stringify({ error: error.message || "Unknown error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});