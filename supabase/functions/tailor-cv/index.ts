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
    console.log(`[tailor-cv] Pipeline: ${pipelineConfig.enabled ? "ON" : "OFF"}, providers: ${pipelineConfig.providers.map(p => p.name).join(" → ")}`);

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

    const reviewInstruction = document_type === "cv"
      ? "Verify every experience entry, skill, and achievement matches the candidate's actual profile data. Remove any hallucinated content. Improve formatting and relevance to the target job. Ensure the summary is compelling and job-aligned."
      : "Verify all claims in the cover letter against the candidate's actual profile. Remove fabrications. Improve tone, flow, and relevance. Ensure it addresses key job requirements with real examples.";

    const { result, providerChain } = await runPipeline({
      config: pipelineConfig,
      systemPrompt,
      userPrompt,
      tools,
      toolChoice: { type: "function", function: { name: "generate_tailored_document" } },
      reviewInstruction,
    });

    console.log(`[tailor-cv] Pipeline chain: ${providerChain.join(" → ")}`);

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
      details: {
        job_title: job.title,
        document_type,
        approval_status: approvalStatus,
        ai_pipeline: pipelineConfig.enabled,
        ai_chain: providerChain,
      },
    });

    return new Response(JSON.stringify({ ...tailoredDoc, ai_chain: providerChain }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("tailor-cv error:", error);
    const is429 = error.status === 429 || error.message?.includes("Rate limited");
    const is402 = error.status === 402 || error.message?.includes("Credits");
    
    if (is429) {
      return new Response(JSON.stringify({ 
        error: "AI provider is rate limited. Please wait 30-60 seconds and try again.",
        fallback: true,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (is402) {
      return new Response(JSON.stringify({ 
        error: "AI credits exhausted. Add funds in Settings → Workspace → Usage.",
        retryable: false,
      }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    return new Response(JSON.stringify({ error: error.message || "Unknown error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
